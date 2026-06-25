'use strict';

const {
  formatGoalAlert,
  formatMissedPenaltyAlert,
  formatVarAlert,
  formatCardAlert,
  formatSubAlert,
  formatLiveCard,
} = require('../broadcast/format');
const { getFlag } = require('../broadcast/flags');

describe('broadcast/format', () => {
  const fixture = {
    teams: { homeTeamId: 'MEX', awayTeamId: 'RSA' },
  };

  describe('formatGoalAlert', () => {
    test('returns Block Kit with scorer, minute, and score', () => {
      const event = {
        type: 'Goal',
        minute: 23,
        extraMinute: null,
        teamId: 'MEX',
        playerName: 'J. Quinones',
        assistPlayerName: 'E. Lira',
        detail: 'Normal Goal',
      };
      const score = { home: 1, away: 0 };

      const blocks = formatGoalAlert(event, score, fixture);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('section');
      const text = blocks[0].text.text;
      expect(text).toContain('Goal!');
      expect(text).toContain('J. Quinones');
      expect(text).toContain('E. Lira');
      expect(text).toContain("23'");
      expect(text).toContain('1-0');
      expect(text).toContain(getFlag('MEX'));
    });

    test('handles own goal', () => {
      const event = {
        type: 'Goal',
        minute: 45,
        extraMinute: 2,
        playerName: 'Own Goaler',
        assistPlayerName: null,
        detail: 'Own Goal',
      };
      const score = { home: 0, away: 1 };

      const blocks = formatGoalAlert(event, score, fixture);
      const text = blocks[0].text.text;

      expect(text).toContain('(OG)');
      expect(text).toContain("45+2'");
    });

    test('handles no assist', () => {
      const event = {
        type: 'Goal',
        minute: 80,
        extraMinute: null,
        playerName: 'Solo Scorer',
        assistPlayerName: null,
        detail: 'Normal Goal',
      };
      const score = { home: 2, away: 1 };

      const blocks = formatGoalAlert(event, score, fixture);
      const text = blocks[0].text.text;

      expect(text).toContain('Solo Scorer');
      expect(text).not.toContain('(');
    });
  });

  describe('formatMissedPenaltyAlert', () => {
    test('returns missed penalty message', () => {
      const event = {
        type: 'Goal',
        minute: 55,
        extraMinute: null,
        teamId: 'MEX',
        playerName: 'Penalty Taker',
        detail: 'Missed Penalty',
      };

      const blocks = formatMissedPenaltyAlert(event);
      const text = blocks[0].text.text;

      expect(text).toContain('❌');
      expect(text).toContain('Missed Penalty');
      expect(text).toContain('Penalty Taker');
      expect(text).toContain("55'");
      expect(text).toContain(getFlag('MEX'));
    });
  });

  describe('formatVarAlert', () => {
    test('returns VAR decision message', () => {
      const event = {
        type: 'Var',
        minute: 67,
        extraMinute: null,
        playerName: 'Scorer',
        detail: 'Goal cancelled',
      };

      const blocks = formatVarAlert(event);
      const text = blocks[0].text.text;

      expect(text).toContain('📺');
      expect(text).toContain('VAR');
      expect(text).toContain('Goal cancelled');
      expect(text).toContain("67'");
    });

    test('handles penalty confirmed', () => {
      const event = {
        type: 'Var',
        minute: 80,
        extraMinute: 2,
        playerName: 'Fouled Player',
        detail: 'Penalty confirmed',
      };

      const blocks = formatVarAlert(event);
      const text = blocks[0].text.text;

      expect(text).toContain('Penalty confirmed');
      expect(text).toContain("80+2'");
    });
  });

  describe('formatCardAlert', () => {
    test('returns yellow card message', () => {
      const event = {
        type: 'Card',
        minute: 35,
        extraMinute: null,
        teamId: 'MEX',
        playerName: 'Rough Tackler',
        detail: 'Yellow Card',
      };

      const blocks = formatCardAlert(event);
      const text = blocks[0].text.text;

      expect(text).toContain('🟨');
      expect(text).toContain('Yellow Card');
      expect(text).toContain('Rough Tackler');
      expect(text).toContain("35'");
      expect(text).toContain(getFlag('MEX'));
    });

    test('returns red card message', () => {
      const event = {
        type: 'Card',
        minute: 78,
        extraMinute: null,
        playerName: 'Bad Foul',
        detail: 'Red Card',
      };

      const blocks = formatCardAlert(event);
      const text = blocks[0].text.text;

      expect(text).toContain('🟥');
      expect(text).toContain('Red Card');
    });

    test('returns red for second yellow', () => {
      const event = {
        type: 'Card',
        minute: 60,
        extraMinute: null,
        playerName: 'Double Yellow',
        detail: 'Second Yellow card',
      };

      const blocks = formatCardAlert(event);
      const text = blocks[0].text.text;

      expect(text).toContain('🟥');
    });
  });

  describe('formatSubAlert', () => {
    test('returns substitution message with players', () => {
      const event = {
        type: 'subst',
        minute: 60,
        extraMinute: null,
        teamId: 'MEX',
        playerName: 'Tired Player',
        assistPlayerName: 'Fresh Player',
      };

      const blocks = formatSubAlert(event);
      const text = blocks[0].text.text;

      expect(text).toContain('🔄');
      expect(text).toContain('Sub');
      expect(text).toContain('Fresh Player');
      expect(text).toContain('Tired Player');
      expect(text).toContain("60'");
      expect(text).toContain(getFlag('MEX'));
    });

    test('omits flag when event has no teamId', () => {
      const event = {
        type: 'subst',
        minute: 60,
        extraMinute: null,
        teamId: null,
        playerName: 'Tired Player',
        assistPlayerName: 'Fresh Player',
      };

      const blocks = formatSubAlert(event);
      const text = blocks[0].text.text;

      // White-flag fallback must not leak in when the team is unknown.
      expect(text).not.toContain('\u{1F3F3}');
      expect(text).toContain('Fresh Player');
    });
  });

  describe('formatLiveCard', () => {
    test('returns 3-block layout with header, section, context', () => {
      const liveFixture = { ...fixture, status: 'First Half', events: [] };
      const score = { home: 2, away: 1 };

      const blocks = formatLiveCard(liveFixture, score, 67);

      expect(blocks).toHaveLength(3);
      expect(blocks[0].type).toBe('header');
      expect(blocks[1].type).toBe('section');
      expect(blocks[2].type).toBe('context');
    });

    test('header shows green circle + status text + elapsed', () => {
      const liveFixture = { ...fixture, status: 'First Half', events: [] };
      const score = { home: 1, away: 0 };

      const blocks = formatLiveCard(liveFixture, score, 34);

      expect(blocks[0].text.text).toContain('\u{1F7E2}');
      expect(blocks[0].text.text).toContain('First Half');
      expect(blocks[0].text.text).toContain("34'");
    });

    test('header omits elapsed when null', () => {
      const liveFixture = { ...fixture, status: 'Halftime', events: [] };
      const score = { home: 1, away: 1 };

      const blocks = formatLiveCard(liveFixture, score, null);

      expect(blocks[0].text.text).toContain('Halftime');
      expect(blocks[0].text.text).not.toContain('null');
      expect(blocks[0].text.text).not.toContain("'");
    });

    test('section shows flags + teams + score', () => {
      const liveFixture = { ...fixture, status: 'Second Half', events: [] };
      const score = { home: 2, away: 1 };

      const blocks = formatLiveCard(liveFixture, score, 67);

      const text = blocks[1].text.text;
      expect(text).toContain('*Mexico*');
      expect(text).toContain('*South Africa*');
      expect(text).toContain('2 - 1');
    });

    // Regression: the initial-diff card refresh (TR-34) rewrites the card at
    // kickoff before any goal, and a match-end diff can arrive without a
    // finalScore. A missing home/away score must render 0, never "null - null".
    test('section renders 0 - 0 when score values are missing', () => {
      const liveFixture = { ...fixture, status: 'First Half', events: [] };
      const score = {}; // no home/away yet (initial diff)

      const blocks = formatLiveCard(liveFixture, score, 1);

      const text = blocks[1].text.text;
      expect(text).toContain('0 - 0');
      expect(text).not.toContain('null');
    });

    test('context shows scorers grouped by team when goals exist', () => {
      const events = [
        {
          type: 'Goal',
          minute: 23,
          playerName: 'J. Quinones',
          teamId: 'MEX',
          detail: 'Normal Goal',
        },
        { type: 'Goal', minute: 55, playerName: 'P. Tau', teamId: 'RSA', detail: 'Normal Goal' },
      ];
      const liveFixture = { ...fixture, status: 'Second Half', events };
      const score = { home: 1, away: 1 };

      const blocks = formatLiveCard(liveFixture, score, 60);

      const context = blocks[2].elements[0].text;
      expect(context).toContain('J. Quinones');
      expect(context).toContain("23'");
      expect(context).toContain('P. Tau');
      expect(context).toContain("55'");
    });

    test('context shows "No goals yet" when no goals', () => {
      const liveFixture = { ...fixture, status: 'First Half', events: [] };
      const score = { home: 0, away: 0 };

      const blocks = formatLiveCard(liveFixture, score, 15);

      expect(blocks[2].elements[0].text).toBe('No goals yet');
    });

    // Regression: goals present but teamId matches neither home nor away
    // (e.g. live API team id unmapped -> teamId null) must NOT yield an empty
    // context text, which Slack rejects (invalid_blocks) and silently freezes
    // the live card while thread events keep posting.
    test('context never empty when goals have unmatched teamId (null)', () => {
      const events = [
        {
          type: 'Goal',
          minute: 29,
          playerName: 'Jonathan David',
          teamId: null,
          detail: 'Normal Goal',
        },
      ];
      const liveFixture = { ...fixture, status: 'Second Half', events };
      const score = { home: 1, away: 0 };

      const blocks = formatLiveCard(liveFixture, score, 48);
      const context = blocks[2].elements[0].text;

      expect(context).not.toBe('');
      expect(context.length).toBeGreaterThan(0);
    });

    test('context never empty when goals have a teamId that is neither home nor away', () => {
      const events = [
        { type: 'Goal', minute: 29, playerName: 'Mystery', teamId: 'ZZZ', detail: 'Normal Goal' },
      ];
      const liveFixture = { ...fixture, status: 'Second Half', events };
      const score = { home: 1, away: 0 };

      const context = formatLiveCard(liveFixture, score, 48)[2].elements[0].text;

      expect(context).not.toBe('');
    });

    test('still groups matched scorers when only some goals are unmatched', () => {
      const events = [
        {
          type: 'Goal',
          minute: 29,
          playerName: 'Jonathan David',
          teamId: 'MEX',
          detail: 'Normal Goal',
        },
        { type: 'Goal', minute: 33, playerName: 'Unmapped', teamId: null, detail: 'Normal Goal' },
      ];
      const liveFixture = { ...fixture, status: 'Second Half', events };
      const score = { home: 2, away: 0 };

      const context = formatLiveCard(liveFixture, score, 48)[2].elements[0].text;

      // Matched scorer still shown; never empty
      expect(context).toContain('Jonathan David');
      expect(context).not.toBe('');
    });

    test('header shows red circle for Match Finished', () => {
      const liveFixture = { ...fixture, status: 'Match Finished', events: [] };
      const score = { home: 3, away: 1 };

      const blocks = formatLiveCard(liveFixture, score, null);

      expect(blocks[0].text.text).toContain('\u{1F534}');
      expect(blocks[0].text.text).toContain('Match Finished');
    });

    // Regression: a match-end diff sets matchEnded=true (the same flag that
    // triggers the recap), but the cached status can still lag on "Second Half"
    // because the fixture dropped out of the live feed before the detail
    // endpoint flipped to finished. The matchEnded flag must override the stale
    // status so the card flips to the finished card in lockstep with the recap.
    test('matchEnded flag forces finished card even when status still says Second Half', () => {
      const liveFixture = { ...fixture, status: 'Second Half', events: [] };
      const score = { home: 2, away: 0 };

      const blocks = formatLiveCard(liveFixture, score, 90, true);

      expect(blocks[0].text.text).toContain('\u{1F534}');
      expect(blocks[0].text.text).toContain('Match Finished');
      expect(blocks[0].text.text).not.toContain('Second Half');
    });

    test('matchEnded flag suppresses the elapsed tail on the finished card', () => {
      const liveFixture = { ...fixture, status: 'Second Half', events: [] };
      const score = { home: 2, away: 0 };

      const blocks = formatLiveCard(liveFixture, score, 90, true);

      expect(blocks[0].text.text).not.toContain("90'");
      expect(blocks[0].text.text).toContain('\u{1F534} Match Finished');
    });
  });
});
