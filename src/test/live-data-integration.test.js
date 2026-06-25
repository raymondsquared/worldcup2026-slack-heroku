'use strict';

process.env.FOOTBALL_API_KEY = 'test-api-key';

jest.mock('../live-data/api', () => ({
  fetchLiveFixtures: jest.fn(),
  fetchFixturesByDate: jest.fn(),
}));

const { fetchLiveFixtures, fetchFixturesByDate } = require('../live-data/api');
const cache = require('../live-data/cache');
const poller = require('../live-data/poller');

// Flush all pending promises (multiple ticks to drain microtask queue)
async function flush() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

// Advance timers and flush async
async function tick(ms) {
  jest.advanceTimersByTime(ms);
  await flush();
}

// Sample API response builders
function liveFixtureResponse(goals = { home: 1, away: 0 }, events = []) {
  return {
    response: [
      {
        fixture: {
          id: 1489369,
          status: { long: 'Second Half', elapsed: 67 },
        },
        league: { name: 'World Cup' },
        goals,
        score: {
          halftime: { home: 1, away: 0 },
          fulltime: { home: null, away: null },
          extratime: { home: null, away: null },
          penalty: { home: null, away: null },
        },
        events,
      },
    ],
  };
}

function todayHasLiveMatch() {
  return {
    response: [
      {
        fixture: {
          id: 1489369,
          status: { long: 'Second Half', elapsed: 55 },
        },
        league: { name: 'World Cup' },
        goals: { home: 0, away: 0 },
        score: {
          halftime: { home: 0, away: 0 },
          fulltime: { home: null, away: null },
          extratime: { home: null, away: null },
          penalty: { home: null, away: null },
        },
      },
    ],
  };
}

function todayNoLiveMatch() {
  return {
    response: [
      {
        fixture: {
          id: 1489369,
          status: { long: 'Not Started', elapsed: null },
        },
        league: { name: 'World Cup' },
        goals: { home: null, away: null },
        score: {
          halftime: { home: null, away: null },
          fulltime: { home: null, away: null },
          extratime: { home: null, away: null },
          penalty: { home: null, away: null },
        },
      },
    ],
  };
}

const goalEvent = {
  type: 'Goal',
  time: { elapsed: 23, extra: null },
  team: { id: 16 },
  player: { id: 35532, name: 'J. Quinones' },
  assist: { id: 266345, name: 'E. Lira' },
  detail: 'Normal Goal',
  comments: null,
};

describe('Live data integration flow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    cache.clear();
    fetchLiveFixtures.mockReset();
    fetchFixturesByDate.mockReset();
  });

  afterEach(() => {
    poller.stop();
    const { setLiveCache } = require('../data');
    setLiveCache(null);
    jest.useRealTimers();
  });

  test('start -> passive mode, no live matches stays passive', async () => {
    fetchFixturesByDate.mockResolvedValue(todayNoLiveMatch());

    poller.start();
    await flush();

    expect(poller.getStatus().mode).toBe('passive');
    expect(fetchFixturesByDate).toHaveBeenCalledTimes(1);
    expect(cache.getStats().size).toBe(0);
  });

  test('passive -> active when live match found, populates cache', async () => {
    fetchFixturesByDate.mockResolvedValue(todayHasLiveMatch());
    fetchLiveFixtures.mockResolvedValue(liveFixtureResponse({ home: 1, away: 0 }, [goalEvent]));

    poller.start();
    // Passive check fires immediately, resolves, switches to active, schedules poll at 0ms
    await flush();
    // Fire the 0ms timeout
    await tick(1);

    expect(poller.getStatus().mode).toBe('active');
    expect(fetchLiveFixtures).toHaveBeenCalledTimes(1);

    const cached = cache.getFixture(1);
    expect(cached).not.toBeNull();
    expect(cached.status).toBe('Second Half');
    expect(cached.elapsed).toBe(67);
    expect(cached.finalScore).toEqual({ home: 1, away: 0 });
    expect(cached.events).toHaveLength(1);
    expect(cached.events[0].playerName).toBe('J. Quinones');
  });

  test('active -> passive when no WC matches in response', async () => {
    fetchFixturesByDate.mockResolvedValue(todayHasLiveMatch());
    fetchLiveFixtures
      .mockResolvedValueOnce(liveFixtureResponse())
      .mockResolvedValueOnce({ response: [] });

    poller.start();
    await flush();
    await tick(1);
    expect(poller.getStatus().mode).toBe('active');

    // Next poll at 15s returns empty
    await tick(15000);

    expect(poller.getStatus().mode).toBe('passive');
  });

  test('API failure triggers backoff, success recovers to 15s', async () => {
    fetchFixturesByDate.mockResolvedValue(todayHasLiveMatch());
    fetchLiveFixtures
      .mockResolvedValueOnce(liveFixtureResponse())
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(liveFixtureResponse({ home: 2, away: 0 }));

    poller.start();
    await flush();
    await tick(1);
    expect(cache.getStats().failureCount).toBe(0);

    // 15s -> poll fails
    await tick(15000);
    expect(cache.getStats().failureCount).toBe(1);

    // 30s backoff -> poll succeeds -> reset
    await tick(30000);
    expect(cache.getStats().failureCount).toBe(0);
    expect(cache.getFixture(1).finalScore).toEqual({ home: 2, away: 0 });
  });

  test('5 consecutive failures -> passive mode, cache marked stale', async () => {
    fetchFixturesByDate.mockResolvedValueOnce(todayHasLiveMatch());
    fetchLiveFixtures
      .mockResolvedValueOnce(liveFixtureResponse())
      .mockRejectedValue(new Error('down'));

    poller.start();
    await flush();
    await tick(1);
    expect(poller.getStatus().mode).toBe('active');

    await tick(15000); // fail 1
    expect(cache.getStats().failureCount).toBe(1);

    await tick(30000); // fail 2
    expect(cache.getStats().failureCount).toBe(2);

    await tick(60000); // fail 3
    expect(cache.getStats().failureCount).toBe(3);

    await tick(120000); // fail 4
    expect(cache.getStats().failureCount).toBe(4);

    await tick(120000); // fail 5 -> passive
    expect(poller.getStatus().mode).toBe('passive');
    expect(cache.getStats().isStale).toBe(true);
  });

  test('multiple live matches cached independently', async () => {
    fetchFixturesByDate.mockResolvedValue(todayHasLiveMatch());
    fetchLiveFixtures.mockResolvedValue({
      response: [
        {
          fixture: { id: 1489369, status: { long: 'Second Half', elapsed: 78 } },
          league: { name: 'World Cup' },
          goals: { home: 2, away: 1 },
          score: {
            halftime: { home: 1, away: 0 },
            fulltime: { home: null, away: null },
            extratime: { home: null, away: null },
            penalty: { home: null, away: null },
          },
          events: [],
        },
        {
          fixture: { id: 1538999, status: { long: 'First Half', elapsed: 30 } },
          league: { name: 'World Cup' },
          goals: { home: 0, away: 0 },
          score: {
            halftime: { home: null, away: null },
            fulltime: { home: null, away: null },
            extratime: { home: null, away: null },
            penalty: { home: null, away: null },
          },
          events: [],
        },
      ],
    });

    poller.start();
    await flush();
    await tick(1);

    expect(cache.getStats().size).toBe(2);
    expect(cache.getFixture(1).finalScore).toEqual({ home: 2, away: 1 });
    expect(cache.getFixture(2).finalScore).toEqual({ home: 0, away: 0 });
  });

  test('non-WC fixtures filtered out', async () => {
    fetchFixturesByDate.mockResolvedValue(todayHasLiveMatch());
    fetchLiveFixtures.mockResolvedValue({
      response: [
        {
          fixture: { id: 1489369, status: { long: 'Second Half', elapsed: 60 } },
          league: { name: 'World Cup' },
          goals: { home: 1, away: 0 },
          score: {
            halftime: { home: 0, away: 0 },
            fulltime: { home: null, away: null },
            extratime: { home: null, away: null },
            penalty: { home: null, away: null },
          },
          events: [],
        },
        {
          fixture: { id: 9999999, status: { long: 'Second Half', elapsed: 55 } },
          league: { name: 'Premier League' },
          goals: { home: 3, away: 2 },
          score: {
            halftime: { home: 1, away: 1 },
            fulltime: { home: null, away: null },
            extratime: { home: null, away: null },
            penalty: { home: null, away: null },
          },
          events: [],
        },
      ],
    });

    poller.start();
    await flush();
    await tick(1);

    expect(cache.getStats().size).toBe(1);
    expect(cache.getFixture(1)).not.toBeNull();
  });

  test('end-to-end: poller -> cache -> data layer', async () => {
    const { getLiveScore, getFixtureEvents, setLiveCache } = require('../data');
    setLiveCache(cache);

    fetchFixturesByDate.mockResolvedValue(todayHasLiveMatch());
    fetchLiveFixtures.mockResolvedValue(liveFixtureResponse({ home: 3, away: 1 }, [goalEvent]));

    poller.start();
    await flush();
    await tick(1);

    const score = getLiveScore(1);
    expect(score.status).toBe('Second Half');
    expect(score.elapsed).toBe(67);
    expect(score.home).toBe(3);
    expect(score.away).toBe(1);

    const events = getFixtureEvents(1);
    expect(events).toHaveLength(1);
    expect(events[0].playerName).toBe('J. Quinones');
  });
});
