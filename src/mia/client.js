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

module.exports = { chat, chatWithTools };
