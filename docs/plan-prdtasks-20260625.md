# Task Breakdown Plan: World Cup 2026 Iteration 6

Date: 2026-06-25  
Agent: Product Manager  
PRD: docs/prd-20260625.md

## Overview

This plan breaks down the PRD into specific, actionable tasks with clear dependencies
and priorities. The implementation covers two features:

1. Football API MCP Server - MCP tools for chat-based AI queries
2. Match Recap Charts - Visual statistics in post-match recap cards

The implementation follows a logical progression:
infrastructure setup → MCP tool implementation → chart implementation
→ testing → deployment.

## Task Dependency Chain

```text
task-38 (Setup Environment & Core MCP Server)
  ↓
task-39 (Implement & Test 5 MCP Tools)
  ↓
task-40 (Deploy & Document MCP Server) ← Test MCP immediately!
  ↓
task-41 (Chart Utility with Tests)
  ↓
task-42 (Integrate Charts & Final Deployment)
```

## Tasks Summary

### Infrastructure & Setup

task-38: Setup Environment and Core MCP Server

- Criticality: CRITICAL
- Requirements: FR-2, TR-1, TR-4, TR-6, TR-8, ADR-7, PRD Assumptions
- Effort: 2.75-3.75 hours
- Description: Combined environment verification and core MCP server implementation.
  Verify Heroku config vars exist (`FOOTBALL_API_KEY`, `INFERENCE_URL`, `INFERENCE_KEY`),
  add MCP SDK dependency, implement base MCP server using `@modelcontextprotocol/sdk`
  with STDIO transport, tool registration framework, shared error sanitization utility,
  rate limit (429) error handling, update Procfile with `mcp-football` process
- Dependencies: none
- Deliverable: Config vars verified, `package.json` updated with `@modelcontextprotocol/sdk`,
  `src/mcp/` directory created, `src/mcp/football-server.js` with server initialization,
  tool registration handlers, shared `sanitizeError()` utility function, Procfile updated

### Feature 1: MCP Server Implementation

task-39: Implement and Test All 5 MCP Tools

- Criticality: HIGH
- Requirements: FR-1.1, FR-1.2, FR-1.3, FR-1.4, FR-1.5, FR-4, FR-6, FR-7, TR-2,
  TR-3, TR-5, TR-8, ADR-8
- Effort: 6-10 hours
- Description: Implement all 5 Football API MCP tools using shared error
  sanitization utility from task-38:
  - `football_get_live_fixtures` - Get currently live World Cup fixtures
  - `football_get_fixtures_by_date` - Get fixtures for specific date (date parameter
    validation: YYYY-MM-DD regex)
  - `football_get_fixture_details` - Get detailed fixture info with events/lineups/stats
    (fixture_id numeric validation)
  - `football_get_team_squad` - Get team roster (team_id numeric validation)
  - `football_get_standings` - Get group standings (optional league_id and season params,
    defaults to World Cup 2026)
  - Test each tool with MCP Inspector (parameter validation, error handling, API key sanitization)
  - Measure and document latency (verify < 2s p95 including cold start)
  - Pass `npm test` and `npm run lint`
- Dependencies: task-38
- Deliverable: All 5 tool handlers registered in `src/mcp/football-server.js` with parameter
  validation, World Cup filtering, error sanitization, 10-second timeouts, documented test results

### MCP Deployment & Validation

task-40: Deploy and Document MCP Server

- Criticality: CRITICAL
- Requirements: FR-2, FR-3, MCP Success Criteria
- Effort: 1.5-2.5 hours
- Description: Deploy MCP server to Heroku and validate immediately:
  - Deploy: Push to Heroku, verify MCP server registration with inference endpoint
  - Validate: Test tool calls via MCP Inspector, verify all 5 tools work in production
  - Smoke Test: Verify existing Slack bot worker still functions
  - Measure: Document cold start latency (~300-500ms expected)
  - Document: Update README with MCP server section (setup, Procfile, curl examples for all 5 tools)
  - Production Notes: Add ADR-7 reference about SSE transport for always-on production servers
- Dependencies: task-39
- Deliverable: MCP server deployed and working in production, registered and discoverable via
  `/v1/mcp/servers` and `/v1/agents/heroku`, all 5 tools validated, README updated

### Feature 2: Match Recap Charts

task-41: Chart Generation Utility with Tests

- Criticality: MEDIUM
- Requirements: FR-8, FR-9, FR-11, TR-9, TR-10, TR-11, TR-12, TR-13
- Effort: 2.5-4 hours
- Description: Create chart generation utility module using QuickChart API:
  - Implement `generatePossessionChart(homeTeam, awayTeam, homePossession, awayPossession)`
    returning donut chart URL
  - Implement `generateShotsChart(homeTeam, awayTeam, homeShots, awayShots)` returning
    horizontal bar chart URL
  - Extract statistics from liveData.statistics array (parse percentage strings)
  - Handle missing data gracefully (return null if stats unavailable)
  - URL-encode all parameters properly
  - Write unit tests validating URL generation with sample data and edge cases
  - Pass `npm test` and `npm run lint`
- Dependencies: task-40
- Deliverable: `src/broadcast/charts.js` with chart generation functions, unit tests
  in `src/test/broadcast-charts.test.js`, all tests passing

task-42: Integrate Charts and Final Deployment

- Criticality: MEDIUM
- Requirements: FR-10, FR-12, TR-5, Chart Success Criteria
- Effort: 2-3 hours
- Description: Integrate charts into recap and deploy final version:
  - Modify `src/broadcast/recap.js` to integrate charts into recap blocks
  - Call chart generation functions in `buildRecapBlocks()`
  - Add image blocks to Slack blocks array after divider and before AI recap text
  - Handle null chart URLs (skip image blocks if statistics unavailable)
  - Ensure chart generation doesn't block recap posting (timeout or try/catch)
  - Update tests in `src/test/broadcast-recap.test.js` to verify chart integration
  - Test full recap posting with charts in development Slack channel
  - Measure chart generation latency (verify < 500ms)
  - Pass `npm test` and `npm run lint`
  - Deploy: Push to Heroku, verify charts display in production Slack channel
  - Document: Update README with chart feature section (QuickChart usage, fallback behavior, performance)
- Dependencies: task-41
- Deliverable: Charts integrated into recap, deployed to production, charts display correctly
  in Slack, README.md updated with comprehensive documentation for both features

## Criticality Breakdown

- CRITICAL (2 tasks): task-38 (setup + core server), task-42 (deploy + document + validate)
- HIGH (1 task): task-39 (implement & test all 5 MCP tools)
- MEDIUM (2 tasks): task-40 (chart utility with tests), task-41 (chart integration with tests)

## Total Estimated Effort

- Infrastructure & Setup: 2.75-3.75 hours (task-38) ✅ COMPLETED
- Feature 1 (MCP Server):
  - Implement & Test 5 MCP Tools: 6-10 hours (task-39)
- Feature 2 (Charts):
  - Chart Utility with Tests: 2.5-4 hours (task-40)
  - Chart Integration with Tests: 1.5-3 hours (task-41)
- Deployment + Documentation + Validation: 2-3 hours (task-42)

Total: 15-24 hours (task-38 complete, 12-20 hours remaining)

## Risk Assessment

Low Risk:

- MCP SDK is mature and well-documented
- Football API already integrated in project
- STDIO pattern proven in Heroku examples
- QuickChart API is free and widely used
- Statistics data already flowing from Football API

Medium Risk:

- Heroku Inference setup unknown (assumption: already configured)
- Football API rate limits unknown (assumption: sufficient)
- One-off dyno cold start latency (~300-500ms) - acceptable for demo
- QuickChart service availability/rate limits unknown

Mitigation:

- Verify Heroku Inference setup in task-38 ✅ DONE
- Monitor rate limit responses during testing (task-42)
- Document cold start behavior in task-44
- ADR-7 updated with production recommendation (SSE for always-on)
- Implement graceful fallback for missing charts (skip image blocks)
- Test chart generation with production-like data in task-42

## Success Criteria Mapping

| Success Criteria                                     | Validated By                           |
| ---------------------------------------------------- | -------------------------------------- |
| MCP server registered and discoverable               | task-42                                |
| All 5 tools callable with < 2s response time         | task-39, task-42                       |
| Zero API key leaks                                   | task-39 (verify sanitization)          |
| Tool call error rate < 5%                            | task-39, task-42 (production validation) |
| MCP server deploys successfully                      | task-42                                |
| Ball possession chart displays correctly             | task-40, task-41                       |
| Total shots chart displays correctly                 | task-40, task-41                       |
| Charts render in Slack recap card                    | task-41, task-42                       |
| Charts handle missing statistics gracefully          | task-40, task-41                       |
| Chart generation adds < 500ms latency                | task-41 (measure latency)              |
| Documentation complete                               | task-42                                |

## Notes

- 5 tasks total (down from original 8): task-38 through task-42
- task-38 combines environment setup + core MCP server ✅ COMPLETED
- task-39 implements + tests all 5 MCP tools (testing integrated into implementation)
- task-40 and task-39 can run in parallel (both depend only on task-38)
- task-40/41 include their own unit and integration tests (no separate testing task)
- task-42 combines deployment + documentation + validation (all related to release)
- All MCP tools use shared error sanitization utility from task-38
- Chart generation uses free QuickChart API service (no additional costs)
- STDIO transport chosen for demo (ADR-7); SSE recommended for production
- Cold start latency (~300-500ms) acceptable for demo/tournament timeframe
- Charts gracefully degrade to text-only recap if statistics unavailable or chart service down
