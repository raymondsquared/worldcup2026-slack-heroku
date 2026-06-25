'use strict';

process.env.BROADCAST_CHANNEL_ID = 'C-test-channel';

jest.mock('../data', () => {
  const actual = jest.requireActual('../data');
  return { ...actual, getUpcomingFixtures: jest.fn() };
});

const { getUpcomingFixtures } = require('../data');
const scheduler = require('../broadcast/scheduler');

describe('broadcast live updates', () => {
  let client;

  beforeEach(() => {
    client = {
      chat: {
        postMessage: jest.fn().mockResolvedValue({ ts: '1234567890.123456' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    scheduler.reset();
  });

  afterEach(() => {
    scheduler.stop();
  });

  describe('updateCard', () => {
    test('updates card when messageTs exists', async () => {
      // Simulate a posted card
      scheduler.matchMessages.set(1, '1234567890.123456');

      await scheduler.updateCard(client, 1, { home: 2, away: 1 }, 67);

      expect(client.chat.update).toHaveBeenCalledTimes(1);
      expect(client.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C-test-channel',
          ts: '1234567890.123456',
        }),
      );
    });

    test('does nothing when no messageTs for match', async () => {
      await scheduler.updateCard(client, 999, { home: 1, away: 0 }, 45);

      expect(client.chat.update).not.toHaveBeenCalled();
    });

    test('removes stale ts on message_not_found error', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const error = new Error('message_not_found');
      error.data = { error: 'message_not_found' };
      client.chat.update.mockRejectedValueOnce(error);

      await scheduler.updateCard(client, 1, { home: 1, away: 0 }, 30);

      expect(scheduler.matchMessages.has(1)).toBe(false);
    });

    test('preserves metadata (matchId + persona) on chat.update', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      scheduler.matchPersonas.set(1, 'funny');

      await scheduler.updateCard(client, 1, { home: 2, away: 1 }, 67);

      expect(client.chat.update).toHaveBeenCalledTimes(1);
      const call = client.chat.update.mock.calls[0][0];
      expect(call.metadata).toEqual({
        event_type: 'worldcup_match',
        event_payload: { matchId: 1, persona: 'funny' },
      });
    });

    test('passes persona as null in metadata when not in matchPersonas', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      // No matchPersonas entry (legacy/restart scenario)

      await scheduler.updateCard(client, 1, { home: 1, away: 0 }, 45);

      const call = client.chat.update.mock.calls[0][0];
      expect(call.metadata.event_payload.persona).toBeNull();
    });
  });

  describe('postEventAlert', () => {
    test('posts goal alert to thread', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const event = {
        type: 'Goal',
        minute: 23,
        extraMinute: null,
        playerName: 'J. Quinones',
        assistPlayerName: 'E. Lira',
        detail: 'Normal Goal',
      };
      const score = { home: 1, away: 0 };

      await scheduler.postEventAlert(client, 1, event, score, Date.now());

      expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C-test-channel',
          thread_ts: '1234567890.123456',
        }),
      );
    });

    test('drops stale event (>30s old)', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const event = {
        type: 'Goal',
        minute: 23,
        extraMinute: null,
        playerName: 'Late Goal',
        assistPlayerName: null,
        detail: 'Normal Goal',
      };

      const staleTime = Date.now() - 31000;
      await scheduler.postEventAlert(client, 1, event, { home: 1, away: 0 }, staleTime);

      expect(client.chat.postMessage).not.toHaveBeenCalled();
    });

    test('posts initial card when no prior card exists (with persona)', async () => {
      const event = {
        type: 'Goal',
        minute: 10,
        extraMinute: null,
        playerName: 'Early Scorer',
        assistPlayerName: null,
        detail: 'Normal Goal',
      };

      await scheduler.postEventAlert(client, 1, event, { home: 1, away: 0 }, Date.now());

      // First call: initial live card, second call: event alert in thread
      expect(client.chat.postMessage).toHaveBeenCalledTimes(2);
      // First call should have metadata with persona
      const metadata = client.chat.postMessage.mock.calls[0][0].metadata;
      expect(metadata.event_payload.matchId).toBe(1);
      expect(['sporty', 'funny', 'serious']).toContain(metadata.event_payload.persona);
      // Should store persona
      expect(scheduler.matchPersonas.get(1)).toBe(metadata.event_payload.persona);
      // Second call should be in thread
      expect(client.chat.postMessage.mock.calls[1][0]).toHaveProperty('thread_ts');
    });

    test('posts card alert to thread', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const event = {
        type: 'Card',
        minute: 45,
        extraMinute: null,
        playerName: 'Rough Player',
        detail: 'Yellow Card',
      };

      await scheduler.postEventAlert(client, 1, event, { home: 0, away: 0 }, Date.now());

      expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
      const text = client.chat.postMessage.mock.calls[0][0].blocks[0].text.text;
      expect(text).toContain('Yellow Card');
    });

    test('posts sub alert to thread', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const event = {
        type: 'subst',
        minute: 60,
        extraMinute: null,
        playerName: 'Off Player',
        assistPlayerName: 'On Player',
      };

      await scheduler.postEventAlert(client, 1, event, { home: 1, away: 1 }, Date.now());

      expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
      const text = client.chat.postMessage.mock.calls[0][0].blocks[0].text.text;
      expect(text).toContain('Sub');
    });

    test('posts VAR alert to thread', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const event = {
        type: 'Var',
        minute: 67,
        extraMinute: null,
        playerName: 'Scorer',
        detail: 'Goal cancelled',
      };

      await scheduler.postEventAlert(client, 1, event, { home: 1, away: 0 }, Date.now());

      expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
      const text = client.chat.postMessage.mock.calls[0][0].blocks[0].text.text;
      expect(text).toContain('VAR');
      expect(text).toContain('Goal cancelled');
    });

    test('posts missed penalty alert (not a goal)', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const event = {
        type: 'Goal',
        minute: 55,
        extraMinute: null,
        playerName: 'Penalty Taker',
        assistPlayerName: null,
        detail: 'Missed Penalty',
      };

      await scheduler.postEventAlert(client, 1, event, { home: 0, away: 0 }, Date.now());

      expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
      const text = client.chat.postMessage.mock.calls[0][0].blocks[0].text.text;
      expect(text).toContain('Missed Penalty');
      expect(text).not.toContain('Goal!');
    });

    test('skips unknown event types', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const event = {
        type: 'Unknown',
        minute: 70,
        extraMinute: null,
        playerName: 'Some Player',
      };

      await scheduler.postEventAlert(client, 1, event, { home: 1, away: 0 }, Date.now());

      expect(client.chat.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('incomplete event filtering', () => {
    test('filters Goal with playerName null', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const event = { type: 'Goal', minute: 23, playerName: null, detail: 'Normal Goal' };

      await scheduler.postEventAlert(client, 1, event, { home: 1, away: 0 }, Date.now());

      expect(client.chat.postMessage).not.toHaveBeenCalled();
    });

    test('filters Goal with playerName empty string', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const event = { type: 'Goal', minute: 23, playerName: '', detail: 'Normal Goal' };

      await scheduler.postEventAlert(client, 1, event, { home: 1, away: 0 }, Date.now());

      expect(client.chat.postMessage).not.toHaveBeenCalled();
    });

    test('filters Goal with playerName Unknown (mixed case)', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const event = { type: 'Goal', minute: 23, playerName: 'Unknown', detail: 'Normal Goal' };

      await scheduler.postEventAlert(client, 1, event, { home: 1, away: 0 }, Date.now());

      expect(client.chat.postMessage).not.toHaveBeenCalled();
    });

    test('filters Goal with playerName UNKNOWN (upper case)', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const event = { type: 'Goal', minute: 23, playerName: 'UNKNOWN', detail: 'Normal Goal' };

      await scheduler.postEventAlert(client, 1, event, { home: 1, away: 0 }, Date.now());

      expect(client.chat.postMessage).not.toHaveBeenCalled();
    });

    test('filters Card with playerName undefined', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const event = { type: 'Card', minute: 30, playerName: undefined, detail: 'Yellow Card' };

      await scheduler.postEventAlert(client, 1, event, { home: 0, away: 0 }, Date.now());

      expect(client.chat.postMessage).not.toHaveBeenCalled();
    });

    test('filters subst with playerName whitespace only', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const event = { type: 'subst', minute: 60, playerName: '  ', assistPlayerName: 'On Player' };

      await scheduler.postEventAlert(client, 1, event, { home: 1, away: 1 }, Date.now());

      expect(client.chat.postMessage).not.toHaveBeenCalled();
    });

    test('allows Var event without playerName (bypasses filter)', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const event = { type: 'Var', minute: 67, playerName: null, detail: 'Goal cancelled' };

      await scheduler.postEventAlert(client, 1, event, { home: 1, away: 0 }, Date.now());

      expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    });

    test('allows Goal with valid playerName (baseline)', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const event = {
        type: 'Goal',
        minute: 23,
        playerName: 'Messi',
        assistPlayerName: null,
        detail: 'Normal Goal',
      };

      await scheduler.postEventAlert(client, 1, event, { home: 1, away: 0 }, Date.now());

      expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    });

    test('filters Missed Penalty with playerName null', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');
      const event = { type: 'Goal', minute: 55, playerName: null, detail: 'Missed Penalty' };

      await scheduler.postEventAlert(client, 1, event, { home: 0, away: 0 }, Date.now());

      expect(client.chat.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('handleDiffs', () => {
    test('updates card on score change', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');

      const diffs = [
        {
          fixtureId: 1,
          newEvents: [],
          currentScore: { home: 2, away: 1 },
          previousScore: { home: 1, away: 1 },
          scoreChanged: true,
        },
      ];

      await scheduler.handleDiffs(client, diffs);

      expect(client.chat.update).toHaveBeenCalledTimes(1);
    });

    test('posts event alerts for new events', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');

      const diffs = [
        {
          fixtureId: 1,
          newEvents: [
            {
              type: 'Goal',
              minute: 55,
              extraMinute: null,
              playerName: 'Scorer',
              assistPlayerName: null,
              detail: 'Normal Goal',
            },
          ],
          currentScore: { home: 2, away: 0 },
          previousScore: { home: 1, away: 0 },
          scoreChanged: true,
        },
      ];

      await scheduler.handleDiffs(client, diffs);

      // card update + event alert
      expect(client.chat.update).toHaveBeenCalledTimes(1);
      expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    });

    test('handles multiple events sequentially', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');

      const diffs = [
        {
          fixtureId: 1,
          newEvents: [
            {
              type: 'Goal',
              minute: 45,
              extraMinute: null,
              playerName: 'A',
              assistPlayerName: null,
              detail: 'Normal Goal',
            },
            {
              type: 'Goal',
              minute: 47,
              extraMinute: null,
              playerName: 'B',
              assistPlayerName: null,
              detail: 'Normal Goal',
            },
          ],
          currentScore: { home: 3, away: 0 },
          previousScore: { home: 1, away: 0 },
          scoreChanged: true,
        },
      ];

      await scheduler.handleDiffs(client, diffs);

      // card update + 2 event alerts
      expect(client.chat.update).toHaveBeenCalledTimes(1);
      expect(client.chat.postMessage).toHaveBeenCalledTimes(2);
    });

    test('first poll after restart with no prior card posts new card', async () => {
      // No matchMessages entry - simulates restart
      const diffs = [
        {
          fixtureId: 1,
          newEvents: [
            {
              type: 'Goal',
              minute: 30,
              extraMinute: null,
              playerName: 'Scorer',
              assistPlayerName: null,
              detail: 'Normal Goal',
            },
          ],
          currentScore: { home: 1, away: 0 },
          previousScore: { home: 0, away: 0 },
          scoreChanged: true,
        },
      ];

      await scheduler.handleDiffs(client, diffs);

      // updateCard does nothing (no ts), then postEventAlert posts initial card + alert
      expect(client.chat.postMessage).toHaveBeenCalledTimes(2);
      // First call should be the initial live card with metadata
      expect(client.chat.postMessage.mock.calls[0][0].metadata.event_payload.matchId).toBe(1);
    });

    test('initial diff flips the pre-match card to the live card without a score/elapsed change', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');

      const diffs = [
        {
          fixtureId: 1,
          newEvents: [],
          currentScore: { home: 0, away: 0 },
          previousScore: { home: 0, away: 0 },
          scoreChanged: false,
          elapsedChanged: false,
          elapsed: 1,
          initial: true,
        },
      ];

      await scheduler.handleDiffs(client, diffs);

      expect(client.chat.update).toHaveBeenCalledTimes(1);
      expect(client.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'C-test-channel', ts: '1234567890.123456' }),
      );
      expect(client.chat.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('handleDiffs elapsed refresh', () => {
    test('calls updateCard when elapsedChanged is true and scoreChanged is false', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');

      const diffs = [
        {
          fixtureId: 1,
          newEvents: [],
          currentScore: { home: 1, away: 0 },
          previousScore: { home: 1, away: 0 },
          scoreChanged: false,
          elapsedChanged: true,
          elapsed: 67,
        },
      ];

      await scheduler.handleDiffs(client, diffs);

      expect(client.chat.update).toHaveBeenCalledTimes(1);
      expect(client.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C-test-channel',
          ts: '1234567890.123456',
        }),
      );
    });

    test('does NOT call updateCard when both elapsedChanged and scoreChanged are false', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');

      const diffs = [
        {
          fixtureId: 1,
          newEvents: [{ type: 'Goal', minute: 55, playerName: 'Scorer', detail: 'Normal Goal' }],
          currentScore: { home: 1, away: 0 },
          previousScore: { home: 1, away: 0 },
          scoreChanged: false,
          elapsedChanged: false,
          elapsed: 55,
        },
      ];

      await scheduler.handleDiffs(client, diffs);

      expect(client.chat.update).not.toHaveBeenCalled();
      // But event alert still posts
      expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    });

    test('passes elapsed value from diff to updateCard', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');

      const diffs = [
        {
          fixtureId: 1,
          newEvents: [],
          currentScore: { home: 2, away: 1 },
          previousScore: { home: 2, away: 1 },
          scoreChanged: false,
          elapsedChanged: true,
          elapsed: 89,
        },
      ];

      await scheduler.handleDiffs(client, diffs);

      expect(client.chat.update).toHaveBeenCalledTimes(1);
      // formatLiveCard receives elapsed as third arg - verify it was called with correct score
      const updateCall = client.chat.update.mock.calls[0][0];
      expect(updateCall.text).toContain('2-1');
    });
  });

  describe('handleDiffs match-end', () => {
    test('matchEnded diff with scoreChanged triggers updateCard', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');

      const diffs = [
        {
          fixtureId: 1,
          newEvents: [],
          currentScore: { home: 2, away: 1 },
          previousScore: { home: 2, away: 1 },
          scoreChanged: true,
          elapsedChanged: false,
          elapsed: null,
          matchEnded: true,
        },
      ];

      await scheduler.handleDiffs(client, diffs);

      expect(client.chat.update).toHaveBeenCalledTimes(1);
      expect(client.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C-test-channel',
          ts: '1234567890.123456',
        }),
      );
    });

    test('matchEnded diff does not re-post events (already broadcast during live phase)', async () => {
      scheduler.matchMessages.set(1, '1234567890.123456');

      const diffs = [
        {
          fixtureId: 1,
          newEvents: [],
          currentScore: { home: 2, away: 1 },
          previousScore: { home: 2, away: 1 },
          scoreChanged: true,
          elapsedChanged: false,
          elapsed: null,
          matchEnded: true,
        },
      ];

      await scheduler.handleDiffs(client, diffs);

      // Only card update, no event alerts (events were already posted during live phase)
      expect(client.chat.update).toHaveBeenCalledTimes(1);
      expect(client.chat.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('tick with metadata', () => {
    test('posts card with message metadata including persona', async () => {
      const now = Date.now();
      const tenMinFromNow = new Date(now + 10 * 60_000).toISOString();
      getUpcomingFixtures.mockReturnValue([
        { id: 1, teams: { homeTeamId: 'USA', awayTeamId: 'MEX' }, dateAndTimeInUTC: tenMinFromNow },
      ]);

      await scheduler.tick(client);

      expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
      const call = client.chat.postMessage.mock.calls[0][0];
      expect(call.metadata.event_type).toBe('worldcup_match');
      expect(call.metadata.event_payload.matchId).toBe(1);
      expect(['sporty', 'funny', 'serious']).toContain(call.metadata.event_payload.persona);
      // Should store ts and persona
      expect(scheduler.matchMessages.get(1)).toBe('1234567890.123456');
      expect(scheduler.matchPersonas.get(1)).toBe(call.metadata.event_payload.persona);
    });
  });
});
