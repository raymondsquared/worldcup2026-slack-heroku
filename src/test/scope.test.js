'use strict';

const { isFootballRelated } = require('../mia/scope');

describe('mia/scope - isFootballRelated', () => {
  test('true for explicit football / World Cup vocabulary', () => {
    expect(isFootballRelated('When is the next match?')).toBe(true);
    expect(isFootballRelated('show me the group standings')).toBe(true);
    expect(isFootballRelated('who scored the goal?')).toBe(true);
    expect(isFootballRelated('World Cup schedule please')).toBe(true);
    expect(isFootballRelated('which referee is officiating?')).toBe(true);
  });

  test('true when a participating team name or FIFA code is mentioned', () => {
    expect(isFootballRelated('how is Brazil doing')).toBe(true);
    expect(isFootballRelated('tell me about MEX')).toBe(true);
    expect(isFootballRelated('Argentina squad')).toBe(true);
  });

  test('false for general-knowledge / off-topic questions', () => {
    expect(isFootballRelated('what color is the rainbow?')).toBe(false);
    expect(isFootballRelated('how do I bake bread?')).toBe(false);
    expect(isFootballRelated('recommend a good movie')).toBe(false);
  });

  test('matches FIFA codes only as whole words, not substrings', () => {
    // Whole-word matching avoids substring hits: "USA" inside "usagi",
    // "IRN/IRAN" inside "iranian".
    expect(isFootballRelated('usagi yojimbo movie')).toBe(false);
    expect(isFootballRelated('what is the iranian capital')).toBe(false);
  });

  test('a participating country name counts as on-topic (team reference)', () => {
    // "France" is a World Cup team; we cannot disambiguate country-vs-team, so
    // it is treated as on-topic. Acceptable - the LLM system prompt is the
    // primary boundary; this gate only governs the web-search fallback.
    expect(isFootballRelated('what is the capital of France?')).toBe(true);
  });

  test('case-insensitive matching', () => {
    expect(isFootballRelated('FIFA WORLD CUP')).toBe(true);
    expect(isFootballRelated('brazil')).toBe(true);
  });

  test('handles empty / non-string input safely', () => {
    expect(isFootballRelated('')).toBe(false);
    expect(isFootballRelated(null)).toBe(false);
    expect(isFootballRelated(undefined)).toBe(false);
  });
});
