'use strict';

const fs = require('fs');
const path = require('path');

// Resolved at module load. Defaults to the committed data file in production;
// HIGHLIGHTS_FIXTURES_PATH lets tests point writes at a throwaway copy so they
// never mutate the shared source file (which other suites require()).
const FIXTURES_PATH =
  process.env.HIGHLIGHTS_FIXTURES_PATH || path.join(__dirname, '..', 'data', 'fixtures.json');

let writeQueue = Promise.resolve();

function enrichFixtures(matches) {
  if (!matches || matches.length === 0) {
    return Promise.resolve(0);
  }

  const result = writeQueue.then(() => doWrite(matches));
  // Queue always advances even on error (prevents deadlock)
  writeQueue = result.catch(() => {});
  // Caller receives the actual result or error
  return result;
}

async function doWrite(matches) {
  const tmpPath = `${FIXTURES_PATH}.tmp.${process.pid}.json`;
  let updated = 0;

  try {
    const raw = await fs.promises.readFile(FIXTURES_PATH, 'utf8');
    const fixtures = JSON.parse(raw);

    for (const match of matches) {
      const fixture = fixtures.find((f) => f.id === match.fixture.id);
      if (!fixture) {
        console.warn(
          `[highlights/enrich] Fixture ID ${match.fixture.id} not found in fixtures.json, skipping`,
        );
        continue;
      }
      fixture.highlightsURL = match.url;
      updated++;
    }

    if (updated === 0) {
      return 0;
    }

    await fs.promises.writeFile(tmpPath, JSON.stringify(fixtures, null, 2), 'utf8');
    await fs.promises.rename(tmpPath, FIXTURES_PATH);

    return updated;
  } catch (err) {
    // Attempt to clean up temp file on failure
    try {
      await fs.promises.unlink(tmpPath);
    } catch (_) {
      // temp file may not exist; ignore
    }
    throw err;
  }
}

module.exports = { enrichFixtures };
