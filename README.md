# Heroku Managed Inference Agents - Slack App (World Cup 2026)

A Slack (Bolt) app on Node.js, deployed to Heroku, that brings Heroku Managed
Inference Agents and World Cup 2026 features into Slack.

- SEE: [AGENTS.md](AGENTS.md) for the project overview, guardrails, and code/security standards
- SEE: [.agents/workflow.md](.agents/workflow.md) for the PRD -> tasks -> execution workflow
- SEE: [DIAGRAMS.md](DIAGRAMS.md) for architecture diagrams

## Getting Started

```bash
npm install   # install dependencies
npm run dev   # run locally with live reload
```

Required environment variables (set in `.env` locally or Heroku config vars):

- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` - Slack credentials
- `INFERENCE_URL`, `INFERENCE_MODEL_ID`, `INFERENCE_KEY` - Heroku Managed Inference
- `BROADCAST_CHANNEL_ID` - Slack channel for match broadcasts
- `FOOTBALL_API_KEY` - API key for live match data
- `WEB_SEARCH_API_KEY` - Web search API key for web search fallback
- `HIGHLIGHTS_API_KEY` - API key for highlight playlist fetch

## Commands

- `npm start` - run the app
- `npm run dev` - run with live reload
- `npm test` - run tests
- `npm run lint` - lint all (JS + markdown)
- `npm run lint:js` - lint JavaScript only
- `npm run lint:md` - lint markdown only

Run `npm test` and `npm run lint` before opening a PR.

## Data Sync

Sync scripts fetch real World Cup 2026 data from the football API and write to
`src/data/` JSON files. Requires `FOOTBALL_API_KEY` in your `.env` file:

```bash
cp .env.example .env
# Edit .env and set FOOTBALL_API_KEY=your-actual-key
```

The sync commands load `.env` automatically via Node 22's `--env-file` flag.

### Sync commands

```text
npm run sync:teams              Discover the football API team IDs -> teams.json
npm run sync:fixtures           Fetch fixtures -> fixtures.json (externalIds + scores)
npm run sync:players            Fetch squads -> players/{teamId}.json (real squads)
npm run sync:fixture-events     Write fixtures/{id}.json for finished fixtures
npm run sync:highlights         Backfill highlightsURL in fixtures.json from playlist
```

Or run them together:

```bash
npm run sync:data             # all football API syncs (teams -> fixtures -> players -> fixture-events)
npm run sync:highlights       # backfill highlight URLs from playlist API
npm run sync                  # both: data then highlights
```

### Dependency chain

```text
sync:teams (must run first - other commands need externalId in teams.json)
  ├── sync:fixtures (needs team name mapping to match fixtures)
  │     ├── sync:fixture-events (needs externalId in fixtures.json)
  │     └── sync:highlights (needs fixtures.json to match videos to fixtures)
  └── sync:players (needs externalId in teams.json for squad API calls)
```

### When to run

- Initial setup: `npm run sync` once to populate all data (including highlights)
- After match days: `npm run sync:fixture-events` to persist finished fixture
  results (events, lineups) for AI grounding
- Squad changes: `npm run sync:players` if squads are updated mid-tournament
- Highlight backfill: `npm run sync:highlights` to backfill highlight URLs
  for all matchable fixtures
- Data only (no highlights): `npm run sync:data`

## Acknowledgements

- [AGENTS.md](https://agents.md/) - the open convention for giving coding agents
  project context and instructions, which this repo's `AGENTS.md` follows.
- [Salesforce Generative AI Trust Architecture](https://help.salesforce.com/s/articleView?id=ai.generative_ai_trust_arch.htm&type=5)
  - trust patterns (zero data retention, dynamic grounding, data masking,
    toxicity detection, audit trail) that inform this app's AI guardrails.
- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/) - the
  security risks (prompt injection, sensitive data disclosure, excessive agency,
  etc.) we guard against when handling LLM input and output.
