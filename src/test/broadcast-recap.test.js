'use strict';

process.env.BROADCAST_CHANNEL_ID = 'C-test-channel';
process.env.INFERENCE_URL = 'https://test-mia.heroku.com';
process.env.INFERENCE_MODEL_ID = 'test-model';
process.env.INFERENCE_KEY = 'test-key';

jest.mock('../data', () => ({
  getFixtureById: jest.fn(),
  getTeamName: jest.fn((id) => {
    const names = { 1: 'USA', 2: 'Mexico', 3: 'Brazil', 4: 'Argentina' };
    return names[id] || null;
  }),
}));

jest.mock('../live-data/cache', () => ({
  getFixture: jest.fn(),
}));

const { getFixtureById } = require('../data');
const cache = require('../live-data/cache');
const { getFlag } = require('../broadcast/flags');
const { buildRecapContext, buildRecapBlocks, generateRecap } = require('../broadcast/recap');

describe('broadcast/recap - buildRecapContext', () => {
  const fixture = {
    id: 1,
    teams: { homeTeamId: 1, awayTeamId: 2 },
  };

  test('formats goals correctly', () => {
    const liveData = {
      finalScore: { home: 2, away: 1 },
      status: 'Match Finished',
      events: [
        {
          type: 'Goal',
          minute: 23,
          extraMinute: null,
          playerName: 'Pulisic',
          teamId: 1,
          detail: 'Normal Goal',
        },
        {
          type: 'Goal',
          minute: 67,
          extraMinute: null,
          playerName: 'McKennie',
          teamId: 1,
          detail: 'Normal Goal',
        },
        {
          type: 'Goal',
          minute: 45,
          extraMinute: null,
          playerName: 'Lozano',
          teamId: 2,
          detail: 'Normal Goal',
        },
      ],
    };

    const context = buildRecapContext(liveData, fixture);

    expect(context).toContain('USA 2-1 Mexico');
    expect(context).toContain("Pulisic 23' (USA)");
    expect(context).toContain("McKennie 67' (USA)");
    expect(context).toContain("Lozano 45' (Mexico)");
    expect(context).toContain('Match Summary:');
    expect(context).toContain('===');
  });

  test('formats cards correctly', () => {
    const liveData = {
      finalScore: { home: 1, away: 0 },
      status: 'Match Finished',
      events: [
        {
          type: 'Card',
          minute: 55,
          extraMinute: null,
          playerName: 'Dest',
          teamId: 1,
          detail: 'Yellow Card',
        },
        {
          type: 'Card',
          minute: 78,
          extraMinute: null,
          playerName: 'Alvarez',
          teamId: 2,
          detail: 'Red Card',
        },
      ],
    };

    const context = buildRecapContext(liveData, fixture);

    expect(context).toContain("Dest Yellow Card 55' (USA)");
    expect(context).toContain("Alvarez Red Card 78' (Mexico)");
  });

  test('formats substitutions correctly', () => {
    const liveData = {
      finalScore: { home: 1, away: 0 },
      status: 'Match Finished',
      events: [
        {
          type: 'subst',
          minute: 60,
          extraMinute: null,
          playerName: 'Weah',
          assistPlayerName: 'Reyna',
          teamId: 1,
          detail: 'Substitution 1',
        },
      ],
    };

    const context = buildRecapContext(liveData, fixture);

    expect(context).toContain("Reyna -> Weah 60' (USA)");
  });

  test('includes statistics when available', () => {
    const liveData = {
      finalScore: { home: 2, away: 0 },
      status: 'Match Finished',
      events: [],
      statistics: [
        {
          teamId: 1,
          statistics: [
            { type: 'Ball Possession', value: '55%' },
            { type: 'Shots on Target', value: 6 },
          ],
        },
        {
          teamId: 2,
          statistics: [
            { type: 'Ball Possession', value: '45%' },
            { type: 'Shots on Target', value: 4 },
          ],
        },
      ],
    };

    const context = buildRecapContext(liveData, fixture);

    expect(context).toContain('USA: Ball Possession: 55%, Shots on Target: 6');
    expect(context).toContain('Mexico: Ball Possession: 45%, Shots on Target: 4');
  });

  test('handles empty events gracefully', () => {
    const liveData = {
      finalScore: { home: 0, away: 0 },
      status: 'Match Finished',
      events: [],
    };

    const context = buildRecapContext(liveData, fixture);

    expect(context).toContain('USA 0-0 Mexico');
    expect(context).toContain('Goals: None');
    expect(context).toContain('Statistics: not available.');
    expect(context).not.toContain('undefined');
  });

  test('handles own goals and penalties', () => {
    const liveData = {
      finalScore: { home: 3, away: 1 },
      status: 'Match Finished',
      events: [
        {
          type: 'Goal',
          minute: 10,
          extraMinute: null,
          playerName: 'Pulisic',
          teamId: 1,
          detail: 'Normal Goal',
        },
        {
          type: 'Goal',
          minute: 45,
          extraMinute: null,
          playerName: 'Alvarez',
          teamId: 2,
          detail: 'Own Goal',
        },
        {
          type: 'Goal',
          minute: 67,
          extraMinute: null,
          playerName: 'McKennie',
          teamId: 1,
          detail: 'Penalty',
        },
        {
          type: 'Goal',
          minute: 80,
          extraMinute: null,
          playerName: 'Lozano',
          teamId: 2,
          detail: 'Missed Penalty',
        },
      ],
    };

    const context = buildRecapContext(liveData, fixture);

    expect(context).toContain("Pulisic 10' (USA)");
    expect(context).toContain("Alvarez 45' (Mexico, Own Goal)");
    expect(context).toContain("McKennie 67' (USA, Penalty)");
    expect(context).toContain("Lozano 80' (Mexico, Missed Penalty)");
  });

  test('handles extra time minutes', () => {
    const liveData = {
      finalScore: { home: 1, away: 0 },
      status: 'Match Finished',
      events: [
        {
          type: 'Goal',
          minute: 90,
          extraMinute: 3,
          playerName: 'Pulisic',
          teamId: 1,
          detail: 'Normal Goal',
        },
      ],
    };

    const context = buildRecapContext(liveData, fixture);

    expect(context).toContain("Pulisic 90+3' (USA)");
  });
});

describe('broadcast/recap - buildRecapBlocks', () => {
  const fixture = {
    id: 1,
    teams: { homeTeamId: 1, awayTeamId: 2 },
    stage: 'Group Stage',
    group: 'Group A',
  };

  test('builds header, score, scorers, meta, divider, and recap in order', () => {
    const liveData = {
      finalScore: { home: 2, away: 1 },
      events: [
        {
          type: 'Goal',
          minute: 23,
          extraMinute: null,
          playerName: 'Pulisic',
          teamId: 1,
          detail: 'Normal Goal',
        },
        {
          type: 'Goal',
          minute: 67,
          extraMinute: null,
          playerName: 'McKennie',
          teamId: 1,
          detail: 'Normal Goal',
        },
        {
          type: 'Goal',
          minute: 45,
          extraMinute: null,
          playerName: 'Lozano',
          teamId: 2,
          detail: 'Normal Goal',
        },
      ],
    };

    const blocks = buildRecapBlocks(fixture, liveData, 'A thrilling 2-1 win.');

    // Ordered block contract: header -> score -> scorers -> meta -> divider -> recap
    expect(blocks.map((b) => b.type)).toEqual([
      'header',
      'section',
      'context',
      'context',
      'divider',
      'section',
    ]);

    expect(blocks[0].text.text).toContain('Full Time');

    // Score section carries both team names, the score, and both flags.
    const scoreLine = blocks[1].text.text;
    expect(scoreLine).toContain('USA');
    expect(scoreLine).toContain('Mexico');
    expect(scoreLine).toContain('2 - 1');
    expect(scoreLine).toContain(getFlag(1));
    expect(scoreLine).toContain(getFlag(2));

    // Scorers context: home scorers, then a separator, then away scorers.
    const scorers = blocks[2].elements[0].text;
    expect(scorers).toContain("Pulisic 23'");
    expect(scorers).toContain("McKennie 67'");
    expect(scorers).toContain("Lozano 45'");
    expect(scorers).toContain('·'); // both sides scored -> home/away split

    // Meta context: stage + group.
    expect(blocks[3].elements[0].text).toBe('Group Stage · Group A');

    // Recap text is passed through verbatim in the final section.
    expect(blocks[5].text.text).toBe('A thrilling 2-1 win.');
  });

  test('omits the scorers context when there were no goals (cards only)', () => {
    const liveData = {
      finalScore: { home: 0, away: 0 },
      events: [
        {
          type: 'Card',
          minute: 40,
          extraMinute: null,
          playerName: 'Dest',
          teamId: 1,
          detail: 'Yellow Card',
        },
      ],
    };

    const blocks = buildRecapBlocks(fixture, liveData, 'A goalless stalemate.');

    // No scorers context; the one context block is the meta line.
    expect(blocks.map((b) => b.type)).toEqual([
      'header',
      'section',
      'context',
      'divider',
      'section',
    ]);
    expect(blocks[2].elements[0].text).toBe('Group Stage · Group A');
  });

  test('omits the meta context when the fixture has no stage or group', () => {
    const bareFixture = { id: 1, teams: { homeTeamId: 1, awayTeamId: 2 } };
    const liveData = {
      finalScore: { home: 1, away: 0 },
      events: [
        {
          type: 'Goal',
          minute: 12,
          extraMinute: null,
          playerName: 'Pulisic',
          teamId: 1,
          detail: 'Normal Goal',
        },
      ],
    };

    const blocks = buildRecapBlocks(bareFixture, liveData, 'Late winner.');

    // Scorers context present, meta context absent.
    expect(blocks.map((b) => b.type)).toEqual([
      'header',
      'section',
      'context',
      'divider',
      'section',
    ]);
    expect(blocks[2].elements[0].text).toContain("Pulisic 12'");
  });

  test('produces only header, score, divider, recap when no goals and no meta', () => {
    const bareFixture = { id: 1, teams: { homeTeamId: 1, awayTeamId: 2 } };
    const liveData = { finalScore: { home: 0, away: 0 }, events: [] };

    const blocks = buildRecapBlocks(bareFixture, liveData, 'Forgettable.');

    expect(blocks.map((b) => b.type)).toEqual(['header', 'section', 'divider', 'section']);
  });

  test('marks own goals with (OG) and excludes missed penalties from scorers', () => {
    const liveData = {
      finalScore: { home: 1, away: 1 },
      events: [
        {
          type: 'Goal',
          minute: 30,
          extraMinute: null,
          playerName: 'Alvarez',
          teamId: 2,
          detail: 'Own Goal',
        },
        {
          type: 'Goal',
          minute: 70,
          extraMinute: null,
          playerName: 'Lozano',
          teamId: 2,
          detail: 'Normal Goal',
        },
        {
          type: 'Goal',
          minute: 85,
          extraMinute: null,
          playerName: 'Pulisic',
          teamId: 1,
          detail: 'Missed Penalty',
        },
      ],
    };

    const blocks = buildRecapBlocks(fixture, liveData, 'Own-goal drama.');
    const scorers = blocks[2].elements[0].text;

    expect(scorers).toContain('Alvarez (OG)');
    expect(scorers).toContain('Lozano');
    expect(scorers).not.toContain('Pulisic'); // missed penalty is not a scorer
  });

  test('renders extra-time minutes in the scorers line', () => {
    const liveData = {
      finalScore: { home: 1, away: 0 },
      events: [
        {
          type: 'Goal',
          minute: 90,
          extraMinute: 4,
          playerName: 'Pulisic',
          teamId: 1,
          detail: 'Normal Goal',
        },
      ],
    };

    const blocks = buildRecapBlocks(fixture, liveData, 'Stoppage-time winner.');
    expect(blocks[2].elements[0].text).toContain("Pulisic 90+4'");
  });

  test('falls back to Home/Away and 0-0 for unknown teams and missing finalScore', () => {
    const unknownFixture = { id: 9, teams: { homeTeamId: 99, awayTeamId: 98 } };
    const liveData = { events: [] }; // no finalScore

    const blocks = buildRecapBlocks(unknownFixture, liveData, 'Mystery match.');
    const scoreLine = blocks[1].text.text;

    expect(scoreLine).toContain('Home');
    expect(scoreLine).toContain('Away');
    expect(scoreLine).toContain('0 - 0');
  });
});

describe('broadcast/recap - generateRecap', () => {
  let client;

  beforeEach(() => {
    global.fetch = jest.fn();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    client = {
      chat: {
        postMessage: jest.fn().mockResolvedValue({}),
      },
    };

    getFixtureById.mockReturnValue({
      id: 1,
      teams: { homeTeamId: 1, awayTeamId: 2 },
    });
  });

  afterEach(() => {
    delete global.fetch;
    console.log.mockRestore();
    console.error.mockRestore();
  });

  test('posts recap as standalone channel message with Block Kit', async () => {
    cache.getFixture.mockReturnValue({
      finalScore: { home: 2, away: 1 },
      status: 'Match Finished',
      events: [
        {
          type: 'Goal',
          minute: 23,
          extraMinute: null,
          playerName: 'Pulisic',
          teamId: 1,
          detail: 'Normal Goal',
        },
      ],
    });

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'A thrilling match saw USA triumph 2-1.' } }],
      }),
    });

    await generateRecap(client, 1, null, 'sporty');

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C-test-channel',
        blocks: expect.any(Array),
        unfurl_links: false,
        unfurl_media: false,
      }),
    );

    // No thread_ts - standalone message
    const call = client.chat.postMessage.mock.calls[0][0];
    expect(call.thread_ts).toBeUndefined();

    // Blocks structure: header + score section + optional scorers + divider + recap text
    expect(call.blocks[0].type).toBe('header');
    expect(call.blocks[0].text.text).toContain('Full Time');
    expect(call.blocks[1].text.text).toContain('USA');
    expect(call.blocks[1].text.text).toContain('Mexico');
    expect(call.blocks[1].text.text).toContain('2 - 1');

    // Fallback text includes recap
    expect(call.text).toContain('A thrilling match saw USA triumph 2-1.');
  });

  test('uses persona system prompt', async () => {
    cache.getFixture.mockReturnValue({
      finalScore: { home: 1, away: 0 },
      status: 'Match Finished',
      events: [],
    });

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Tactical analysis recap.' } }],
      }),
    });

    await generateRecap(client, 1, '1234567890.123456', 'serious');

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('analytical');
    expect(body.messages[0].content).toContain('tactics');
  });

  test('uses default prompt when no persona', async () => {
    cache.getFixture.mockReturnValue({
      finalScore: { home: 1, away: 0 },
      status: 'Match Finished',
      events: [],
    });

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Match recap.' } }],
      }),
    });

    await generateRecap(client, 1, '1234567890.123456', null);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('football writer');
  });

  test('still works when threadTs is null (standalone post)', async () => {
    cache.getFixture.mockReturnValue({
      finalScore: { home: 1, away: 0 },
      status: 'Match Finished',
      events: [],
    });

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Quick recap.' } }],
      }),
    });

    await generateRecap(client, 1, null, 'sporty');

    expect(client.chat.postMessage).toHaveBeenCalled();
    const call = client.chat.postMessage.mock.calls[0][0];
    expect(call.thread_ts).toBeUndefined();
  });

  test('does nothing when no cache data', async () => {
    cache.getFixture.mockReturnValue(null);

    await generateRecap(client, 1, '1234567890.123456', 'sporty');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  test('skips when cache data is stale', async () => {
    cache.getFixture.mockReturnValue({
      finalScore: { home: 1, away: 0 },
      status: 'Match Finished',
      events: [],
      stale: true,
    });

    await generateRecap(client, 1, '1234567890.123456', 'sporty');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  test('skips posting when ask returns null (toxic output)', async () => {
    cache.getFixture.mockReturnValue({
      finalScore: { home: 1, away: 0 },
      status: 'Match Finished',
      events: [],
    });

    // Return toxic content that filterToxic will reject
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'You should harm yourself' } }],
      }),
    });

    await generateRecap(client, 1, '1234567890.123456', 'sporty');

    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  test('does nothing when fixture not found', async () => {
    cache.getFixture.mockReturnValue({
      finalScore: { home: 1, away: 0 },
      status: 'Match Finished',
      events: [],
    });
    getFixtureById.mockReturnValue(null);

    await generateRecap(client, 1, '1234567890.123456', 'sporty');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });
});
