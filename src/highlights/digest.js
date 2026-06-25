'use strict';

const { ask } = require('../mia');
const { sanitizeInput } = require('../mia/guardrails');
const { getRandomPersona, RECAP_PERSONAS } = require('../mia/personas');
const { getFixtureById, getTeamName } = require('../data');
const { getFlag } = require('../broadcast/flags');
const { possessionChartUrl, statsChartUrl } = require('../broadcast/charts');
const { slackDate, utcTime } = require('../lib/format');

const CHANNEL = process.env.BROADCAST_CHANNEL_ID;

const DIGEST_INSTRUCTION =
  " Write a short, punchy 1-2 sentence intro for today's World Cup daily highlights post." +
  " Set the tone for the day's results - hype, surprise, drama." +
  ' Do NOT list scores or match details. Do NOT mention video links.' +
  ' Do not use XML tags. Write plain text only. Keep it under 200 characters.';

function getDigestSystemPrompt() {
  const persona = getRandomPersona();
  return RECAP_PERSONAS[persona] + DIGEST_INSTRUCTION;
}

const DIGEST_USER_PROMPT =
  "Write a punchy one-liner intro for today's World Cup highlights digest." +
  ' Tease the drama without spoiling scores.';

function buildDigestContext(matches) {
  const parts = [];

  for (const match of matches) {
    const fixture = getFixtureById(match.fixture.id);
    const home =
      getTeamName(match.fixture.teams?.homeTeamId || fixture?.teams?.homeTeamId) || 'Home';
    const away =
      getTeamName(match.fixture.teams?.awayTeamId || fixture?.teams?.awayTeamId) || 'Away';

    const score = fixture?.finalScore
      ? `${fixture.finalScore.home}-${fixture.finalScore.away}`
      : 'Score unavailable';

    const sanitizedTitle = sanitizeInput(match.title);
    const sanitizedUrl = sanitizeInput(match.url);

    parts.push(
      `Match: ${home} vs ${away}` +
        `\nResult: ${score}` +
        `\nVideo: ${sanitizedTitle}` +
        `\nLink: ${sanitizedUrl}`,
    );
  }

  return 'Daily Highlights:\n---\n' + parts.join('\n\n') + '\n---';
}

function formatDateHeader() {
  const yesterday = new Date(Date.now() - 86400000);
  return yesterday.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function buildMatchBlocks(matches) {
  const blocks = [];

  for (const match of matches) {
    const fixture = getFixtureById(match.fixture.id);
    const homeId = match.fixture.teams?.homeTeamId || fixture?.teams?.homeTeamId;
    const awayId = match.fixture.teams?.awayTeamId || fixture?.teams?.awayTeamId;
    const home = getTeamName(homeId) || 'Home';
    const away = getTeamName(awayId) || 'Away';
    const homeFlag = getFlag(homeId);
    const awayFlag = getFlag(awayId);

    const score = fixture?.finalScore
      ? `${fixture.finalScore.home} - ${fixture.finalScore.away}`
      : '? - ?';

    const stage = fixture?.stage || '';
    const group = fixture?.group || '';
    const kickoff = fixture?.dateAndTimeInUTC
      ? `🕒 ${slackDate(fixture.dateAndTimeInUTC)} · ${utcTime(fixture.dateAndTimeInUTC)}`
      : '';
    const meta = [stage, group, kickoff].filter(Boolean).join(' · ');

    // Match result section with accessory button
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `${homeFlag} *${home}*  \`${score}\`  *${away}* ${awayFlag}` + (meta ? `\n${meta}` : ''),
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: '▶️ Watch', emoji: true },
        url: match.url,
        action_id: `digest_watch_${match.fixture.id}`,
      },
    });

    const stats = fixture?.statistics;
    if (stats) {
      const possUrl = possessionChartUrl(stats, homeId, awayId, home, away);
      if (possUrl) {
        blocks.push({ type: 'image', image_url: possUrl, alt_text: 'Ball Possession' });
      }
      const matchStatsUrl = statsChartUrl(stats, homeId, awayId, home, away);
      if (matchStatsUrl) {
        blocks.push({ type: 'image', image_url: matchStatsUrl, alt_text: 'Match Stats' });
      }
    }
  }

  return blocks;
}

function escapeMrkdwn(text) {
  // Escape characters that break Slack mrkdwn formatting.
  // Prefix formatting chars with a zero-width space (U+200B) so
  // Slack treats them as literal text, not markup.
  const ZWS = String.fromCharCode(0x200b);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/_/g, ZWS + '_')
    .replace(/~/g, ZWS + '~')
    .replace(/\*/g, ZWS + '*');
}

function logMatchStats(totalHighlights, matchedCount) {
  const unmatched = totalHighlights - matchedCount;
  const ratio = totalHighlights > 0 ? matchedCount / totalHighlights : 1.0;

  console.log(
    `[highlights/digest] Stats: total=${totalHighlights}, matched=${matchedCount}, ` +
      `unmatched=${unmatched}, ratio=${ratio.toFixed(2)}`,
  );

  if (ratio < 0.9) {
    console.warn(`[highlights/digest] Match ratio ${ratio.toFixed(2)} is below 0.9 threshold`);
  }
}

async function generateDigest(client, matches, stats = {}) {
  logMatchStats(stats.totalHighlights || 0, matches ? matches.length : 0);

  if (!matches || matches.length === 0) {
    console.log('[highlights/digest] Digest skipped: 0 highlights matched for previous day');
    return null;
  }

  if (!CHANNEL) {
    console.warn('[highlights/digest] BROADCAST_CHANNEL_ID not set, skipping digest post');
    return null;
  }

  const context = buildDigestContext(matches);

  // Generate a short punchy intro via AI
  const intro = await ask(DIGEST_USER_PROMPT, {
    context,
    recap: true,
    systemOverride: getDigestSystemPrompt(),
  });

  if (!intro) {
    console.warn('[highlights/digest] MIA returned null (toxic filter or error), skipping post');
    return null;
  }

  // Build rich Block Kit message
  const dateStr = formatDateHeader();
  const matchBlocks = buildMatchBlocks(matches);

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `⚽ Daily Highlights - ${dateStr}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `_${escapeMrkdwn(intro)}_` },
    },
    { type: 'divider' },
    ...matchBlocks,
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `📺 ${matches.length} match${matches.length === 1 ? '' : 'es'} · FIFA World Cup 2026™`,
        },
      ],
    },
  ];

  const fallbackText = `⚽ Daily Highlights - ${dateStr}\n${intro}`;

  await client.chat.postMessage({
    channel: CHANNEL,
    text: fallbackText,
    blocks,
    unfurl_links: false,
    unfurl_media: false,
  });

  console.log('[highlights/digest] Digest posted to broadcast channel');
  return { intro, blocks };
}

module.exports = { generateDigest, buildDigestContext, buildMatchBlocks, logMatchStats };
