'use strict';

const DEFAULT_RESTART_HOUR = 11;

// Parse to int in [0,23]; avoids || which treats valid hour 0 as falsy.
function parseRestartHour(raw) {
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0 && n <= 23) {
    return n;
  }
  return DEFAULT_RESTART_HOUR;
}

const RESTART_HOUR = parseRestartHour(process.env.DAILY_RESTART_HOUR_IN_UTC);

let restartTimer = null;

function scheduleRestart() {
  const now = new Date();
  const target = new Date(now);
  target.setUTCHours(RESTART_HOUR, 0, 0, 0);

  if (target <= now) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  const delay = target.getTime() - now.getTime();
  const hours = Math.round((delay / 3600000) * 10) / 10;

  console.log(`[restart-scheduler] Restart scheduled at ${RESTART_HOUR}:00 UTC (in ${hours}h)`);

  restartTimer = setTimeout(() => {
    console.log('[restart-scheduler] Scheduled restart - exiting for dyno cycle');
    process.exit(0);
  }, delay);

  restartTimer.unref();
}

function cancel() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
}

module.exports = { scheduleRestart, cancel };
