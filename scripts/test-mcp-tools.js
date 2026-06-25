'use strict';

// Test script for MCP Football API tools
// Run with: node --env-file=.env scripts/test-mcp-tools.js

const { spawn } = require('child_process');

// Test cases
const tests = [
  {
    name: 'List all tools',
    request: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    validate: (response) => {
      if (!response.result?.tools) return 'Missing result.tools';
      if (response.result.tools.length !== 5) return `Expected 5 tools, got ${response.result.tools.length}`;
      const names = response.result.tools.map((t) => t.name);
      const expected = [
        'football_get_live_fixtures',
        'football_get_fixtures_by_date',
        'football_get_fixture_details',
        'football_get_team_squad',
        'football_get_standings',
      ];
      for (const name of expected) {
        if (!names.includes(name)) return `Missing tool: ${name}`;
      }
      return null;
    },
  },
  {
    name: 'Get live fixtures',
    request: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'football_get_live_fixtures', arguments: {} },
    },
    validate: (response) => {
      if (!response.result?.content?.[0]?.text) return 'Missing result content';
      const data = JSON.parse(response.result.content[0].text);
      if (typeof data.results !== 'number') return 'Missing results count';
      if (!Array.isArray(data.response)) return 'Missing response array';
      return null;
    },
  },
  {
    name: 'Get fixtures by date (valid)',
    request: {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'football_get_fixtures_by_date', arguments: { date: '2026-06-11' } },
    },
    validate: (response) => {
      if (!response.result?.content?.[0]?.text) return 'Missing result content';
      const data = JSON.parse(response.result.content[0].text);
      if (typeof data.results !== 'number') return 'Missing results count';
      return null;
    },
  },
  {
    name: 'Get fixtures by date (invalid format)',
    request: {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'football_get_fixtures_by_date', arguments: { date: 'invalid' } },
    },
    validate: (response) => {
      if (!response.result?.isError) return 'Expected error response';
      const data = JSON.parse(response.result.content[0].text);
      if (!data.error) return 'Missing error field';
      if (!data.message.includes('Invalid date format')) return 'Wrong error message';
      return null;
    },
  },
  {
    name: 'Get standings (defaults)',
    request: {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'football_get_standings', arguments: {} },
    },
    validate: (response) => {
      if (!response.result?.content?.[0]?.text) return 'Missing result content';
      const data = JSON.parse(response.result.content[0].text);
      if (typeof data.results !== 'number') return 'Missing results count';
      return null;
    },
  },
  {
    name: 'Get fixture details (with ID)',
    request: {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'football_get_fixture_details', arguments: { fixture_id: 1489407 } },
    },
    validate: (response) => {
      if (!response.result?.content?.[0]?.text) return 'Missing result content';
      const data = JSON.parse(response.result.content[0].text);
      if (typeof data.results !== 'number') return 'Missing results count';
      return null;
    },
  },
  {
    name: 'Get team squad (with ID)',
    request: {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'football_get_team_squad', arguments: { team_id: 2502 } },
    },
    validate: (response) => {
      if (!response.result?.content?.[0]?.text) return 'Missing result content';
      const data = JSON.parse(response.result.content[0].text);
      if (typeof data.results !== 'number') return 'Missing results count';
      return null;
    },
  },
];

// Run a single test
async function runTest(test) {
  return new Promise((resolve) => {
    const child = spawn('node', ['src/mcp/football-server.js'], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0 && !stdout) {
        resolve({ success: false, error: `Process exited with code ${code}: ${stderr}` });
        return;
      }

      try {
        const response = JSON.parse(stdout);
        const error = test.validate(response);
        if (error) {
          resolve({ success: false, error });
        } else {
          resolve({ success: true });
        }
      } catch (err) {
        resolve({ success: false, error: `Failed to parse response: ${err.message}` });
      }
    });

    // Send request
    child.stdin.write(JSON.stringify(test.request) + '\n');
    child.stdin.end();

    // Timeout after 10 seconds
    setTimeout(() => {
      child.kill();
      resolve({ success: false, error: 'Test timeout' });
    }, 10000);
  });
}

// Run all tests
async function runAllTests() {
  console.log('MCP Football API Tools - Test Suite');
  console.log('====================================\n');

  // Check environment
  if (!process.env.FOOTBALL_API_KEY) {
    console.error('❌ FOOTBALL_API_KEY environment variable not set');
    console.error('   Run with: node --env-file=.env scripts/test-mcp-tools.js');
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    process.stdout.write(`${test.name}... `);
    const result = await runTest(test);

    if (result.success) {
      console.log('✅ PASS');
      passed++;
    } else {
      console.log(`❌ FAIL`);
      console.log(`   ${result.error}`);
      failed++;
    }
  }

  console.log('\n====================================');
  console.log(`Tests: ${passed} passed, ${failed} failed, ${tests.length} total`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runAllTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
