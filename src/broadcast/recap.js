'use strict';

const { ask } = require('../mia');
const { getRecapPrompt } = require('../mia/personas');
const cache = require('../live-data/cache');
const { getFixtureById, getTeamName } = require('../data');
const { getFlag } = require('./flags');

const CHANNEL = process.env.BROADCAST_CHANNEL_ID;

const RECAP_USER_PROMPT =
  'Write a brief, engaging match recap in 2-3 paragraphs.' +
  ' Cover the key moments, turning points, and final result.' +
  ' Do not use XML tags. Write plain text only.';

function buildRecapContext(liveData, fixture) {
  const home = getTeamName(fixture.teams?.homeTeamId) || 'Home';
  const away = getTeamName(fixture.teams?.awayTeamId) || 'Away';
  const score = liveData.finalScore || { home: 0, away: 0 };
  const events = liveData.events || [];
  const statistics = liveData.statistics || [];

  const parts = [];

  // Header
  parts.push(`Teams: ${home} ${score.home}-${score.away} ${away}`);
  parts.push(`Status: ${liveData.status || 'Match Finished'}`);

  // Goals
  const goals = events.filter((e) => e.type === 'Goal');
  if (goals.length > 0) {
    const goalLines = goals.map((g) => {
      const minute = g.extraMinute ? `${g.minute}+${g.extraMinute}'` : `${g.minute}'`;
      const team = getTeamName(g.teamId) || 'Unknown';
      let detail = '';
      if (g.detail === 'Own Goal') detail = ', Own Goal';
      else if (g.detail === 'Penalty') detail = ', Penalty';
      else if (g.detail === 'Missed Penalty') detail = ', Missed Penalty';
      return `- ${g.playerName || 'Unknown'} ${minute} (${team}${detail})`;
    });
    parts.push('\nGoals:\n' + goalLines.join('\n'));
  } else {
    parts.push('\nGoals: None');
  }

  // Cards
  const cards = events.filter((e) => e.type === 'Card');
  if (cards.length > 0) {
    const cardLines = cards.map((c) => {
      const minute = c.extraMinute ? `${c.minute}+${c.extraMinute}'` : `${c.minute}'`;
      const team = getTeamName(c.teamId) || 'Unknown';
      const cardType = c.detail || 'Yellow Card';
      return `- ${c.playerName || 'Unknown'} ${cardType} ${minute} (${team})`;
    });
    parts.push('\nCards:\n' + cardLines.join('\n'));
  }

  // Substitutions
  const subs = events.filter((e) => e.type === 'subst');
  if (subs.length > 0) {
    const subLines = subs.map((s) => {
      const minute = s.extraMinute ? `${s.minute}+${s.extraMinute}'` : `${s.minute}'`;
      const team = getTeamName(s.teamId) || 'Unknown';
      const playerOff = s.playerName || 'Unknown';
      const playerOn = s.assistPlayerName || 'Unknown';
      return `- ${playerOn} -> ${playerOff} ${minute} (${team})`;
    });
    parts.push('\nSubstitutions:\n' + subLines.join('\n'));
  }

  // Statistics
  if (statistics.length > 0) {
    const statLines = statistics.map((teamStat) => {
      const team = getTeamName(teamStat.teamId) || 'Unknown';
      const stats = (teamStat.statistics || [])
        .filter((s) => s.value != null)
        .map((s) => `${s.type}: ${s.value}`)
        .join(', ');
      return `- ${team}: ${stats || 'No data'}`;
    });
    parts.push('\nStatistics:\n' + statLines.join('\n'));
  } else {
    parts.push('\nStatistics: not available.');
  }

  return 'Match Summary:\n===\n' + parts.join('\n') + '\n===';
}

// Format goal scorers for recap context line.
function formatRecapScorers(events, fixture) {
  if (!events || events.length === 0) return '';

  const goals = events.filter((e) => e.type === 'Goal' && e.detail !== 'Missed Penalty');
  if (goals.length === 0) return '';

  const homeTeamId = fixture.teams?.homeTeamId;
  const awayTeamId = fixture.teams?.awayTeamId;

  function fmtGoal(goal, teamId) {
    const flag = getFlag(teamId);
    const name = goal.playerName || 'Unknown';
    const minute = goal.extraMinute ? `${goal.minute}+${goal.extraMinute}'` : `${goal.minute}'`;
    const og = goal.detail === 'Own Goal' ? ' (OG)' : '';
    return `${flag} ${name}${og} ${minute}`;
  }

  const homeParts = goals.filter((g) => g.teamId === homeTeamId).map((g) => fmtGoal(g, homeTeamId));
  const awayParts = goals.filter((g) => g.teamId === awayTeamId).map((g) => fmtGoal(g, awayTeamId));

  if (homeParts.length > 0 && awayParts.length > 0) {
    return `${homeParts.join('  ')} · ${awayParts.join('  ')}`;
  }
  return [...homeParts, ...awayParts].join('  ') || '';
}

// Build Block Kit blocks for post-match recap card.
function buildRecapBlocks(fixture, liveData, recapText) {
  const homeId = fixture.teams?.homeTeamId;
  const awayId = fixture.teams?.awayTeamId;
  const home = getTeamName(homeId) || 'Home';
  const away = getTeamName(awayId) || 'Away';
  const homeFlag = getFlag(homeId);
  const awayFlag = getFlag(awayId);
  const score = liveData.finalScore || { home: 0, away: 0 };

  const scoreLine = `${homeFlag} *${home}*  \`${score.home} - ${score.away}\`  *${away}* ${awayFlag}`;
  const scorers = formatRecapScorers(liveData.events, fixture);
  const stage = fixture.stage || '';
  const group = fixture.group || '';
  const meta = [stage, group].filter(Boolean).join(' · ');

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🏁 Full Time', emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: scoreLine },
    },
  ];

  // Scorers context line (only if there were goals)
  if (scorers) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: scorers }],
    });
  }

  // Stage/group context
  if (meta) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: meta }],
    });
  }

  blocks.push({ type: 'divider' });

  // AI recap text
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: recapText },
  });

  return blocks;
}

async function generateRecap(client, fixtureId, threadTs, persona) {
  const liveData = cache.getFixture(fixtureId);
  if (!liveData || liveData.stale) return;

  const fixture = getFixtureById(fixtureId);
  if (!fixture) return;

  const context = buildRecapContext(liveData, fixture);
  const systemOverride = getRecapPrompt(persona);

  const recap = await ask(RECAP_USER_PROMPT, {
    context,
    recap: true,
    systemOverride,
  });

  if (!recap) return;

  const blocks = buildRecapBlocks(fixture, liveData, recap);
  const home = getTeamName(fixture.teams?.homeTeamId) || 'Home';
  const away = getTeamName(fixture.teams?.awayTeamId) || 'Away';
  const score = liveData.finalScore || { home: 0, away: 0 };

  await client.chat.postMessage({
    channel: CHANNEL,
    text: `🏁 Full Time: ${home} ${score.home}-${score.away} ${away}\n\n${recap}`,
    blocks,
    unfurl_links: false,
    unfurl_media: false,
  });

  console.log(`Recap posted for fixture ${fixtureId}`);
}

module.exports = { buildRecapContext, buildRecapBlocks, generateRecap };
