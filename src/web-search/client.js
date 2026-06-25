'use strict';

// API key read at module load time. If set after require(), restart is needed.
const WEB_SEARCH_API_KEY = process.env.WEB_SEARCH_API_KEY;
const WEB_SEARCH_API_URL = process.env.WEB_SEARCH_API_URL || 'https://api.tavily.com/search';
const TIMEOUT_IN_MS = Number(process.env.WEB_SEARCH_TIMEOUT_IN_MS) || 10000;
const MAX_RESULTS = 5;

async function search(query) {
  if (!WEB_SEARCH_API_KEY) {
    return null;
  }

  const response = await fetch(WEB_SEARCH_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: WEB_SEARCH_API_KEY,
      query,
      max_results: MAX_RESULTS,
      search_depth: 'basic',
    }),
    signal: AbortSignal.timeout(TIMEOUT_IN_MS),
  });

  if (!response.ok) {
    // Never expose API key in error messages
    const status = response.status;
    throw new Error(`Web search request failed (${status})`);
  }

  const data = await response.json();
  const results = data?.results || [];

  return results.slice(0, MAX_RESULTS).map((r) => ({
    title: r.title || '',
    snippet: r.content || '',
    url: r.url || '',
  }));
}

module.exports = { search };
