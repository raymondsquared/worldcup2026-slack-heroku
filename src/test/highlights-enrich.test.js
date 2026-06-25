'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SOURCE_FIXTURES_PATH = path.join(__dirname, '..', 'data', 'fixtures.json');

// Write to a throwaway copy in the OS temp dir instead of the committed
// fixtures.json. Other suites require('../data/fixtures.json'); mutating the
// real file mid-test races their reads (Unexpected end of JSON input).
const FIXTURES_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'wc-enrich-')),
  'fixtures.json',
);

// enrich.js reads this env var at module load to resolve its target path.
process.env.HIGHLIGHTS_FIXTURES_PATH = FIXTURES_PATH;

// Store original fixtures to seed/reset the temp copy
let originalFixtures;

beforeAll(() => {
  originalFixtures = fs.readFileSync(SOURCE_FIXTURES_PATH, 'utf8');
});

afterAll(() => {
  // Clean up the temp dir and unset the override
  try {
    fs.rmSync(path.dirname(FIXTURES_PATH), { recursive: true, force: true });
  } catch (_) {
    // ignore cleanup errors
  }
  delete process.env.HIGHLIGHTS_FIXTURES_PATH;
});

beforeEach(() => {
  // Reset the temp fixtures copy before each test
  fs.writeFileSync(FIXTURES_PATH, originalFixtures, 'utf8');
  // Clear module cache so writeQueue resets
  delete require.cache[require.resolve('../highlights/enrich')];
});

function readFixtures() {
  return JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf8'));
}

function makeMatch(fixtureId, url) {
  return { fixture: { id: fixtureId }, url };
}

describe('highlights/enrich', () => {
  describe('enrichFixtures', () => {
    test('adds new highlightsURL field to fixture', async () => {
      const { enrichFixtures } = require('../highlights/enrich');
      const fixtures = readFixtures();
      const targetId = fixtures[0].id;

      const count = await enrichFixtures([
        makeMatch(targetId, 'https://example.com/watch?v=abc123'),
      ]);

      expect(count).toBe(1);
      const updated = readFixtures();
      const fixture = updated.find((f) => f.id === targetId);
      expect(fixture.highlightsURL).toBe('https://example.com/watch?v=abc123');
    });

    test('overwrites existing highlightsURL field', async () => {
      const { enrichFixtures } = require('../highlights/enrich');
      const fixtures = readFixtures();
      const targetId = fixtures[0].id;

      // First write
      await enrichFixtures([makeMatch(targetId, 'https://example.com/watch?v=old')]);

      // Second write (overwrite)
      await enrichFixtures([makeMatch(targetId, 'https://example.com/watch?v=new')]);

      const updated = readFixtures();
      const fixture = updated.find((f) => f.id === targetId);
      expect(fixture.highlightsURL).toBe('https://example.com/watch?v=new');
    });

    test('empty matches: no file write, returns 0', async () => {
      const { enrichFixtures } = require('../highlights/enrich');
      const writeSpy = jest.spyOn(fs.promises, 'writeFile');

      const count = await enrichFixtures([]);
      expect(count).toBe(0);
      expect(writeSpy).not.toHaveBeenCalled();

      writeSpy.mockRestore();
    });

    test('null matches: returns 0', async () => {
      const { enrichFixtures } = require('../highlights/enrich');

      const count = await enrichFixtures(null);
      expect(count).toBe(0);
    });

    test('atomic write: temp file created then renamed', async () => {
      const { enrichFixtures } = require('../highlights/enrich');
      const fixtures = readFixtures();
      const targetId = fixtures[0].id;

      const writeSpy = jest.spyOn(fs.promises, 'writeFile');
      const renameSpy = jest.spyOn(fs.promises, 'rename');

      await enrichFixtures([makeMatch(targetId, 'https://example.com/watch?v=atomic')]);

      const expectedTmp = `${FIXTURES_PATH}.tmp.${process.pid}.json`;
      expect(writeSpy).toHaveBeenCalledWith(expectedTmp, expect.any(String), 'utf8');
      expect(renameSpy).toHaveBeenCalledWith(expectedTmp, FIXTURES_PATH);

      writeSpy.mockRestore();
      renameSpy.mockRestore();
    });

    test('concurrent writes: serialized execution', async () => {
      const { enrichFixtures } = require('../highlights/enrich');
      const fixtures = readFixtures();
      const id1 = fixtures[0].id;
      const id2 = fixtures[1].id;

      const writeOrder = [];
      const originalWriteFile = fs.promises.writeFile.bind(fs.promises);
      const writeSpy = jest.spyOn(fs.promises, 'writeFile').mockImplementation(async (...args) => {
        writeOrder.push(args[0]);
        return originalWriteFile(...args);
      });

      // Fire two writes in parallel
      const [count1, count2] = await Promise.all([
        enrichFixtures([makeMatch(id1, 'https://example.com/watch?v=first')]),
        enrichFixtures([makeMatch(id2, 'https://example.com/watch?v=second')]),
      ]);

      expect(count1).toBe(1);
      expect(count2).toBe(1);

      // Both should complete and write to temp file (serialized)
      expect(writeOrder).toHaveLength(2);

      // Both fixtures should have URLs (second write read fresh data from first)
      const updated = readFixtures();
      expect(updated.find((f) => f.id === id1).highlightsURL).toBe(
        'https://example.com/watch?v=first',
      );
      expect(updated.find((f) => f.id === id2).highlightsURL).toBe(
        'https://example.com/watch?v=second',
      );

      writeSpy.mockRestore();
    });

    test('fixture not found: skip gracefully, still update others', async () => {
      const { enrichFixtures } = require('../highlights/enrich');
      const fixtures = readFixtures();
      const validId = fixtures[0].id;
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const count = await enrichFixtures([
        makeMatch(99999, 'https://example.com/watch?v=missing'),
        makeMatch(validId, 'https://example.com/watch?v=found'),
      ]);

      // Only 1 updated (the valid one)
      expect(count).toBe(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('99999'));

      const updated = readFixtures();
      expect(updated.find((f) => f.id === validId).highlightsURL).toBe(
        'https://example.com/watch?v=found',
      );

      warnSpy.mockRestore();
    });

    test('write failure: temp file cleaned up', async () => {
      const { enrichFixtures } = require('../highlights/enrich');
      const fixtures = readFixtures();
      const targetId = fixtures[0].id;

      // Mock rename to fail (simulating filesystem error)
      const renameSpy = jest
        .spyOn(fs.promises, 'rename')
        .mockRejectedValueOnce(new Error('rename failed'));
      const unlinkSpy = jest.spyOn(fs.promises, 'unlink');

      await expect(
        enrichFixtures([makeMatch(targetId, 'https://example.com/watch?v=fail')]),
      ).rejects.toThrow('rename failed');

      const expectedTmp = `${FIXTURES_PATH}.tmp.${process.pid}.json`;
      expect(unlinkSpy).toHaveBeenCalledWith(expectedTmp);

      renameSpy.mockRestore();
      unlinkSpy.mockRestore();
    });
  });
});
