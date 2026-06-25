'use strict';

const countries = require('../data/countries.json');

// Build lookup from team ID to flagISO at load time
const TEAM_TO_ISO = new Map();
for (const country of countries) {
  TEAM_TO_ISO.set(country.id, country.flagISO);
}

// England and Scotland (the only World Cup 2026 teams with the shared "GB"
// flagISO, which would otherwise both render as 🇬🇧) override to Slack's named
// subdivision-flag emoji. These render in mrkdwn and plain_text (emoji:true).
const TEAM_FLAG_OVERRIDES = {
  ENG: ':flag-england:',
  SCO: ':flag-scotland:',
};

function isoToFlag(iso) {
  return [...iso.toUpperCase()]
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join('');
}

function getFlag(teamId) {
  if (Object.prototype.hasOwnProperty.call(TEAM_FLAG_OVERRIDES, teamId)) {
    return TEAM_FLAG_OVERRIDES[teamId];
  }
  const iso = TEAM_TO_ISO.get(teamId);
  if (!iso) return '\u{1F3F3}\u{FE0F}'; // white flag fallback
  return isoToFlag(iso);
}

module.exports = { getFlag };
