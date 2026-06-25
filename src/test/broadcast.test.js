'use strict';

process.env.BROADCAST_CHANNEL_ID = 'C-test-channel';

const { tick, buildFixtureCard, posted, stop, reset } = require('../broadcast/scheduler');
const { getUpcomingFixtures } = require('../data');

jest.mock('../data', () => {
  const actual = jest.requireActual('../data');
  return { ...actual, getUpcomingFixtures: jest.fn() };
});

describe('broadcast - buildFixtureCard', () => {
  test('returns 3-block layout with team names, flags, and kickoff time', () => {
    const fixture = {
      id: 1,
      teams: { homeTeamId: 'USA', awayTeamId: 'MEX' },
      dateAndTimeInUTC: '2026-06-17T18:00:00Z',
    };
    const blocks = buildFixtureCard(fixture);

    expect(blocks).toHaveLength(3);
    expect(blocks[0].text.text).toBe('Fixture Starting Soon!');
    const section = blocks[1].text.text;
    expect(section).toContain('USA');
    expect(section).toContain('Mexico');
    const context = blocks[2].elements[0].text;
    expect(context).toMatch(/<!date\^\d+\^/);
  });
});

describe('broadcast - tick', () => {
  let client;

  beforeEach(() => {
    client = { chat: { postMessage: jest.fn().mockResolvedValue({}) } };
    reset();
  });

  afterEach(() => {
    stop();
  });

  test('posts card for fixture within 15-minute window', async () => {
    const now = Date.now();
    const tenMinFromNow = new Date(now + 10 * 60_000).toISOString();
    getUpcomingFixtures.mockReturnValue([
      { id: 1, teams: { homeTeamId: 'USA', awayTeamId: 'MEX' }, dateAndTimeInUTC: tenMinFromNow },
    ]);

    await tick(client);

    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C-test-channel' }),
    );
  });

  test('skips fixture outside 15-minute window', async () => {
    const now = Date.now();
    const twentyMinFromNow = new Date(now + 20 * 60_000).toISOString();
    getUpcomingFixtures.mockReturnValue([
      {
        id: 2,
        teams: { homeTeamId: 'BRA', awayTeamId: 'GER' },
        dateAndTimeInUTC: twentyMinFromNow,
      },
    ]);

    await tick(client);

    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  test('skips fixture already started', async () => {
    const now = Date.now();
    const fiveMinAgo = new Date(now - 5 * 60_000).toISOString();
    getUpcomingFixtures.mockReturnValue([
      { id: 3, teams: { homeTeamId: 'ARG', awayTeamId: 'FRA' }, dateAndTimeInUTC: fiveMinAgo },
    ]);

    await tick(client);

    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  test('does not post duplicate for same fixture', async () => {
    const now = Date.now();
    const tenMinFromNow = new Date(now + 10 * 60_000).toISOString();
    getUpcomingFixtures.mockReturnValue([
      { id: 4, teams: { homeTeamId: 'ENG', awayTeamId: 'ESP' }, dateAndTimeInUTC: tenMinFromNow },
    ]);

    await tick(client);
    await tick(client);

    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
  });

  test('does not mark fixture as posted on postMessage failure', async () => {
    const now = Date.now();
    const tenMinFromNow = new Date(now + 10 * 60_000).toISOString();
    getUpcomingFixtures.mockReturnValue([
      { id: 5, teams: { homeTeamId: 'ITA', awayTeamId: 'URU' }, dateAndTimeInUTC: tenMinFromNow },
    ]);
    client.chat.postMessage.mockRejectedValueOnce(new Error('network error'));

    await tick(client);

    expect(posted.has(5)).toBe(false);

    // Retry succeeds
    client.chat.postMessage.mockResolvedValueOnce({});
    await tick(client);

    expect(posted.has(5)).toBe(true);
  });
});
