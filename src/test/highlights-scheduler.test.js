'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LAST_RUN_PATH = path.join(__dirname, '..', 'data', '.last-highlights-run');

// Clean up last-run file before/after tests
function cleanLastRun() {
  try {
    fs.unlinkSync(LAST_RUN_PATH);
  } catch {
    /* ignore */
  }
}

beforeEach(() => {
  cleanLastRun();
  jest.clearAllMocks();
  jest.resetModules();
});

afterAll(() => {
  cleanLastRun();
});

jest.mock('../highlights/client', () => ({
  fetchPlaylistItems: jest.fn().mockResolvedValue([]),
}));

jest.mock('../highlights/adapter', () => ({
  matchVideosToFixtures: jest.fn().mockReturnValue([]),
}));

jest.mock('../highlights/enrich', () => ({
  enrichFixtures: jest.fn().mockResolvedValue(0),
}));

jest.mock('../highlights/digest', () => ({
  generateDigest: jest.fn().mockResolvedValue('digest text'),
}));

describe('highlights/scheduler', () => {
  let scheduler;
  let mockClient;

  beforeEach(() => {
    scheduler = require('../highlights/scheduler');
    mockClient = { chat: { postMessage: jest.fn().mockResolvedValue({ ok: true }) } };
  });

  describe('filterPreviousDay', () => {
    test('filters videos to previous UTC day', () => {
      const yesterday = scheduler.getYesterdayUTC();
      const videos = [
        { videoId: 'v1', title: 'A', publishedAt: `${yesterday}T08:00:00Z`, url: 'u1' },
        { videoId: 'v2', title: 'B', publishedAt: '2026-01-01T08:00:00Z', url: 'u2' },
        { videoId: 'v3', title: 'C', publishedAt: `${yesterday}T22:00:00Z`, url: 'u3' },
      ];

      const result = scheduler.filterPreviousDay(videos);

      expect(result).toHaveLength(2);
      expect(result[0].videoId).toBe('v1');
      expect(result[1].videoId).toBe('v3');
    });

    test('returns empty for no matching dates', () => {
      const videos = [
        { videoId: 'v1', title: 'A', publishedAt: '2020-01-01T08:00:00Z', url: 'u1' },
      ];

      expect(scheduler.filterPreviousDay(videos)).toHaveLength(0);
    });
  });

  describe('lastRunDate persistence', () => {
    test('readLastRunDate returns null when file missing', () => {
      expect(scheduler.readLastRunDate()).toBeNull();
    });

    test('writeLastRunDate persists and readLastRunDate retrieves', () => {
      scheduler.writeLastRunDate('2026-06-18');
      expect(scheduler.readLastRunDate()).toBe('2026-06-18');
    });
  });

  describe('tick', () => {
    test('skips when hour does not match RUN_HOUR', () => {
      const { fetchPlaylistItems } = require('../highlights/client');
      // RUN_HOUR defaults to 12, so unless current hour is 12, this skips
      const now = new Date();
      if (now.getUTCHours() === 12) return; // skip this test at noon UTC

      scheduler.tick(mockClient);

      expect(fetchPlaylistItems).not.toHaveBeenCalled();
    });

    test('skips when already ran today', () => {
      const { fetchPlaylistItems } = require('../highlights/client');
      scheduler.writeLastRunDate(scheduler.getTodayUTC());

      scheduler.tick(mockClient);

      expect(fetchPlaylistItems).not.toHaveBeenCalled();
    });
  });

  describe('run', () => {
    test('successful run writes lastRunDate', async () => {
      const { fetchPlaylistItems } = require('../highlights/client');
      const { matchVideosToFixtures } = require('../highlights/adapter');
      const { generateDigest } = require('../highlights/digest');

      const yesterday = scheduler.getYesterdayUTC();
      fetchPlaylistItems.mockResolvedValue([
        {
          videoId: 'v1',
          title: 'Mexico v South Africa | Highlights',
          publishedAt: `${yesterday}T08:00:00Z`,
          url: 'u1',
        },
      ]);
      matchVideosToFixtures.mockReturnValue([
        {
          fixture: { id: 1 },
          videoId: 'v1',
          url: 'u1',
          title: 'Mexico v South Africa | Highlights',
        },
      ]);
      generateDigest.mockResolvedValue('digest posted');

      await scheduler.run(mockClient);

      expect(scheduler.readLastRunDate()).toBe(scheduler.getTodayUTC());
      expect(generateDigest).toHaveBeenCalled();
    });

    test('failed run does NOT write lastRunDate', async () => {
      const { fetchPlaylistItems } = require('../highlights/client');
      const { generateDigest } = require('../highlights/digest');

      const yesterday = scheduler.getYesterdayUTC();
      fetchPlaylistItems.mockResolvedValue([
        {
          videoId: 'v1',
          title: 'Match Highlights',
          publishedAt: `${yesterday}T08:00:00Z`,
          url: 'u1',
        },
      ]);
      generateDigest.mockRejectedValue(new Error('Slack post failed'));

      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await scheduler.run(mockClient);

      expect(scheduler.readLastRunDate()).toBeNull();
      errSpy.mockRestore();
    });

    test('empty playlist writes lastRunDate (nothing to do)', async () => {
      const { fetchPlaylistItems } = require('../highlights/client');
      fetchPlaylistItems.mockResolvedValue([]);

      await scheduler.run(mockClient);

      expect(scheduler.readLastRunDate()).toBe(scheduler.getTodayUTC());
    });

    test('no videos from previous day writes lastRunDate', async () => {
      const { fetchPlaylistItems } = require('../highlights/client');
      fetchPlaylistItems.mockResolvedValue([
        { videoId: 'v1', title: 'Old Highlights', publishedAt: '2020-01-01T08:00:00Z', url: 'u1' },
      ]);

      await scheduler.run(mockClient);

      expect(scheduler.readLastRunDate()).toBe(scheduler.getTodayUTC());
    });

    test('re-entrancy guard prevents concurrent runs', async () => {
      const { fetchPlaylistItems } = require('../highlights/client');

      let resolveFirst;
      fetchPlaylistItems.mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveFirst = r;
          }),
      );

      const yesterday = scheduler.getYesterdayUTC();
      const run1 = scheduler.run(mockClient);
      const run2 = scheduler.run(mockClient); // should be no-op

      resolveFirst([
        { videoId: 'v1', title: 'Highlights', publishedAt: `${yesterday}T08:00:00Z`, url: 'u1' },
      ]);

      await run1;
      await run2;

      // fetchPlaylistItems called only once (second run was guarded)
      expect(fetchPlaylistItems).toHaveBeenCalledTimes(1);
    });
  });

  describe('start', () => {
    afterEach(() => {
      scheduler.stop();
    });

    test('starts without HIGHLIGHTS_API_KEY (env validated at boot, not scheduler)', () => {
      const originalKey = process.env.HIGHLIGHTS_API_KEY;
      delete process.env.HIGHLIGHTS_API_KEY;
      jest.resetModules();
      const freshScheduler = require('../highlights/scheduler');

      // Should not throw - env validation is the app's responsibility at boot
      expect(() => freshScheduler.start(mockClient)).not.toThrow();

      freshScheduler.stop();
      process.env.HIGHLIGHTS_API_KEY = originalKey;
    });
  });
});
