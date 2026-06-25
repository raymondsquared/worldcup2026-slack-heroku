'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

// Sanitize error messages to prevent API key leakage
function sanitizeError(error) {
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey || !error) return error;

  const message = error?.message || String(error);
  const sanitized = message.replace(new RegExp(apiKey, 'g'), '[REDACTED]');

  if (error instanceof Error) {
    const sanitizedError = new Error(sanitized);
    sanitizedError.stack = error.stack?.replace(new RegExp(apiKey, 'g'), '[REDACTED]');
    return sanitizedError;
  }

  return sanitized;
}

// Tool registry
const tools = [];
const toolHandlers = new Map();

// Register an MCP tool
function registerTool(toolDef, handler) {
  tools.push(toolDef);
  toolHandlers.set(toolDef.name, handler);
}

// Create and configure the MCP server
async function createServer() {
  const server = new Server(
    {
      name: 'football-api-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Handle tools/list requests
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools,
    };
  });

  // Handle tools/call requests
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const handler = toolHandlers.get(name);
      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }

      const result = await handler(args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      // Handle rate limit errors (429)
      if (error.response?.status === 429 || error.status === 429) {
        const sanitized = sanitizeError(error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: 'Rate limit exceeded',
                  message: 'Football API rate limit hit. Please try again later.',
                  details: String(sanitized),
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      // Sanitize and return generic errors
      const sanitized = sanitizeError(error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: 'Tool execution failed',
                message: sanitized.message || String(sanitized),
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// Register all MCP tools
function registerAllTools() {
  const { makeRequest, filterWorldCupFixtures } = require('./api-client');

  registerTool(
    {
      name: 'football_get_live_fixtures',
      description: 'Get currently live World Cup 2026 fixtures with scores and events',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    async () => {
      const response = await makeRequest('/fixtures', { live: 'all' });
      return filterWorldCupFixtures(response);
    },
  );

  registerTool(
    {
      name: 'football_get_fixtures_by_date',
      description: 'Get World Cup 2026 fixtures for a specific date',
      inputSchema: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Date in YYYY-MM-DD format',
            pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          },
        },
        required: ['date'],
      },
    },
    async (args) => {
      const { date } = args;
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        throw new Error('Invalid date format. Expected YYYY-MM-DD');
      }
      const response = await makeRequest('/fixtures', { date });
      return filterWorldCupFixtures(response);
    },
  );

  registerTool(
    {
      name: 'football_get_fixture_details',
      description:
        'Get detailed information for a specific fixture including events, lineups, and statistics',
      inputSchema: {
        type: 'object',
        properties: {
          fixture_id: {
            type: 'number',
            description: 'Football API fixture ID',
          },
        },
        required: ['fixture_id'],
      },
    },
    async (args) => {
      const { fixture_id } = args;
      if (typeof fixture_id !== 'number') {
        throw new Error('fixture_id must be a number');
      }
      const response = await makeRequest('/fixtures', { id: String(fixture_id) });
      return response;
    },
  );

  registerTool(
    {
      name: 'football_get_team_squad',
      description: 'Get team roster/squad for World Cup 2026',
      inputSchema: {
        type: 'object',
        properties: {
          team_id: {
            type: 'number',
            description: 'Football API team ID',
          },
        },
        required: ['team_id'],
      },
    },
    async (args) => {
      const { team_id } = args;
      if (typeof team_id !== 'number') {
        throw new Error('team_id must be a number');
      }
      const response = await makeRequest('/players/squads', { team: String(team_id) });
      return response;
    },
  );

  registerTool(
    {
      name: 'football_get_standings',
      description: 'Get group standings for World Cup 2026',
      inputSchema: {
        type: 'object',
        properties: {
          league_id: {
            type: 'number',
            description: 'League ID (defaults to World Cup 2026)',
            default: 1,
          },
          season: {
            type: 'number',
            description: 'Season year (defaults to 2026)',
            default: 2026,
          },
        },
        required: [],
      },
    },
    async (args) => {
      const league_id = args.league_id || 1;
      const season = args.season || 2026;
      const response = await makeRequest('/standings', {
        league: String(league_id),
        season: String(season),
      });
      return response;
    },
  );
}

// Main server startup
async function main() {
  try {
    if (!process.env.FOOTBALL_API_KEY) {
      throw new Error('FOOTBALL_API_KEY environment variable is required');
    }

    registerAllTools();

    const server = await createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('Football API MCP server running on stdio');
  } catch (error) {
    console.error('Failed to start MCP server:', sanitizeError(error));
    process.exit(1);
  }
}

// Export for testing
module.exports = {
  sanitizeError,
  registerTool,
  createServer,
};

// Run server if executed directly
if (require.main === module) {
  main();
}
