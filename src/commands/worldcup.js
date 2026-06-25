'use strict';

const { getLiveFixtures, getUpcomingFixtures, getGroups, getTeamName } = require('../data');
const { slackDate, utcTime } = require('../lib/format');
const { buildMatchBlocks } = require('../highlights/digest');
const { getLatestHighlights } = require('../highlights/query');
const { getFlag } = require('../broadcast/flags');

function liveBlocks(liveFixtures) {
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🟢 Live Now', emoji: true } },
  ];

  for (const fixture of liveFixtures) {
    const home = getTeamName(fixture.teams.homeTeamId);
    const away = getTeamName(fixture.teams.awayTeamId);
    const homeFlag = getFlag(fixture.teams.homeTeamId);
    const awayFlag = getFlag(fixture.teams.awayTeamId);
    const score = `${fixture.finalScore.home} - ${fixture.finalScore.away}`;
    const elapsed = fixture.elapsed != null ? ` (${fixture.elapsed}')` : '';
    const staleNote = fixture.stale ? ' _(data may be outdated)_' : '';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${homeFlag} ${home}  ${score}  ${away} ${awayFlag}`,
      },
    });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `${fixture.status}${elapsed}${staleNote}` }],
    });
  }

  return blocks;
}

function upcomingBlocks(fixtures) {
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '📅 Upcoming Fixtures', emoji: true } },
  ];

  for (const fixture of fixtures) {
    const home = getTeamName(fixture.teams.homeTeamId);
    const away = getTeamName(fixture.teams.awayTeamId);
    const homeFlag = getFlag(fixture.teams.homeTeamId);
    const awayFlag = getFlag(fixture.teams.awayTeamId);
    const time = slackDate(fixture.dateAndTimeInUTC);
    const utc = utcTime(fixture.dateAndTimeInUTC);
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${homeFlag} ${home}  vs  ${away} ${awayFlag}` },
    });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `🕒 ${time} · ${utc}` }],
    });
  }

  return blocks;
}

function scheduleBlocks() {
  const live = getLiveFixtures();
  const upcoming = getUpcomingFixtures(3);

  if (live.length === 0 && upcoming.length === 0) {
    return [{ type: 'section', text: { type: 'mrkdwn', text: 'No upcoming fixtures.' } }];
  }

  const blocks = [];

  if (live.length > 0) {
    blocks.push(...liveBlocks(live));
  }

  if (live.length > 0 && upcoming.length > 0) {
    blocks.push({ type: 'divider' });
  }

  if (upcoming.length > 0) {
    blocks.push(...upcomingBlocks(upcoming));
  }

  return blocks;
}

function formatGoalDiff(n) {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${n}`;
  return '±0';
}

function groupsBlocks() {
  const groups = getGroups();
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🏆 Tournament Groups', emoji: true } },
  ];

  // Groups in alphabetical order (Group A -> Group L)
  const groupNames = Object.keys(groups).sort();

  for (const group of groupNames) {
    // Teams ranked within the group (1 -> 4)
    const teams = [...groups[group]].sort((a, b) => a.rank - b.rank);

    const lines = teams.map((t) => {
      const flag = getFlag(t.id);
      const pts = `${t.points} ${t.points === 1 ? 'pt' : 'pts'}`;
      return `\`${t.rank}.\` ${flag} ${t.name} - ${pts} (${formatGoalDiff(t.goalsDiff)})`;
    });

    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${group}*\n${lines.join('\n')}` },
    });
  }

  return blocks;
}

function highlightsBlocks() {
  const matches = getLatestHighlights();

  if (matches.length === 0) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'No highlights available yet. Check back after match days! ⚽',
        },
      },
    ];
  }

  const matchBlocks = buildMatchBlocks(matches);

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: '⚽ Recent Highlights', emoji: true },
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
}

function register(app) {
  app.command('/worldcup2026', async ({ command, ack, respond }) => {
    await ack();

    try {
      const subcommand = (command.text || '').trim().toLowerCase();

      if (subcommand === 'schedule') {
        await respond({ blocks: scheduleBlocks() });
      } else if (subcommand === 'groups') {
        await respond({ blocks: groupsBlocks() });
      } else if (subcommand === 'highlights') {
        await respond({ blocks: highlightsBlocks() });
      } else {
        await respond({
          text: 'Usage: `/worldcup2026 schedule` | `groups` | `highlights`',
        });
      }
    } catch (err) {
      console.error('Command error:', err);
      await respond({ text: 'Something went wrong. Please try again.' });
    }
  });
}

module.exports = { register, scheduleBlocks, groupsBlocks, highlightsBlocks };
