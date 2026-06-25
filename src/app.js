'use strict';

const { App } = require('@slack/bolt');
const { register: registerWorldcup } = require('./commands/worldcup');
const { register: registerChat } = require('./handlers/chat');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  // Skip startup token check in tests (fake tokens) to avoid unhandled rejections.
  tokenVerificationEnabled: process.env.NODE_ENV !== 'test',
});

registerWorldcup(app);
registerChat(app);

module.exports = { app };
