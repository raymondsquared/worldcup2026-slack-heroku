'use strict';

const teams = require('../data/teams.json');
const countries = require('../data/countries.json');

function normalize(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function buildNameMap() {
  const map = new Map();

  for (const team of teams) {
    // Full name from teams.json (normalized)
    map.set(normalize(team.name), team.id);
    // Team ID as lowercase (e.g., "mex" -> "MEX")
    map.set(team.id.toLowerCase(), team.id);
  }

  for (const country of countries) {
    // Full name from countries.json (normalized)
    map.set(normalize(country.name), country.id);
    // FIFA code as lowercase
    map.set(country.fifaCode.toLowerCase(), country.id);
    // Aliases
    if (country.aliases) {
      for (const alias of country.aliases) {
        map.set(normalize(alias), country.id);
      }
    }
  }

  return map;
}

const NAME_MAP = buildNameMap();

const SEPARATOR_REGEX = /\s+v\s+|\s+vs\s+|\s+-\s+/i;
const SCORE_REGEX = /\s+\d+-\d+\s+/;

function getMatchupText(title) {
  const segments = title.split('|').map((s) => s.trim());

  if (segments.length >= 2) {
    // If first segment is just "Highlights" or similar, matchup is in segment 2
    const firstLower = segments[0].toLowerCase();
    if (firstLower === 'highlights' || firstLower === 'match highlights') {
      return segments[1];
    }
  }

  // Default: matchup is in first segment
  return segments[0];
}

function extractTeams(title) {
  const matchupText = getMatchupText(title);

  // Split on score pattern (e.g., "3-1") or traditional separators
  const candidates = SCORE_REGEX.test(matchupText)
    ? matchupText.split(SCORE_REGEX)
    : matchupText.split(SEPARATOR_REGEX);

  const found = new Set();
  for (const candidate of candidates) {
    const normalized = normalize(candidate);
    if (normalized && NAME_MAP.has(normalized)) {
      found.add(NAME_MAP.get(normalized));
    }
  }

  return found;
}

function matchVideosToFixtures(videos, fixtures) {
  if (!videos || !videos.length || !fixtures || !fixtures.length) {
    return [];
  }

  // Filter to highlight videos only
  const highlightVideos = videos.filter((v) => v.title.toLowerCase().includes('highlight'));

  // Track: fixtureId -> best video match (newest wins)
  const fixtureMatches = new Map();

  for (const video of highlightVideos) {
    const teamIds = extractTeams(video.title);

    // Find all fixtures where both teams appear in video title
    const candidateFixtures = fixtures.filter(
      (f) => f.teams && teamIds.has(f.teams.homeTeamId) && teamIds.has(f.teams.awayTeamId),
    );

    if (candidateFixtures.length === 0) {
      continue;
    }

    // Tie-break: pick fixture closest to video publishedAt
    const videoTime = Date.parse(video.publishedAt);
    const bestFixture = candidateFixtures.reduce((best, f) => {
      const diff = Math.abs(videoTime - Date.parse(f.dateAndTimeInUTC));
      const bestDiff = Math.abs(videoTime - Date.parse(best.dateAndTimeInUTC));
      return diff < bestDiff ? f : best;
    });

    // If fixture already has a video, newer publishedAt wins
    const existing = fixtureMatches.get(bestFixture.id);
    if (existing) {
      const existingTime = Date.parse(existing.publishedAt);
      if (videoTime > existingTime) {
        fixtureMatches.set(bestFixture.id, { fixture: bestFixture, ...video });
      }
    } else {
      fixtureMatches.set(bestFixture.id, { fixture: bestFixture, ...video });
    }
  }

  // Log unmatched highlight videos (derived from final assignments)
  const matchedIds = new Set(Array.from(fixtureMatches.values()).map((m) => m.videoId));
  const unmatched = highlightVideos.filter((v) => !matchedIds.has(v.videoId));
  if (unmatched.length > 0) {
    console.log(
      `[highlights] ${unmatched.length} highlight video(s) unmatched:`,
      unmatched.map((v) => v.title),
    );
  }

  // Return as array of { fixture, videoId, url, title }
  return Array.from(fixtureMatches.values()).map((m) => ({
    fixture: m.fixture,
    videoId: m.videoId,
    url: m.url,
    title: m.title,
  }));
}

module.exports = { matchVideosToFixtures, normalize, extractTeams };
