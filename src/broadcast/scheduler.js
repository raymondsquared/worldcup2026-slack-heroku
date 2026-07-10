'use strict';

const { getUpcomingFixtures, getTeamName, getFixtureById } = require('../data');
const { slackDate } = require('../lib/format');
const {
  formatGoalAlert,
  formatMissedPenaltyAlert,
  formatVarAlert,
  formatCardAlert,
  formatSubAlert,
  formatLiveCard,
} = require('./format');
const { getFlag } = require('./flags');
const { getRandomPersona } = require('../mia/personas');
const { generateRecap } = require('./recap');

const CHANNEL = process.env.BROADCAST_CHANNEL_ID;
const CHECK_INTERVAL_MS = Number(process.env.BROADCAST_INTERVAL_IN_MS) || 60_000;
const WINDOW_MS = 15 * 60_000;
const STALE_THRESHOLD_MS = 30_000;
const EVENT_DELAY_MS = 500;

const posted = new Set(); // fixture IDs with pre-match cards posted
const matchMessages = new Map(); // matchId -> messageTs
const matchPersonas = new Map(); // matchId -> persona key
let intervalId = null;

function buildFixtureCard(fixture) {
  const home = getTeamName(fixture.teams.homeTeamId);
  const away = getTeamName(fixture.teams.awayTeamId);
  const homeFlag = getFlag(fixture.teams.homeTeamId);
  const awayFlag = getFlag(fixture.teams.awayTeamId);
  const time = slackDate(fixture.dateAndTimeInUTC);

  return [
    { type: 'header', text: { type: 'plain_text', text: 'Fixture Starting Soon!' } },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${homeFlag} *${home}* vs *${away}* ${awayFlag}` },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Kickoff: ${time}` }],
    },
  ];
}

async function tick(client) {
  const now = Date.now();
  const fixtures = getUpcomingFixtures(3);

  for (const fixture of fixtures) {
    const kickoff = new Date(fixture.dateAndTimeInUTC).getTime();
    const diff = kickoff - now;

    if (diff > 0 && diff <= WINDOW_MS && !posted.has(fixture.id)) {
      try {
        const persona = getRandomPersona();
        const result = await client.chat.postMessage({
          channel: CHANNEL,
          blocks: buildFixtureCard(fixture),
          text: `${getTeamName(fixture.teams.homeTeamId)} vs ${getTeamName(fixture.teams.awayTeamId)} starting soon!`,
          metadata: {
            event_type: 'worldcup_match',
            event_payload: { matchId: fixture.id, persona },
          },
        });
        posted.add(fixture.id);
        matchMessages.set(fixture.id, result.ts);
        matchPersonas.set(fixture.id, persona);
        console.log(`Broadcast card posted for fixture ${fixture.id} (persona: ${persona})`);
      } catch (err) {
        console.error(`Failed to post fixture ${fixture.id}:`, err.message);
      }
    }
  }
}

async function updateCard(client, matchId, score, elapsed, matchEnded = false) {
  const ts = matchMessages.get(matchId);
  if (!ts) return;

  const fixture = getFixtureById(matchId);
  if (!fixture) return;

  const persona = matchPersonas.get(matchId) || null;

  try {
    await client.chat.update({
      channel: CHANNEL,
      ts,
      blocks: formatLiveCard(fixture, score, elapsed, matchEnded),
      text: `LIVE: ${getTeamName(fixture.teams?.homeTeamId)} ${score.home}-${score.away} ${getTeamName(fixture.teams?.awayTeamId)}`,
      metadata: {
        event_type: 'worldcup_match',
        event_payload: { matchId, persona },
      },
    });
    console.log(`Card updated for fixture ${matchId}: ${score.home}-${score.away}`);
  } catch (err) {
    if (err.data?.error === 'message_not_found' || err.data?.error === 'channel_not_found') {
      console.warn(`Removing stale message ts for fixture ${matchId}: ${err.data.error}`);
      matchMessages.delete(matchId);
    } else {
      // Surface the Slack error code (e.g. invalid_blocks) so card-rendering
      // bugs are diagnosable rather than silently freezing the live card.
      console.error(
        `Failed to update card for fixture ${matchId} (${err.data?.error || 'unknown'}):`,
        err.message,
      );
    }
  }
}

async function postEventAlert(client, matchId, event, score, detectedAt) {
  // Staleness check
  if (Date.now() - detectedAt > STALE_THRESHOLD_MS) {
    console.log(`Dropped stale event for fixture ${matchId}: ${event.type} at ${event.minute}'`);
    return;
  }

  // Incomplete event filter
  if (event.type !== 'Var') {
    const name = event.playerName;
    if (!name || name.trim() === '' || name.trim().toLowerCase() === 'unknown') {
      console.log(
        `Filtered incomplete event for fixture ${matchId}: ${event.type} at ${event.minute}' (no valid player)`,
      );
      return;
    }
  }

  const ts = matchMessages.get(matchId);

  // If no card was posted yet, post an initial live card
  if (!ts) {
    const fixture = getFixtureById(matchId);
    if (!fixture) return;

    try {
      const persona = getRandomPersona();
      const result = await client.chat.postMessage({
        channel: CHANNEL,
        blocks: formatLiveCard(fixture, score, null),
        text: `LIVE: ${getTeamName(fixture.teams?.homeTeamId)} ${score.home}-${score.away} ${getTeamName(fixture.teams?.awayTeamId)}`,
        metadata: {
          event_type: 'worldcup_match',
          event_payload: { matchId, persona },
        },
      });
      matchMessages.set(matchId, result.ts);
      matchPersonas.set(matchId, persona);
      console.log(`Initial live card posted for fixture ${matchId} (persona: ${persona})`);
    } catch (err) {
      console.error(`Failed to post initial card for fixture ${matchId}:`, err.message);
      return;
    }
  }

  const threadTs = matchMessages.get(matchId);
  const fixture = getFixtureById(matchId);

  // Format based on event type
  let blocks;
  if (event.type === 'Goal' && event.detail === 'Missed Penalty') {
    blocks = formatMissedPenaltyAlert(event);
  } else if (event.type === 'Goal') {
    blocks = formatGoalAlert(event, score, fixture);
  } else if (event.type === 'Card') {
    blocks = formatCardAlert(event);
  } else if (event.type === 'subst') {
    blocks = formatSubAlert(event);
  } else if (event.type === 'Var') {
    blocks = formatVarAlert(event);
  } else {
    return; // Unknown event type, skip
  }

  try {
    await client.chat.postMessage({
      channel: CHANNEL,
      thread_ts: threadTs,
      blocks,
      text: `${event.type}: ${event.playerName || 'Unknown'} ${event.minute}'`,
    });
    console.log(`Event alert posted for fixture ${matchId}: ${event.type} at ${event.minute}'`);
  } catch (err) {
    if (err.data?.error === 'message_not_found' || err.data?.error === 'channel_not_found') {
      console.warn(`Removing stale message ts for fixture ${matchId}: ${err.data.error}`);
      matchMessages.delete(matchId);
    } else {
      console.error(`Failed to post event for fixture ${matchId}:`, err.message);
    }
  }
}

async function handleDiffs(client, diffs) {
  for (const diff of diffs) {
    const { fixtureId, newEvents, currentScore, scoreChanged, elapsedChanged, elapsed } = diff;

    // Card updates first (higher priority than event posts). The initial diff
    // must flip pre-match to live; match-end must flip to finished card.
    if (scoreChanged || elapsedChanged || diff.initial || diff.matchEnded) {
      await updateCard(client, fixtureId, currentScore, elapsed, diff.matchEnded);
    }

    if (diff.matchEnded) {
      const persona = matchPersonas.get(fixtureId) || null;
      generateRecap(client, fixtureId, persona).catch((err) => {
        console.error(`Recap failed for fixture ${fixtureId}:`, err.message);
      });
    }

    // Per-fixture timestamp so sequential processing of earlier diffs doesn't
    // starve later fixtures past the staleness threshold.
    const detectedAt = Date.now();
    for (let i = 0; i < newEvents.length; i++) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, EVENT_DELAY_MS));
      }
      await postEventAlert(client, fixtureId, newEvents[i], currentScore, detectedAt);
    }
  }
}

function start(client) {
  intervalId = setInterval(() => tick(client), CHECK_INTERVAL_MS);
  tick(client);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function reset() {
  posted.clear();
  matchMessages.clear();
  matchPersonas.clear();
}

function getMatchMessage(matchId) {
  return matchMessages.get(matchId) || null;
}

module.exports = {
  start,
  stop,
  reset,
  tick,
  buildFixtureCard,
  posted,
  matchMessages,
  matchPersonas,
  updateCard,
  postEventAlert,
  handleDiffs,
  getMatchMessage,
};
