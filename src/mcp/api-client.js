'use strict';

const { sanitizeError } = require('./football-server');

const BASE_URL = 'https://v3.football.api-sports.io';
const TIMEOUT_MS = 10000;
const WORLD_CUP_LEAGUE_ID = 1;

// Make HTTP request to Football API
async function makeRequest(endpoint, params = {}) {
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) {
    throw new Error('FOOTBALL_API_KEY environment variable is required');
  }

  const url = new URL(endpoint, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'x-apisports-key': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`Request timed out after ${TIMEOUT_MS}ms: ${endpoint}`);
    }
    throw sanitizeError(new Error(`Request failed: ${err.message}`));
  }

  // Handle rate limit errors
  if (response.status === 429) {
    const error = new Error('Football API rate limit exceeded');
    error.status = 429;
    throw sanitizeError(error);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => 'unknown error');
    throw sanitizeError(new Error(`Request failed (${response.status}): ${body}`));
  }

  return response.json();
}

// Filter API response to World Cup 2026 fixtures only
function filterWorldCupFixtures(response) {
  if (!response || !response.response) {
    return response;
  }

  const filtered = response.response.filter((fixture) => {
    return fixture?.league?.id === WORLD_CUP_LEAGUE_ID;
  });

  return {
    ...response,
    response: filtered,
    results: filtered.length,
  };
}

module.exports = {
  makeRequest,
  filterWorldCupFixtures,
  WORLD_CUP_LEAGUE_ID,
};
