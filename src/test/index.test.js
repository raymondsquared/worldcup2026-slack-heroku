'use strict';

process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';
process.env.SLACK_APP_TOKEN = 'xapp-test-app-token';
process.env.INFERENCE_URL = 'https://test-mia.heroku.com';
process.env.INFERENCE_MODEL_ID = 'test-model';
process.env.INFERENCE_KEY = 'test-key';
process.env.BROADCAST_CHANNEL_ID = 'C-test-channel';
process.env.FOOTBALL_API_KEY = 'test-football-api-key';
process.env.WEB_SEARCH_API_KEY = 'test-web-search-key';

const { App } = require('@slack/bolt');
const { app } = require('../app');

describe('app module', () => {
  test('exports an app instance', () => {
    expect(app).toBeDefined();
  });

  test('app is an instance of Bolt App', () => {
    expect(app).toBeInstanceOf(App);
  });

  test('app is configured for socket mode', () => {
    expect(app.receiver).toBeDefined();
    expect(app.receiver.constructor.name).toBe('SocketModeReceiver');
  });
});
