'use strict';

function slackDate(isoString) {
  const epoch = Math.floor(new Date(isoString).getTime() / 1000);
  const fallback = new Date(isoString).toUTCString();
  return `<!date^${epoch}^{date_short} at {time}|${fallback}>`;
}

// Fixed UTC reference (same for every viewer), e.g. "12:00 UTC".
// Slack's <!date> token localizes per-viewer but has no timezone token, so we
// pair the localized time with a shared UTC anchor for cross-zone clarity.
function utcTime(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return ''; // unparseable date -> caller omits it
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

module.exports = { slackDate, utcTime };
