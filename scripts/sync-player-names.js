'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { resolvePlayerName } = require('../src/live-data/mapper');

const FIXTURES_DIR = path.join(__dirname, '..', 'src', 'data', 'fixtures');
const dryRun = process.argv.includes('--dry-run');

function syncFileNames(filePath, file) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(data.events)) return 0;

  let fieldChanges = 0;
  for (const event of data.events) {
    const resolvedPlayer = resolvePlayerName(event.playerExternalId, event.playerName);
    if (resolvedPlayer !== event.playerName) {
      console.log(`  ${file}: "${event.playerName}" -> "${resolvedPlayer}"`);
      event.playerName = resolvedPlayer;
      fieldChanges += 1;
    }

    const resolvedAssist = resolvePlayerName(event.assistPlayerExternalId, event.assistPlayerName);
    if (resolvedAssist !== event.assistPlayerName) {
      console.log(`  ${file}: assist "${event.assistPlayerName}" -> "${resolvedAssist}"`);
      event.assistPlayerName = resolvedAssist;
      fieldChanges += 1;
    }
  }

  if (fieldChanges > 0 && !dryRun) {
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  }
  return fieldChanges;
}

function run() {
  const files = fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  let filesChanged = 0;
  let fieldChanges = 0;
  let filesSkipped = 0;

  for (const file of files) {
    const filePath = path.join(FIXTURES_DIR, file);
    let changes;
    try {
      changes = syncFileNames(filePath, file);
    } catch (err) {
      console.warn(`  SKIP ${file}: ${err.message}`);
      filesSkipped += 1;
      continue;
    }
    if (changes > 0) {
      filesChanged += 1;
      fieldChanges += changes;
    }
  }

  const verb = dryRun ? 'would change' : 'changed';
  console.log(
    `\n${dryRun ? 'DRY RUN - ' : ''}${verb} ${filesChanged} file(s), ${fieldChanges} name field(s)` +
      `${filesSkipped > 0 ? `, skipped ${filesSkipped} unreadable file(s)` : ''}.`,
  );
}

run();
