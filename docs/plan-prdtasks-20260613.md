# Task Plan: Heroku MIA Slack World Cup 2026

Date: 2026-06-13

## Objective

Break down the approved PRD (docs/prd-20260613.md) into specific, actionable implementation
tasks ordered by dependencies and criticality.

## Approach

The tasks follow a layered approach - each layer depends on the previous:

1. Foundation - project scaffolding, Bolt app bootstrap (everything else depends on this)
2. Infrastructure - Heroku app creation, config vars, initial deploy (enables continuous deployment)
3. Data - static World Cup JSON + query helpers (commands and AI both need data)
4. AI Core - Heroku MIA client + guardrails (AI chat and future features depend on this)
5. Slash Commands - `/worldcup2026 schedule` and `/worldcup2026 groups` (uses data layer)
6. AI Chat - @mention + DM handlers with grounded responses (uses AI core + data)
7. Broadcasting - scheduler + match card posts (uses data layer)

After infrastructure is in place (task-3), each subsequent task (4-8) deploys to Heroku
as standard practice. MIA configuration (C-6) is handled within task-5.

## Task Summary

8 tasks total:

- 2 CRITICAL (foundation - everything depends on them)
- 6 HIGH (infrastructure, data, AI client + config, commands, AI chat, broadcasting)

## Dependency Chain

```text
task-1 (scaffolding)
  ├─> task-4 (data layer)
  └─> task-2 (Bolt bootstrap)
        ├─> task-3 (Heroku infrastructure setup)
        ├─> task-5 (AI client + guardrails + config)
        │     └─> task-7 (AI chat handlers)
        ├─> task-6 (slash commands) [also depends on task-4]
        └─> task-8 (broadcasting) [also depends on task-4]

task-4 (data layer) ─> task-6, task-7, task-8
```

## Complexity Assessment

- SMALL tasks: scaffolding, infrastructure setup
- MEDIUM tasks: Bolt bootstrap, data layer, slash commands, AI client + guardrails + config,
  AI chat, broadcasting

## Next Step

Tasks section has been generated in the PRD. Proceed to Phase 3: Task Execution.
