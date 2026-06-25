'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fetchPlaylistItems } = require('./client');
const { matchVideosToFixtures } = require('./adapter');
const { enrichFixtures } = require('./enrich');
const { generateDigest } = require('./digest');

const RUN_HOUR = Number(process.env.HIGHLIGHTS_RUN_HOUR_IN_UTC) || 12;
const CHECK_INTERVAL_IN_MS = 30 * 60_000;
const LAST_RUN_PATH = path.join(__dirname, '..', 'data', '.last-highlights-run');
const FIXTURES_PATH = path.join(__dirname, '..', 'data', 'fixtures.json');

let intervalId = null;
let running = false;

function getTodayUTC() {
  return new Date().toISOString().split('T')[0];
}

function getYesterdayUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

function readLastRunDate() {
  try {
    return fs.readFileSync(LAST_RUN_PATH, 'utf8').trim();
  } catch {
    return null;
  }
}

function writeLastRunDate(dateStr) {
  fs.writeFileSync(LAST_RUN_PATH, dateStr, 'utf8');
}

function filterPreviousDay(videos) {
  const yesterday = getYesterdayUTC();
  return videos.filter((v) => v.publishedAt && v.publishedAt.startsWith(yesterday));
}

async function run(client) {
  if (running) return;
  running = true;

  try {
    console.log('[highlights/scheduler] Starting daily highlights run');

    // Fetch full playlist
    const allVideos = await fetchPlaylistItems();
    if (allVideos.length === 0) {
      console.log('[highlights/scheduler] No videos in playlist, marking run complete');
      writeLastRunDate(getTodayUTC());
      return;
    }

    // Filter to previous day only
    const videos = filterPreviousDay(allVideos);
    console.log(
      `[highlights/scheduler] ${videos.length} video(s) from previous day (${getYesterdayUTC()})`,
    );

    if (videos.length === 0) {
      console.log('[highlights/scheduler] No videos from previous day, marking run complete');
      writeLastRunDate(getTodayUTC());
      return;
    }

    // Load fixtures and match
    const fixtures = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf8'));
    const matches = matchVideosToFixtures(videos, fixtures);

    // Enrich fixtures.json
    if (matches.length > 0) {
      await enrichFixtures(matches);
    }

    // Generate and post digest
    const totalHighlights = videos.filter((v) =>
      v.title.toLowerCase().includes('highlight'),
    ).length;

    await generateDigest(client, matches, { totalHighlights });

    // Success - mark today as complete
    writeLastRunDate(getTodayUTC());
    console.log('[highlights/scheduler] Daily highlights run complete');
  } catch (err) {
    // Do NOT write lastRunDate - retry on next tick
    console.error('[highlights/scheduler] Run failed, will retry:', err.message);
  } finally {
    running = false;
  }
}

function tick(client) {
  const now = new Date();
  if (now.getUTCHours() !== RUN_HOUR) return;
  if (readLastRunDate() === getTodayUTC()) return;

  run(client);
}

function start(client) {
  // Missed-run recovery
  const lastRun = readLastRunDate();
  const today = getTodayUTC();
  const currentHour = new Date().getUTCHours();

  if (lastRun !== today && currentHour >= RUN_HOUR) {
    console.log('[highlights/scheduler] Missed run detected, firing immediately');
    run(client);
  }

  intervalId = setInterval(() => tick(client), CHECK_INTERVAL_IN_MS);
  console.log(`[highlights/scheduler] Started (run hour: ${RUN_HOUR} UTC)`);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = {
  start,
  stop,
  tick,
  run,
  filterPreviousDay,
  readLastRunDate,
  writeLastRunDate,
  getTodayUTC,
  getYesterdayUTC,
};
