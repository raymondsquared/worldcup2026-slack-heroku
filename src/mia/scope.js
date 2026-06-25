'use strict';

// Topic-scope detection: a model-free, keyword + participating-team check for
// whether a question is football / World Cup 2026 related. This is the trust
// layer's scope gate (see ADR-5 and SCOPE_INSTRUCTION in personas.js), used by
// ask() to decide whether the low-confidence web-search fallback is allowed to
// fire - it keeps the topic-blind web search from answering off-topic questions.
// It is deliberately separate from data retrieval (the model-driven tool loop):
// this answers "is this on-topic?", the tool loop answers "fetch the local
// data". They share only the teams.json reference, not logic.

const teams = require('../data/teams.json');

const SAMPLE_FOOTBALL_TERMS = [
  'world cup',
  'worldcup',
  'fifa',
  'football',
  'soccer',
  'fixture',
  'match',
  'matches',
  'schedule',
  'group',
  'groups',
  'standing',
  'standings',
  'table',
  'player',
  'players',
  'roster',
  'squad',
  'lineup',
  'formation',
  'goal',
  'goals',
  'score',
  'scores',
  'penalty',
  'red card',
  'yellow card',
  'referee',
  'stadium',
  'tournament',
  'knockout',
  'qualif',
  'highlight',
  'coach',
  'manager',
  'game',
  'games',
  'play',
  'playing',
  'win',
  'won',
  'beat',
  'draw',
  'vs',
  'versus',
];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FOOTBALL_TERMS_REGEX = new RegExp(
  `\\b(${SAMPLE_FOOTBALL_TERMS.map(escapeRegex).join('|')})\\b`,
  'i',
);

function isFootballRelated(userText) {
  if (!userText || typeof userText !== 'string') return false;
  const text = userText.toLowerCase();
  if (FOOTBALL_TERMS_REGEX.test(text)) return true;

  const words = new Set(text.split(/[^a-z]+/).filter(Boolean));
  return teams.some((t) => {
    const name = t.name.toLowerCase();
    const code = t.id.toLowerCase();
    if (words.has(name) || words.has(code)) return true;
    if (name.includes(' ') && text.includes(name)) return true;
    return false;
  });
}

module.exports = { isFootballRelated };
