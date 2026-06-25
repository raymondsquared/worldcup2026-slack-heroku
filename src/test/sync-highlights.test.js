'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'sync-highlights.js');

describe('scripts/sync-highlights', () => {
  test('exits with error when HIGHLIGHTS_API_KEY is not set', () => {
    try {
      execFileSync('node', [SCRIPT_PATH], {
        env: { ...process.env, HIGHLIGHTS_API_KEY: '' },
        encoding: 'utf8',
        stdio: 'pipe',
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (err) {
      expect(err.status).toBe(1);
      expect(err.stderr).toContain('HIGHLIGHTS_API_KEY');
    }
  });
});
