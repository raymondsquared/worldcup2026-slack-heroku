'use strict';

const { search } = require('./client');
const { tryAcquire } = require('./rate-limiter');
const { sanitizeSearchResults, formatAsContext, stripSlackFormatting } = require('./sanitize');

async function webSearch(query) {
  // Validate input before consuming rate-limit token
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return null;
  }

  // Strip Slack mrkdwn so search API gets clean text
  const cleanQuery = stripSlackFormatting(query);
  if (cleanQuery.length === 0) {
    return null;
  }

  // No-op if API key not configured (don't waste rate-limit tokens)
  if (!process.env.WEB_SEARCH_API_KEY) {
    return null;
  }

  // Check rate limit (atomic check + record)
  const limit = tryAcquire();
  if (!limit.allowed) {
    console.log(`Web search rate limited (retry after ${limit.retryAfterMs}ms)`);
    return null;
  }

  // Call search API
  const results = await search(cleanQuery);
  if (!results || results.length === 0) {
    return null;
  }

  // Sanitize and format
  const sanitized = sanitizeSearchResults(results);
  if (sanitized.length === 0) {
    return null;
  }

  return formatAsContext(sanitized);
}

module.exports = { webSearch };
