'use strict';

const { getTeamName } = require('../data');
const { getFlag } = require('./flags');

function teamFlagPrefix(event) {
  return event.teamId ? `${getFlag(event.teamId)} ` : '';
}

/**
 * Format a goal alert for posting to a match thread.
 * Example: ⚽ Goal! J. Quinones (E. Lira) · 23' · MEX 1-0 RSA
 */
function formatGoalAlert(event, score, fixture) {
  const scorer = event.playerName || 'Unknown';
  const assist = event.assistPlayerName ? ` (${event.assistPlayerName})` : '';
  const minute = event.extraMinute ? `${event.minute}+${event.extraMinute}'` : `${event.minute}'`;
  const home = getTeamName(fixture.teams?.homeTeamId) || 'Home';
  const away = getTeamName(fixture.teams?.awayTeamId) || 'Away';
  const scoreText = `${home} ${score.home}-${score.away} ${away}`;

  const detail = event.detail === 'Own Goal' ? ' (OG)' : '';
  const flag = teamFlagPrefix(event);

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⚽ *Goal!* ${flag}${scorer}${assist}${detail} · ${minute}\n${scoreText}`,
      },
    },
  ];
}

/**
 * Format a card alert (yellow/red) for posting to a match thread.
 * Example: 🟨 Yellow Card · Player · 45'
 */
function formatCardAlert(event) {
  const player = event.playerName || 'Unknown';
  const minute = event.extraMinute ? `${event.minute}+${event.extraMinute}'` : `${event.minute}'`;

  const isRed = event.detail === 'Red Card' || event.detail === 'Second Yellow card';
  const emoji = isRed ? '🟥' : '🟨';
  const label = isRed ? 'Red Card' : 'Yellow Card';
  const flag = teamFlagPrefix(event);

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *${label}* · ${flag}${player} · ${minute}`,
      },
    },
  ];
}

/**
 * Format a missed penalty alert.
 * Example: ❌ Missed Penalty · Player · 55'
 */
function formatMissedPenaltyAlert(event) {
  const player = event.playerName || 'Unknown';
  const minute = event.extraMinute ? `${event.minute}+${event.extraMinute}'` : `${event.minute}'`;
  const flag = teamFlagPrefix(event);

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `❌ *Missed Penalty* · ${flag}${player} · ${minute}`,
      },
    },
  ];
}

/**
 * Format a VAR decision alert.
 * Example: 📺 VAR · Goal cancelled · 67'
 */
function formatVarAlert(event) {
  const detail = event.detail || 'Decision';
  const minute = event.extraMinute ? `${event.minute}+${event.extraMinute}'` : `${event.minute}'`;

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `📺 *VAR* · ${detail} · ${minute}`,
      },
    },
  ];
}

/**
 * Format a substitution alert for posting to a match thread.
 * Example: 🔄 Sub · Player On ↔ Player Off · 60'
 */
function formatSubAlert(event) {
  const playerOn = event.assistPlayerName || 'Unknown';
  const playerOff = event.playerName || 'Unknown';
  const minute = event.extraMinute ? `${event.minute}+${event.extraMinute}'` : `${event.minute}'`;
  const flag = teamFlagPrefix(event);

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🔄 *Sub* · ${flag}${playerOn} ↔ ${playerOff} · ${minute}`,
      },
    },
  ];
}

/**
 * Build scorers context line grouped by team.
 * Format: "{homeFlag} Scorer min' {homeFlag} Scorer min' · {awayFlag} Scorer min'"
 */
function formatScorers(events, fixture) {
  if (!events || events.length === 0) return 'No goals yet';

  const goals = events.filter((e) => e.type === 'Goal' && e.detail !== 'Missed Penalty');

  if (goals.length === 0) return 'No goals yet';

  const homeTeamId = fixture.teams?.homeTeamId;
  const awayTeamId = fixture.teams?.awayTeamId;

  const homeGoals = goals.filter((g) => g.teamId === homeTeamId);
  const awayGoals = goals.filter((g) => g.teamId === awayTeamId);

  function formatGoal(goal, teamId) {
    const flag = getFlag(teamId);
    const name = goal.playerName || 'Unknown';
    const minute = goal.extraMinute ? `${goal.minute}+${goal.extraMinute}'` : `${goal.minute}'`;
    const og = goal.detail === 'Own Goal' ? ' (OG)' : '';
    return `${flag} ${name}${og} ${minute}`;
  }

  const homeParts = homeGoals.map((g) => formatGoal(g, homeTeamId));
  const awayParts = awayGoals.map((g) => formatGoal(g, awayTeamId));

  if (homeParts.length > 0 && awayParts.length > 0) {
    return `${homeParts.join('  ')} · ${awayParts.join('  ')}`;
  }
  if (homeParts.length > 0) return homeParts.join('  ');
  if (awayParts.length > 0) return awayParts.join('  ');

  // Goals exist but none matched home/away (e.g. unmapped teamId). Never return
  // an empty string - a Slack context element with empty text is rejected
  // (invalid_blocks), which would silently break the live card update.
  return 'No goals yet';
}

/**
 * Format the live card (updated broadcast card with current score).
 * 3-block layout: header (status), section (score with flags), context (scorers).
 */
function formatLiveCard(fixture, score, elapsed, matchEnded = false) {
  const home = getTeamName(fixture.teams?.homeTeamId) || 'Home';
  const away = getTeamName(fixture.teams?.awayTeamId) || 'Away';
  const homeFlag = getFlag(fixture.teams?.homeTeamId);
  const awayFlag = getFlag(fixture.teams?.awayTeamId);

  // `matchEnded` is the authoritative match-over signal from the differ
  // (buildMatchEndDiff), the SAME flag that triggers the recap. Honor it
  // directly so the card flips to a finished card in lockstep with the recap,
  // rather than waiting for the cached status string - which can still lag on
  // "Second Half" when the fixture has already dropped out of the live feed.
  const isFinished = matchEnded || (fixture.status || '').startsWith('Match Finished');
  const statusText = isFinished ? 'Match Finished' : fixture.status || 'Live';
  const statusEmoji = isFinished ? '\u{1F534}' : '\u{1F7E2}';
  const elapsedText = !isFinished && elapsed != null ? ` · ${elapsed}'` : '';
  const headerText = `${statusEmoji} ${statusText}${elapsedText}`;

  const scoreLine = `${homeFlag} *${home}* ${score.home ?? 0} - ${score.away ?? 0} *${away}* ${awayFlag}`;
  const scorersLine = formatScorers(fixture.events, fixture);

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: headerText, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: scoreLine },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: scorersLine }],
    },
  ];
}

module.exports = {
  formatGoalAlert,
  formatMissedPenaltyAlert,
  formatVarAlert,
  formatCardAlert,
  formatSubAlert,
  formatLiveCard,
};
