'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Validate env before loading modules that depend on it
if (!process.env.HIGHLIGHTS_API_KEY) {
  console.error('Error: HIGHLIGHTS_API_KEY environment variable is required.');
  console.error('Set it in your .env file or export it before running this script.');
  process.exit(1);
}

const { fetchPlaylistItems } = require('../src/highlights/client');
const { matchVideosToFixtures } = require('../src/highlights/adapter');
const { enrichFixtures } = require('../src/highlights/enrich');

const DATA_DIR = path.join(__dirname, '..', 'src', 'data');

async function syncHighlights() {
  console.log('\n=== Sync Highlights ===\n');

  // Load all fixtures (no date filter - backfill mode)
  const fixtures = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'fixtures.json'), 'utf8'));

  console.log(`Loaded ${fixtures.length} fixtures from fixtures.json`);

  // Fetch full playlist
  console.log('Fetching highlight playlist...');
  const videos = await fetchPlaylistItems();

  if (videos.length === 0) {
    console.log('No videos found in playlist. Nothing to sync.');
    return;
  }

  console.log(`Fetched ${videos.length} video(s) from playlist`);

  // Match videos to fixtures
  const matches = matchVideosToFixtures(videos, fixtures);
  const highlightCount = videos.filter((v) => v.title.toLowerCase().includes('highlight')).length;

  // Log non-highlight videos that were skipped
  const nonHighlights = videos.filter((v) => !v.title.toLowerCase().includes('highlight'));
  if (nonHighlights.length > 0) {
    console.log(`\nSkipped ${nonHighlights.length} non-highlight video(s):`);
    for (const v of nonHighlights) {
      console.log(`  - ${v.title}`);
    }
  }

  console.log(
    `\nHighlight videos: ${highlightCount}, Fixtures matched: ${matches.length}, ` +
      `Unmatched: ${highlightCount - matches.length}`,
  );

  if (matches.length === 0) {
    console.log('No matches found. Nothing to enrich.');
    return;
  }

  // Enrich fixtures.json
  const updated = await enrichFixtures(matches);

  console.log(`\nFixtures updated: ${updated}`);
  console.log('\n=== Sync highlights complete ===');
}

syncHighlights().catch((err) => {
  console.error(`\nSync failed: ${err.message}`);
  process.exit(1);
});
