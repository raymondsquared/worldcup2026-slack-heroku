'use strict';

const { getAllFixtures, getTeamName } = require('../data');

const DEFAULT_LIMIT = 5;

function toMatch(fixture) {
  const home = getTeamName(fixture.teams.homeTeamId) || fixture.teams.homeTeamId;
  const away = getTeamName(fixture.teams.awayTeamId) || fixture.teams.awayTeamId;
  return {
    fixture: {
      id: fixture.id,
      teams: fixture.teams,
    },
    url: fixture.highlightsURL,
    title: `Highlights | ${home} vs ${away}`,
  };
}

function hasHighlight(fixture) {
  return Boolean(fixture.highlightsURL && fixture.dateAndTimeInUTC && fixture.teams);
}

/**
 * Return the latest N highlights across all match days, most recent first.
 *
 * On-demand command behavior: rather than requiring highlights for literally
 * yesterday (which may be a rest day or not yet synced), surface the most
 * recent N fixtures that have highlight videos.
 *
 * @param {number} [limit] Explicit cap; falls back to HIGHLIGHTS_COMMAND_FIXTURES_LIMIT,
 *   then to 5.
 * @returns {Array<{fixture, url, title}>} newest-first, at most `limit` items.
 */
function getLatestHighlights(limit) {
  // Resolution: explicit arg > env var > default. Both arg and env must be a
  // positive finite number; anything else (NaN, <= 0, negative) falls back so a
  // misconfigured limit never silently drops the newest highlights.
  const envN = Number(process.env.HIGHLIGHTS_COMMAND_FIXTURES_LIMIT);
  const max =
    Number.isFinite(limit) && limit > 0
      ? limit
      : Number.isFinite(envN) && envN > 0
        ? envN
        : DEFAULT_LIMIT;

  return getAllFixtures()
    .filter(hasHighlight)
    .sort((a, b) => b.dateAndTimeInUTC.localeCompare(a.dateAndTimeInUTC))
    .slice(0, max)
    .map(toMatch);
}

module.exports = { getLatestHighlights, DEFAULT_LIMIT };
