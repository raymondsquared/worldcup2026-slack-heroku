'use strict';

process.env.FOOTBALL_API_KEY = 'test-api-key';

function makeApiFixture(externalId, status, goals = { home: 0, away: 0 }, events = []) {
  return {
    fixture: {
      id: externalId,
      status: { long: status, elapsed: 45 },
      date: '2026-06-11T19:00:00Z',
    },
    league: { name: 'FIFA World Cup 2026', round: 'Group Stage - 1' },
    teams: { home: { id: 100, name: 'Home' }, away: { id: 200, name: 'Away' } },
    goals,
    score: {
      halftime: { home: 0, away: 0 },
      fulltime: { home: null, away: null },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
    events,
  };
}

describe('Live data poller', () => {
  it('exports start, stop, and getStatus functions', () => {
    const poller = require('../live-data/poller');

    expect(typeof poller.start).toBe('function');
    expect(typeof poller.stop).toBe('function');
    expect(typeof poller.getStatus).toBe('function');
    poller.stop();
  });

  it('getStatus returns mode and cache stats', () => {
    const poller = require('../live-data/poller');
    const status = poller.getStatus();

    expect(status).toHaveProperty('mode');
    expect(status).toHaveProperty('cacheStats');
    expect(status.cacheStats).toHaveProperty('size');
    expect(status.cacheStats).toHaveProperty('failureCount');
    expect(status.cacheStats).toHaveProperty('isStale');
    poller.stop();
  });
});

describe('Match-end detection', () => {
  let pollerModule;
  let apiModule;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

    jest.mock('../live-data/api', () => ({
      fetchLiveFixtures: jest.fn(),
      fetchFixturesByDate: jest.fn(),
      fetchFixtureById: jest.fn(),
      fetchSquad: jest.fn(),
      fetchStandings: jest.fn(),
    }));

    jest.mock('../live-data/cache', () => ({
      updateFixtures: jest.fn(),
      getFixture: jest.fn(),
      recordFailure: jest.fn().mockReturnValue(15000),
      getStats: jest.fn().mockReturnValue({ size: 0, failureCount: 0, isStale: false }),
      clear: jest.fn(),
      markStale: jest.fn(),
    }));

    apiModule = require('../live-data/api');
    pollerModule = require('../live-data/poller');
  });

  afterEach(() => {
    pollerModule.stop();
    jest.useRealTimers();
  });

  // Sets up: passive check -> finds live -> active mode -> first poll seeds previousLiveIds
  async function startAndRunFirstActivePoll(liveFixture) {
    // Set up ALL mocks before start: passive check + first active poll
    apiModule.fetchFixturesByDate.mockResolvedValueOnce({
      response: [liveFixture],
    });
    apiModule.fetchLiveFixtures.mockResolvedValueOnce({
      response: [liveFixture],
    });

    pollerModule.start();
    // This flushes: checkForLiveMatches() -> switchToActiveMode() -> scheduleActivePoll(0)
    // -> pollLiveFixtures() (first active poll, seeds previousLiveIds)
    await jest.advanceTimersByTimeAsync(0);
  }

  describe('active mode - fixture disappears from live response', () => {
    test('calls fetchFixtureById when fixture disappears', async () => {
      const liveFixture = makeApiFixture(1489369, 'Second Half');

      await startAndRunFirstActivePoll(liveFixture);

      // Second active poll: fixture disappeared
      apiModule.fetchLiveFixtures.mockResolvedValueOnce({ response: [] });
      apiModule.fetchFixtureById.mockResolvedValueOnce({
        response: [makeApiFixture(1489369, 'Match Finished', { home: 2, away: 0 })],
      });

      await jest.advanceTimersByTimeAsync(15000);

      expect(apiModule.fetchFixtureById).toHaveBeenCalledWith(1489369);
    });

    test('emits matchEnded diff via callback', async () => {
      const liveFixture = makeApiFixture(1489369, 'Second Half');
      const callback = jest.fn();
      pollerModule.onChanges(callback);

      await startAndRunFirstActivePoll(liveFixture);

      // Second poll: fixture gone
      apiModule.fetchLiveFixtures.mockResolvedValueOnce({ response: [] });
      apiModule.fetchFixtureById.mockResolvedValueOnce({
        response: [makeApiFixture(1489369, 'Match Finished', { home: 2, away: 0 })],
      });

      await jest.advanceTimersByTimeAsync(15000);

      const matchEndCall = callback.mock.calls.find(
        (c) => c[0] && c[0].some((d) => d.matchEnded === true),
      );
      expect(matchEndCall).toBeDefined();
      expect(matchEndCall[0][0].matchEnded).toBe(true);
      expect(matchEndCall[0][0].scoreChanged).toBe(true);
      expect(matchEndCall[0][0].currentScore).toEqual({ home: 2, away: 0 });
    });

    test('coerces cached status to Match Finished when detail endpoint still lags on a live status', async () => {
      const liveFixture = makeApiFixture(1489369, 'Second Half');
      const cacheModule = require('../live-data/cache');

      await startAndRunFirstActivePoll(liveFixture);

      // Second poll: fixture gone from live feed, but the per-fixture detail
      // endpoint STILL reports an in-play status ("Second Half"). This is the
      // status-lag scenario that froze the live card on a green "Second Half".
      apiModule.fetchLiveFixtures.mockResolvedValueOnce({ response: [] });
      apiModule.fetchFixtureById.mockResolvedValueOnce({
        response: [makeApiFixture(1489369, 'Second Half', { home: 2, away: 0 })],
      });

      await jest.advanceTimersByTimeAsync(15000);

      // Fixture 1 is written twice: first by the initial active poll while it
      // is genuinely live ("Second Half"), then by detectMatchEnds at match end.
      // Assert on the LAST write - that match-end write must carry the coerced
      // finished status (not the lagging "Second Half"), so getLiveFixtures()
      // stops listing it and the card can flip to the finished card.
      const writesForId1 = cacheModule.updateFixtures.mock.calls
        .map((c) => c[0])
        .flat()
        .filter(([id]) => id === 1);
      expect(writesForId1.length).toBeGreaterThan(0);
      const [, written] = writesForId1[writesForId1.length - 1];
      expect(written.status).toBe('Match Finished');
      expect(written.elapsed).toBeNull();
    });

    test('when ALL fixtures disappear, match-end detected before passive switch', async () => {
      const liveFixture = makeApiFixture(1489369, 'Second Half');
      const callback = jest.fn();
      pollerModule.onChanges(callback);

      await startAndRunFirstActivePoll(liveFixture);

      // Second poll: empty (all matches ended)
      apiModule.fetchLiveFixtures.mockResolvedValueOnce({ response: [] });
      apiModule.fetchFixtureById.mockResolvedValueOnce({
        response: [makeApiFixture(1489369, 'Match Finished', { home: 2, away: 0 })],
      });

      await jest.advanceTimersByTimeAsync(15000);

      // Match-end callback fired
      const matchEndCall = callback.mock.calls.find(
        (c) => c[0] && c[0].some((d) => d.matchEnded === true),
      );
      expect(matchEndCall).toBeDefined();

      // And mode switched to passive
      expect(pollerModule.getStatus().mode).toBe('passive');
    });

    test('does not re-process fixture already in finishedIds (idempotent)', async () => {
      const liveFixture = makeApiFixture(1489369, 'Second Half');

      await startAndRunFirstActivePoll(liveFixture);

      // Second poll: fixture gone -> match-end detected
      apiModule.fetchLiveFixtures.mockResolvedValueOnce({ response: [] });
      apiModule.fetchFixtureById.mockResolvedValueOnce({
        response: [makeApiFixture(1489369, 'Match Finished', { home: 2, away: 0 })],
      });

      await jest.advanceTimersByTimeAsync(15000);
      expect(apiModule.fetchFixtureById).toHaveBeenCalledTimes(1);

      // Now in passive mode. Next passive check sees the same finished fixture.
      apiModule.fetchFixturesByDate.mockResolvedValueOnce({
        response: [makeApiFixture(1489369, 'Match Finished', { home: 2, away: 0 })],
      });

      await jest.advanceTimersByTimeAsync(15 * 60 * 1000);

      // Should NOT call fetchFixtureById again (already processed)
      expect(apiModule.fetchFixtureById).toHaveBeenCalledTimes(1);
    });

    test('does not add to finishedIds when fetch fails (retries later)', async () => {
      const liveFixture = makeApiFixture(1489369, 'Second Half');
      const callback = jest.fn();
      pollerModule.onChanges(callback);

      await startAndRunFirstActivePoll(liveFixture);

      // Second poll: fixture gone, but fetch fails
      apiModule.fetchLiveFixtures.mockResolvedValueOnce({ response: [] });
      apiModule.fetchFixtureById.mockRejectedValueOnce(new Error('Network error'));

      await jest.advanceTimersByTimeAsync(15000);

      // No matchEnded diff emitted
      const matchEndCall = callback.mock.calls.find(
        (c) => c[0] && c[0].some((d) => d.matchEnded === true),
      );
      expect(matchEndCall).toBeUndefined();

      // fetchFixtureById was called but failed
      expect(apiModule.fetchFixtureById).toHaveBeenCalledTimes(1);
    });
  });

  describe('passive mode fallback', () => {
    test('detects finished fixture and emits match-end diff', async () => {
      apiModule.fetchFixturesByDate.mockResolvedValueOnce({
        response: [makeApiFixture(1489369, 'Match Finished', { home: 2, away: 0 })],
      });

      const callback = jest.fn();
      pollerModule.onChanges(callback);
      pollerModule.start();

      await jest.advanceTimersByTimeAsync(0);

      const matchEndCall = callback.mock.calls.find(
        (c) => c[0] && c[0].some((d) => d.matchEnded === true),
      );
      expect(matchEndCall).toBeDefined();
      expect(matchEndCall[0][0].matchEnded).toBe(true);
      expect(matchEndCall[0][0].currentScore).toEqual({ home: 2, away: 0 });
    });

    test('does not emit for non-WC fixtures', async () => {
      apiModule.fetchFixturesByDate.mockResolvedValueOnce({
        response: [
          {
            fixture: {
              id: 9999,
              status: { long: 'Match Finished', elapsed: 90 },
              date: '2026-06-11T19:00:00Z',
            },
            league: { name: 'Premier League', round: 'Round 1' },
            teams: { home: { id: 100, name: 'Home' }, away: { id: 200, name: 'Away' } },
            goals: { home: 1, away: 0 },
            score: {
              halftime: { home: 0, away: 0 },
              fulltime: { home: 1, away: 0 },
              extratime: { home: null, away: null },
              penalty: { home: null, away: null },
            },
            events: [],
          },
        ],
      });

      const callback = jest.fn();
      pollerModule.onChanges(callback);
      pollerModule.start();

      await jest.advanceTimersByTimeAsync(0);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('stop resets state', () => {
    test('stop clears match-end tracking state', async () => {
      apiModule.fetchFixturesByDate.mockResolvedValue({ response: [] });

      pollerModule.start();
      await jest.advanceTimersByTimeAsync(0);
      pollerModule.stop();

      expect(pollerModule.getStatus().mode).toBe('stopped');
    });
  });
});
