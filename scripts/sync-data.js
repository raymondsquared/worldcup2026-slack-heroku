#!/usr/bin/env node
'use strict';

// CLI entrypoint. Logic lives in src/lib/sync-data (imported by tests).

// Validate env early; lib require triggers api module load.
if (!process.env.FOOTBALL_API_KEY) {
  console.error('Error: FOOTBALL_API_KEY environment variable is required.');
  console.error('Set it in your .env file or export it before running this script.');
  process.exit(1);
}

const { COMMANDS } = require('../src/lib/sync-data');

const command = process.argv[2] || 'all';

// Optional fixture ID (e.g. sync-data.js fixture-events 1)
const fixtureId = process.argv[3] ? Number(process.argv[3]) : undefined;

if (!COMMANDS[command]) {
  console.error(`Unknown command: ${command}`);
  console.error(`Available: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(1);
}

COMMANDS[command](fixtureId).catch((err) => {
  console.error(`\nSync failed: ${err.message}`);
  process.exit(1);
});
