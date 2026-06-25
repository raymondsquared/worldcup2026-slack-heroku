'use strict';

// In-memory cache: Map<internalFixtureId, fixtureData>
const fixtures = new Map();

let failureCount = 0;
let isStale = false;

const BACKOFF_INTERVALS = [15000, 30000, 60000, 120000];
const MAX_FAILURES = 5;

function updateFixtures(apiFixtures) {
  for (const [internalId, data] of apiFixtures) {
    fixtures.set(internalId, data);
  }

  failureCount = 0;
  isStale = false;
}

function getFixture(id) {
  const data = fixtures.get(id);
  if (!data) return null;

  return isStale ? { ...data, stale: true } : data;
}

function markStale() {
  isStale = true;
  console.log(`Marked cache as stale after ${MAX_FAILURES} consecutive failures`);
}

function recordFailure() {
  failureCount++;

  if (failureCount >= MAX_FAILURES) {
    markStale();
  }

  // Return backoff interval (capped at max)
  const index = Math.min(failureCount - 1, BACKOFF_INTERVALS.length - 1);
  return BACKOFF_INTERVALS[index];
}

function clear() {
  fixtures.clear();
  failureCount = 0;
  isStale = false;
}

function getStats() {
  return {
    size: fixtures.size,
    failureCount,
    isStale,
  };
}

module.exports = {
  updateFixtures,
  getFixture,
  markStale,
  recordFailure,
  clear,
  getStats,
};
