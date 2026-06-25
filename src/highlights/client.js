'use strict';

const { sanitizeInput } = require('../mia/guardrails');

const HIGHLIGHTS_API_KEY = process.env.HIGHLIGHTS_API_KEY;
const HIGHLIGHTS_API_BASE_URL =
  process.env.HIGHLIGHTS_API_URL || 'https://www.googleapis.com/youtube/v3/playlistItems';
const HIGHLIGHTS_BASE_URL = process.env.HIGHLIGHTS_BASE_URL || 'https://www.youtube.com/watch?v=';
const HIGHLIGHTS_PLAYLIST_ID = process.env.HIGHLIGHTS_PLAYLIST_ID || 'PLBRLtDhTHh5o';
const TIMEOUT_MS = Number(process.env.HIGHLIGHTS_TIMEOUT_IN_MS) || 10000;
const MAX_RESULTS_PER_PAGE = 50;
const MAX_PAGES = 10;

function buildUrl(pageToken) {
  if (!HIGHLIGHTS_API_KEY) {
    throw new Error('Highlights env vars not configured');
  }
  const params = new URLSearchParams({
    part: 'snippet',
    playlistId: HIGHLIGHTS_PLAYLIST_ID,
    key: HIGHLIGHTS_API_KEY,
    maxResults: String(MAX_RESULTS_PER_PAGE),
  });
  if (pageToken) {
    params.set('pageToken', pageToken);
  }
  return `${HIGHLIGHTS_API_BASE_URL}?${params.toString()}`;
}

function buildVideoUrl(videoId) {
  return `${HIGHLIGHTS_BASE_URL}${videoId}`;
}

async function fetchPlaylistItems() {
  const items = [];
  let pageToken = null;
  let page = 0;
  let skipped = 0;

  try {
    do {
      const url = buildUrl(pageToken);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`Highlights API request failed (${response.status})`);
      }

      const data = await response.json();
      const pageItems = data.items || [];

      for (const item of pageItems) {
        const videoId = item.snippet?.resourceId?.videoId;
        const publishedAt = item.snippet?.publishedAt;

        if (!videoId || !publishedAt) {
          skipped++;
          continue;
        }

        const rawTitle = item.snippet?.title || '';
        const title = sanitizeInput(rawTitle);

        items.push({
          videoId,
          title,
          publishedAt,
          url: buildVideoUrl(videoId),
        });
      }

      pageToken = data.nextPageToken || null;
      page++;
    } while (pageToken && page < MAX_PAGES);
  } catch (err) {
    // Redact URL (contains API key) from low-level network errors
    if (err.message && err.message.includes(HIGHLIGHTS_API_KEY)) {
      throw new Error(`Highlights API request failed (network error)`);
    }
    throw err;
  }

  if (skipped > 0) {
    console.log(`[highlights] Skipped ${skipped} malformed items`);
  }

  return items;
}

module.exports = { fetchPlaylistItems };
