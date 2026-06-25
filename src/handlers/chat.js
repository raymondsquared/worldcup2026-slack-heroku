'use strict';

const { ask } = require('../mia');
const { buildMatchContext } = require('./match-context');

function stripMention(text) {
  return text.replace(/<@[A-Z0-9]+>/g, '').trim();
}

async function detectMatchFromThread(client, event) {
  // Only look for metadata in broadcast channel threads
  if (!event.thread_ts) return null;
  if (event.channel !== process.env.BROADCAST_CHANNEL_ID) return null;

  try {
    const result = await client.conversations.history({
      channel: event.channel,
      latest: event.thread_ts,
      limit: 1,
      inclusive: true,
      include_all_metadata: true,
    });

    const parentMessage = result.messages?.[0];
    const payload = parentMessage?.metadata?.event_payload;
    const matchId = payload?.matchId;

    if (typeof matchId === 'number') {
      return { matchId, persona: payload.persona || null };
    }
    return null;
  } catch (err) {
    console.error('Failed to fetch thread parent metadata:', err.message);
    return null;
  }
}

function register(app) {
  app.event('app_mention', async ({ event, say, client }) => {
    try {
      const text = stripMention(event.text);

      // Try to detect match context and persona from broadcast thread
      const threadInfo = await detectMatchFromThread(client, event);
      let reply;

      if (threadInfo) {
        const { matchId, persona } = threadInfo;
        const context = buildMatchContext(matchId);
        reply = context ? await ask(text, { context, persona }) : await ask(text, { persona });
      } else {
        reply = await ask(text);
      }

      await say({ text: reply, thread_ts: event.thread_ts || event.ts });
    } catch (err) {
      console.error('Mention handler error:', err);
      await say({
        text: 'Sorry, something went wrong. Please try again.',
        thread_ts: event.thread_ts || event.ts,
      });
    }
  });

  app.message(async ({ message, say }) => {
    if (message.bot_id) return;
    if (message.channel_type !== 'im') return;
    if (!message.text) return;

    try {
      const reply = await ask(message.text);
      await say(reply);
    } catch (err) {
      console.error('DM handler error:', err);
      await say('Sorry, something went wrong. Please try again.');
    }
  });
}

module.exports = { register, stripMention, detectMatchFromThread };
