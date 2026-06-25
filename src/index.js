'use strict';

const REQUIRED_ENV_VARS = [
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_APP_TOKEN',
  'INFERENCE_URL',
  'INFERENCE_MODEL_ID',
  'INFERENCE_KEY',
  'BROADCAST_CHANNEL_ID',
  'FOOTBALL_API_KEY',
  'WEB_SEARCH_API_KEY',
  'HIGHLIGHTS_API_KEY',
];

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Set these in your Heroku config vars or local .env file.',
    );
  }
}

async function start() {
  validateEnv();

  const { app } = require('./app');
  const scheduler = require('./broadcast/scheduler');
  const highlightsScheduler = require('./highlights/scheduler');
  const livePoller = require('./live-data/poller');
  const liveCache = require('./live-data/cache');
  const { setLiveCache } = require('./data');

  setLiveCache(liveCache);

  await app.start();

  // Poller -> broadcaster
  livePoller.onChanges((diffs) => scheduler.handleDiffs(app.client, diffs));

  livePoller.start();

  scheduler.start(app.client);
  highlightsScheduler.start(app.client);

  // Predictable daily restart to reset dedup state and avoid mid-match Heroku cycling.
  const { scheduleRestart } = require('./lib/restart-scheduler');
  scheduleRestart();

  console.log('World Cup 2026 Slack app is running (Socket Mode)');
}

// Safety nets: log before crash to avoid silent dyno termination.
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  console.error('Unhandled promise rejection:', message);
});

// Undefined state after uncaught exception; log and exit for dyno restart.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.stack || err.message);
  process.exit(1);
});

start().catch((err) => {
  console.error('Failed to start app:', err.message);
  process.exit(1);
});
