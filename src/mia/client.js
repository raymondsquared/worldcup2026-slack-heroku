'use strict';

const INFERENCE_URL = process.env.INFERENCE_URL;
const INFERENCE_MODEL_ID = process.env.INFERENCE_MODEL_ID;
const INFERENCE_KEY = process.env.INFERENCE_KEY;

const TIMEOUT_IN_MS = 15000;

async function postChatCompletion(body) {
  const response = await fetch(`${INFERENCE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${INFERENCE_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_IN_MS),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown error');
    throw new Error(`MIA request failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error('MIA returned empty choices array');
  }

  return data.choices[0].message;
}

async function chat(messages, opts = {}) {
  const message = await postChatCompletion({ model: INFERENCE_MODEL_ID, messages, ...opts });
  return message.content;
}

async function chatWithTools(messages, tools, opts = {}) {
  return postChatCompletion({ model: INFERENCE_MODEL_ID, messages, tools, ...opts });
}

// Chat with automatic MCP tool execution via /v1/agents/heroku
async function chatWithAgent(messages, opts = {}) {
  const body = {
    model: INFERENCE_MODEL_ID,
    messages,
  };

  // Add MCP tools (must specify individual tool names, not namespace)
  if (opts.enableMcp) {
    body.tools = [
      { type: 'mcp', name: 'football_get_live_fixtures' },
      { type: 'mcp', name: 'football_get_fixtures_by_date' },
      { type: 'mcp', name: 'football_get_fixture_details' },
      { type: 'mcp', name: 'football_get_standings' },
      { type: 'mcp', name: 'football_get_team_squad' },
    ];
  }

  const response = await fetch(`${INFERENCE_URL}/v1/agents/heroku`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${INFERENCE_KEY}`,
      'X-Forwarded-Proto': 'https',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown error');
    throw new Error(`Agent request failed (${response.status}): ${errorBody}`);
  }

  const text = await response.text();
  const lines = text.split('\n');

  let finalContent = '';

  for (const line of lines) {
    if (line.startsWith('data:')) {
      const data = line.slice(5).trim();

      if (data === '[DONE]') {
        break;
      }

      try {
        const parsed = JSON.parse(data);

        const toolCalls = parsed.choices?.[0]?.message?.tool_calls;
        if (toolCalls) {
          const toolNames = toolCalls.map((c) => c.function?.name).filter(Boolean);
          console.log(`[mia/client] Agent tool call(s): ${toolNames.join(', ') || 'unknown'}`);
        }

        if (
          parsed.choices?.[0]?.message?.role === 'assistant' &&
          parsed.choices[0].message.content
        ) {
          finalContent = parsed.choices[0].message.content;
        }
      } catch (err) {
        // Skip invalid JSON
      }
    }
  }

  if (!finalContent) {
    throw new Error('No final message received from agent endpoint');
  }

  return finalContent;
}

module.exports = { chat, chatWithTools, chatWithAgent };
