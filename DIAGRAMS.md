# Architecture Diagrams

## System Context Diagram (C4)

```mermaid
flowchart TD
    user["<b>Slack User</b>\n[Person]\n\nAsks World Cup questions,\nreceives match updates"]

    app["<b>World Cup 2026 Slack App</b>\n[Software System]\n[Heroku Private Space]\n\nSlack bot, live broadcasting,\nslash commands"]

    mcpserver["<b>Football API MCP Server</b>\n[Software System]\n[Heroku Common Runtime]\n\nExposes Football API data\nvia MCP protocol"]

    slack["<b>Slack</b>\n[External System]\n\nTeam messaging and\ncollaboration platform"]

    mia["<b>Heroku MIA</b>\n[External System]\n[Attached to MCP Server]\n\nAI inference and\nlanguage model service"]

    football["<b>Football Data API</b>\n[External System]\n\nLive fixtures, scores,\nevents, and squads"]

    websearch["<b>Web Search API</b>\n[External System]\n\nTavily search for\nfallback grounding"]

    highlights["<b>Highlights Video API</b>\n[External System]\n\nDaily match\nhighlight videos"]

    user -- "Slash commands,\n@mentions, DMs" --> slack
    slack -- "Events via\nWebSocket" --> app
    app -- "Block Kit responses,\nlive match cards" --> slack
    app -- "AI chat requests\n[HTTPS]" --> mia
    mia -- "MCP tool calls\n[STDIO]" --> mcpserver
    mia -- "AI responses" --> app
    app -- "Polls live fixtures,\nscores, events\n[HTTPS]" --> football
    mcpserver -- "Direct API calls\n[HTTPS]" --> football
    app -- "Fallback search\nqueries [HTTPS]" --> websearch
    app -- "Fetches highlight\nvideos [HTTPS]" --> highlights
```

Legend:

- Software System (center) - The systems being documented
- External System - Third-party systems this system depends on
- Person - End user of the system

Deployment Model:

- Slack App: Heroku Private Space (`rb-heroku-mia-slack-worldcup26`)
- MCP Server: Heroku Common Runtime (`rb-mcp-football-server`)
- Inference Add-on: Attached to MCP Server app
- Private Space app uses MCP Server's INFERENCE_URL/KEY

## Container Diagram (C4)

```mermaid
flowchart TD
    slack["<b>Slack Platform</b>\n[External System]"]
    mia["<b>Heroku MIA</b>\n[External System]"]
    football["<b>Football Data API</b>\n[External System]"]
    websearch["<b>Web Search API</b>\n[External System]"]
    highlightsapi["<b>Highlights Video API</b>\n[External System]"]

    subgraph heroku["Heroku (Basic+ Worker Dyno)"]
        bolt["<b>Bolt Runtime</b>\n[Container: Node.js]\n\nSocket Mode connection,\nevent routing"]

        commands["<b>Slash Commands</b>\n[Component]\n\n/worldcup2026 schedule\n(incl. Live Now), groups,\nhighlights"]

        chat["<b>Chat Handlers</b>\n[Component]\n\n@mentions and DMs"]

        matchcontext["<b>Match Context</b>\n[Component]\n\nThread match id ->\nlive score & events"]

        broadcast["<b>Broadcaster</b>\n[Component]\n\nPre-match cards +\nlive score/event alerts"]

        aipipeline["<b>AI Orchestrator</b>\n[Component]\n\nmia/index ask():\nruns pipeline,\ncalls MIA, audits"]

        websearchmod["<b>Web Search</b>\n[Component]\n\nFallback: search,\nsanitize results,\nrate limit"]

        guardrails["<b>Guardrail Pipeline</b>\n[Component]\n\nMask, Sanitize,\nFilterToxic, Demask"]

        personas["<b>Personas</b>\n[Component]\n\nSystem prompts:\nsporty/funny/serious,\nrecap prompts"]

        recap["<b>Recap</b>\n[Component]\n\nPost-match AI summary\ngrounded on events/stats"]

        subgraph live["Live Data Subsystem"]
            poller["<b>Poller</b>\n[Component]\n\nPassive 15-min /\nactive 15-s lifecycle,\nkickoff timer,\nbackoff + stale flag"]
            apiclient["<b>API Client</b>\n[Component]\n\nfetch /fixtures\n(x-apisports-key)"]
            mapper["<b>Mapper</b>\n[Component]\n\nAPI shape ->\ncache shape"]
            differ["<b>Differ</b>\n[Component]\n\nDetects new events\n& score changes"]
            cache["<b>Live Cache</b>\n[Component: in-memory Map]\n\nLive fixtures by id,\nstale flag"]
        end

        data["<b>Data Layer</b>\n[Component]\n\nTiered resolution:\n1) live cache\n2) detail files\n3) static schedule"]

        detailfiles[("<b>Fixture Detail Files</b>\n[JSON on disk]\n\nfixtures/{id}-{h}-{a}.json")]
        staticjson[("<b>Static Data</b>\n[JSON on disk]\n\nfixtures, teams,\nplayers")]

        sync["<b>Sync Script</b>\n[Component: npm run sync:data]\n\nOffline data refresh"]

        subgraph highlightsys["Highlights Subsystem"]
            hlscheduler["<b>Highlights Scheduler</b>\n[Component]\n\nDaily run at\nHIGHLIGHTS_RUN_HOUR_IN_UTC\n(default 12)"]
            hlclient["<b>Highlights Client</b>\n[Component]\n\nfetchPlaylistItems\n(Highlights Video API)"]
            hladapter["<b>Adapter</b>\n[Component]\n\nMatch videos\nto fixtures"]
            hlenrich["<b>Enrich</b>\n[Component]\n\nWrite highlightsURL\nto fixtures.json"]
            hldigest["<b>Digest</b>\n[Component]\n\nAI intro + Block Kit\ndaily digest"]
            hlquery["<b>Query</b>\n[Component]\n\ngetLatestHighlights\n(on-demand command)"]
        end
    end

    slack <-- "WebSocket\n(Socket Mode)" --> bolt
    bolt --> commands
    bolt --> chat

    commands --> data
    chat -- "ask(text, context)" --> aipipeline
    chat -- "thread match id" --> matchcontext
    matchcontext --> data
    aipipeline --> guardrails
    aipipeline -- "tool loop reads\n(dispatchTool whitelist)" --> data
    aipipeline <-- "HTTPS\n/v1/chat/completions" --> mia
    aipipeline -- "low confidence\nfallback" --> websearchmod
    aipipeline --> personas
    websearchmod -- "POST /search\n[HTTPS]" --> websearch

    recap -- "ask(recap: true)" --> aipipeline
    recap -- "post to channel" --> slack
    differ -- "matchEnded" --> broadcast
    broadcast -- "matchEnded" --> recap
    recap --> cache

    poller -- "GET /fixtures\n(live=all, date)\n[HTTPS]" --> apiclient
    apiclient -- "[HTTPS]" --> football
    poller --> mapper --> cache
    poller --> differ
    differ -- "score / event diffs\n(onChanges)" --> broadcast
    cache --> data
    data --> detailfiles
    data --> staticjson

    broadcast --> data
    broadcast -- "chat.postMessage,\nchat.update" --> slack

    sync -- "[HTTPS]" --> football
    sync -- "writes" --> staticjson
    sync -- "writes" --> detailfiles

    hlscheduler --> hlclient
    hlclient -- "GET playlistItems\n[HTTPS]" --> highlightsapi
    hlscheduler --> hladapter
    hladapter --> hlenrich
    hlenrich -- "writes highlightsURL" --> staticjson
    hlscheduler --> hldigest
    hldigest -- "ask(recap: true)" --> aipipeline
    hldigest --> data
    hldigest -- "chat.postMessage\n(daily digest)" --> slack
    commands -- "highlights\nsubcommand" --> hlquery
    hlquery --> data
```

## Trust Layer

The security pipeline wrapping every request. The diagram shows the safe path;
the core is one box, expanded in Agentic Flow below.

```mermaid
flowchart TD
    In["User input"] --> Mask["Data Masking"]
    Mask --> San["Prompt Defense"]
    San --> ToxIn["Toxicity Detection"]
    ToxIn --> Retr["Data Retrieval & Grounding\n(context / tools / web search)"]
    Retr --> Core["Agentic Flow\n(LLM reasons + answers)\n- see diagram below"]
    Core --> ToxOut["Toxicity Detection"]
    ToxOut --> Demask["Data Demasking"]
    Demask --> Out["Response"]
    ToxOut -.->|"masked snapshot"| Audit["Audit trail"]

    Mask -.->|"PII map"| Demask
```

- Data Masking - PII replaced with tokens (`[EMAIL_1]`); map kept for demasking.
- Prompt Defense - strip injection attempts, system overrides, delimiter escapes.
- Toxicity Detection - whole-message guard (input + output); a match swaps the whole message for a fixed canned reply.
- Data Retrieval & Grounding - context, tool loop, or web search; see Agentic Flow below.
- Audit - logs the masked, pre-demask snapshot only; the demasked response is
  never written to the log, so PII is never persisted.
- Data Demasking - restores real PII into the user-facing response only; that
  response is never logged, so real PII exists only in the returned value.

## Agentic Flow

The Trust Layer's agentic core. Each `[LLM]` node is one model call; only the
context path can be a single call.

```mermaid
flowchart TD
    Start["sanitized + masked input"] --> Retr{"explicit context\nsupplied?"}

    Retr -->|yes| Cx["context chat()\n[LLM]"]
    Retr -->|no| Tool["tool-grounding loop\nLLM plus read-only tools\n[LLM]"]

    Tool --> TR{"grounded an\nanswer?"}
    TR -->|yes| TF["final answer\n[LLM]"]
    TR -->|"no / error /\nexhausted"| Dir["direct chat()\n[LLM]"]

    Cx --> Gate{"low confidence\n+ on-topic?"}
    TF --> Gate
    Dir --> Gate

    Gate -->|no| Done(["answer"])
    Gate -->|"yes (+ results)"| Web["web-search retry\n[LLM]"]
    Web --> Done
```

## Recap Flow

```mermaid
flowchart TD
    MatchEnd[Match Ended\ndiff.matchEnded] --> Broadcaster
    Broadcaster --> Recap[generateRecap]
    Recap --> Cache[Read events/stats\nfrom cache]
    Cache --> Context[buildRecapContext]
    Context --> Ask["ask(recap: true)\npersona system prompt"]
    Ask --> MIA[Heroku MIA]
    MIA --> FilterToxic[FilterToxic]
    FilterToxic -->|safe| Post[Post to channel]
    FilterToxic -->|toxic| Skip[Skip]
    FilterToxic -.-> AuditLog
```

- Recap fires after final card is posted (fire-and-forget)
- Uses thread persona (sporty/funny/serious) for tone
- Grounded on full match events: goals, cards, subs, statistics
- Goes through ask() guardrails (toxic filter + audit) but no XML parsing
- Skips if the live cache is missing or stale, or the fixture is unknown

## Live Score

How live match data flows from the football API to Slack and grounded answers (see ADR-2).

```mermaid
flowchart TD
    football["<b>Football Data API</b>\n[External System]"]

    poller["Poller\n(active: every 15s)"]
    mapper["Mapper"]
    cache["Live Cache\n(in-memory)"]
    differ["Differ"]
    broadcast["Broadcaster"]
    recap["Recap\n(AI summary)"]
    slack["Slack"]

    data["Data Layer\n(tiered read)"]
    detail[("Detail Files")]
    static[("Static JSON")]

    schedule["/worldcup2026 schedule\n(Live Now)"]
    aichat["Thread-grounded AI\n(match context)"]

    football -- "GET /fixtures?live=all" --> poller
    poller --> mapper --> cache
    poller --> differ
    differ -- "score changed" --> broadcast
    differ -- "new events" --> broadcast
    differ -- "matchEnded" --> broadcast
    broadcast -- "chat.update (card)\nchat.postMessage (alert)" --> slack
    broadcast -- "matchEnded\n(fire-and-forget)" --> recap
    recap -- "read events/stats" --> cache
    recap -- "post to channel" --> slack

    cache -- "tier 1" --> data
    detail -- "tier 2" --> data
    static -- "tier 3" --> data
    data --> schedule
    data --> aichat

    poller -. "5 consecutive failures\n-> mark cache stale" .-> cache
```

- Poller: 15s while matches are live, 15-min passive checks otherwise. A precise kickoff
  timer (`scheduleKickoffActivation`) switches to active mode exactly at the next kickoff -
  zero wasted API calls, max 15s latency after kick.
- Tiered read (`src/data/index.js`): live cache for in-play, detail files for finished, static
  JSON for the schedule.
- Score change edits the card; new events post threaded alerts. 5 failed polls flag the cache
  stale ("data may be outdated").
- Match-end triggers recap generation (fire-and-forget): reads events/stats from cache, generates
  AI summary with persona tone, posts to match thread.
- Daily restart at a safe hour (`DAILY_RESTART_HOUR_IN_UTC`, default 11) resets in-memory
  dedup state and prevents Heroku's unpredictable 24h dyno cycling from landing mid-match.
