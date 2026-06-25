# Heroku Deployment

## Prerequisites

- [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli) installed and
  authenticated (`heroku login`)
- Git remote configured: `heroku git:remote -a rb-heroku-mia-slack-worldcup2026`

## Config Vars

Set the required environment variables before deploying:

```bash
# Slack credentials
heroku config:set SLACK_BOT_TOKEN=xoxb-your-bot-token
heroku config:set SLACK_SIGNING_SECRET=your-signing-secret
heroku config:set SLACK_APP_TOKEN=xapp-your-app-level-token

# Heroku Managed Inference
heroku config:set INFERENCE_URL=https://us.inference.heroku.com
heroku config:set INFERENCE_MODEL_ID=your-model-name
heroku config:set INFERENCE_KEY=your-mia-api-key

# Match broadcasting
heroku config:set BROADCAST_CHANNEL_ID=C-your-channel-id

# Live match data
heroku config:set FOOTBALL_API_KEY=your-football-api-key

# Web search fallback
heroku config:set WEB_SEARCH_API_KEY=your-web-search-api-key

# Match highlights
heroku config:set HIGHLIGHTS_API_KEY=your-highlights-api-key
```

Verify they are set:

```bash
heroku config
```

> Never commit secrets to the repository. All credentials live in Heroku
> config vars only.

## Deploy

Push the main branch to Heroku:

```bash
git push heroku main
```

Heroku will detect the Node.js buildpack, install dependencies, and start the
worker dyno as defined in the `Procfile`.

## Verify

Check the dyno is running:

```bash
heroku ps
```

Expected output shows the `worker` dyno in `up` state.

Tail the logs to confirm startup:

```bash
heroku logs --tail
```

Look for: `World Cup 2026 Slack app is running (Socket Mode)`

## Scale

The worker dyno runs at 1 instance by default. To adjust:

```bash
heroku ps:scale worker=1
```

There is no web dyno - this app uses Socket Mode (outbound WebSocket) and does
not bind an HTTP port.

## Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `Missing required environment variables` | Config vars not set | Run `heroku config:set` for each missing var |
| Worker crashes immediately | Invalid token format | Verify tokens in Slack app settings |
| H10 timeout on web | Web dyno accidentally scaled up | `heroku ps:scale web=0` |
| R10 boot timeout | Should not occur (worker type) | Check `heroku logs` for startup errors |
