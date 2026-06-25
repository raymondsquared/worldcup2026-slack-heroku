'use strict';

const BASE_URL = process.env.FOOTBALL_API_URL || 'https://v3.football.api-sports.io';
const TIMEOUT_IN_MS = 10000;

const API_KEY = process.env.FOOTBALL_API_KEY;
if (!API_KEY) {
  throw new Error('FOOTBALL_API_KEY environment variable is required');
}

function sanitizeError(message) {
  if (!API_KEY) return message;
  return message.replaceAll(API_KEY, '[REDACTED]');
}

async function request(endpoint, params = {}) {
  const url = new URL(endpoint, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'x-apisports-key': API_KEY },
      signal: AbortSignal.timeout(TIMEOUT_IN_MS),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`Request timed out after ${TIMEOUT_IN_MS}ms: ${endpoint}`);
    }
    throw new Error(sanitizeError(`Request failed: ${err.message}`));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => 'unknown error');
    throw new Error(sanitizeError(`Request failed (${response.status}): ${body}`));
  }

  return response.json();
}

function fetchLiveFixtures() {
  return request('/fixtures', { live: 'all' });
}

function fetchFixturesByDate(date) {
  return request('/fixtures', { date });
}

function fetchSquad(teamId) {
  return request('/players/squads', { team: String(teamId) });
}

function fetchFixtureById(fixtureId) {
  return request('/fixtures', { id: String(fixtureId) });
}

function fetchStandings(leagueId, season) {
  return request('/standings', { league: String(leagueId), season: String(season) });
}

module.exports = {
  fetchLiveFixtures,
  fetchFixturesByDate,
  fetchFixtureById,
  fetchSquad,
  fetchStandings,
};
