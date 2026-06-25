'use strict';

const { getFixtureById, getFixtureEvents, getLiveScore, getTeamName } = require('../data');

function buildMatchContext(matchId) {
  // Input validation
  if (typeof matchId !== 'number' || !Number.isFinite(matchId)) {
    return null;
  }

  const fixture = getFixtureById(matchId);
  if (!fixture) return null;

  const homeName = getTeamName(fixture.teams?.homeTeamId) || 'Home';
  const awayName = getTeamName(fixture.teams?.awayTeamId) || 'Away';
  const homeId = fixture.teams?.homeTeamId || '';
  const awayId = fixture.teams?.awayTeamId || '';

  const parts = [];
  parts.push(`Match: ${homeName} vs ${awayName}`);

  // Get live score data
  const score = getLiveScore(matchId);

  if (score) {
    // Build status line
    const elapsed = score.elapsed != null ? ` (${score.elapsed}')` : '';
    parts.push(`Status: ${score.status}${elapsed}`);
    parts.push(`Score: ${homeName} ${score.home} - ${score.away} ${awayName}`);

    if (score.stale) {
      parts.push('(data may be outdated)');
    }
  } else {
    // No score available - match not started or no data
    parts.push(`Status: ${fixture.status || 'Not Started'}`);
    if (fixture.dateAndTimeInUTC) {
      parts.push(`Kickoff: ${fixture.dateAndTimeInUTC}`);
    }
  }

  // Get events
  const events = getFixtureEvents(matchId);
  if (events.length > 0) {
    parts.push('Events:');
    for (const event of events) {
      const minute = event.extraMinute
        ? `${event.minute}+${event.extraMinute}'`
        : `${event.minute}'`;
      const team = event.teamId ? getTeamName(event.teamId) : '';
      const teamSuffix = team ? ` - ${team}` : '';

      if (event.type === 'Goal') {
        const assist = event.assistPlayerName ? ` (assist: ${event.assistPlayerName})` : '';
        const detail = event.detail === 'Own Goal' ? ' (OG)' : '';
        const detail2 = event.detail === 'Penalty' ? ' (pen)' : '';
        parts.push(
          `- ${minute} Goal: ${event.playerName}${assist}${detail}${detail2}${teamSuffix}`,
        );
      } else if (event.type === 'Card') {
        parts.push(`- ${minute} ${event.detail || 'Card'}: ${event.playerName}${teamSuffix}`);
      } else if (event.type === 'subst') {
        parts.push(
          `- ${minute} Sub: ${event.assistPlayerName} on, ${event.playerName} off${teamSuffix}`,
        );
      }
    }
  } else if (score) {
    parts.push('No events yet.');
  }

  parts.push(`Teams: ${homeName} (${homeId}), ${awayName} (${awayId})`);

  return parts.join('\n');
}

module.exports = { buildMatchContext };
