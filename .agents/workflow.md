# Workflow

This document defines the multi-agent workflow for product development, from PRD creation through task execution.

## Overview

The workflow consists of three main phases, each with planning, review, execution, and human approval gates.

```text
Phase 1: PRD Generation
  Plan PRD -> Create ADRs (if decisions made) -> Validate -> Review Plan (PM) -> Human Gate -> Generate PRD -> Validate -> Review PRD (PM) -> Human Gate

Phase 2: Task Breakdown
  Plan Tasks -> Create ADRs (if decisions made) -> Validate -> Review Plan (SE) -> Human Gate -> Generate Tasks -> Validate -> Review Tasks (SE) -> Human Gate

Phase 3: Task Execution (repeat per task, ordered by dependencies then criticality)
  Status->IN_PROGRESS -> Plan Task -> Create ADRs (if decisions made) -> Validate -> Review Plan (SE) -> Human Gate -> Execute Task -> Review Code (SE) -> Human Gate -> Status->DONE
```

The Orchestrator coordinates the workflow and delegates to specialist agents:

- Delegates PRD work to Product Manager (Phase 1 and 2)
- Delegates implementation work to Software Engineer (Phase 3)
- Software Engineer creates ADRs (docs/adr-N-YYYYMMDD.md) after creating individual task plans
  when architectural or design decisions are made
- Spawns independent review subagents with appropriate personas for objective review
- Orchestrator validates all reviews and maintains quality across phases

For detailed agent procedures, see:

- specialists/orchestrator.md - Orchestrator runbooks and recovery procedures
- specialists/product-manager.md - Product Manager runbooks and PRD creation
- specialists/software-engineer.md - Software Engineer runbooks and implementation

All agents must follow the guardrails defined in:

- AGENTS.md - Project guardrails including Zero Data Retention, Secure Data Retrieval,
  Prompt Defense, Data Masking, Toxicity Detection, and Comprehensive Audit Trail

## Phase 1: PRD Generation

- Plan PRD
  - Agent: Product Manager
  - Input: Ask questions until you have enough information and context to proceed:
    - "I'll help you develop your idea from discovery through to delivery. Please describe your idea:"
      1. What problem are you solving?
      2. Who is your target audience?
      3. What's your proposed solution?
      4. What key features do you envision?
      5. Is this being built for a specific company/customer?
      6. How will users interact with this product?
  - Output: docs/plan-prd-YYYYMMDD.md, and docs/adr-N-YYYYMMDD.md for each decision made
  - Action: Create a plan for the PRD including scope, objectives, and structure without tasks
    section. For any architectural or design decisions made during planning (e.g., technology
    choices, platform decisions), create an ADR.
  - Validate: Verify the output md file exists, is well-formed markdown, and contains the expected
    sections. Verify markdown passes `npm run lint:md`. Verify any ADR files exist and contain:
    Title, Date, Status, Context, Decision, Consequences.

- Review Plan PRD
  - Agent: Orchestrator (delegates to independent Product Manager subagent)
  - Input: docs/plan-prd-YYYYMMDD.md
  - Action: Review the PRD plan for completeness, clarity, and feasibility

- Human Gate: PRD Plan Approval
  - Reviewer: Human
  - Input: docs/plan-prd-YYYYMMDD.md and any ADRs created
  - Decision: Approve, request changes, or reject
  - Gate: Must pass before committing plan and generating the PRD
  - CRITICAL: DO NOT commit plan before human approval
  - Instruction: STOP. Do not proceed. Present the following to the human:
    1. Plan summary (what the PRD will cover)
    2. Review status and findings
    3. Proposed commit message (Conventional Commits: concise subject + brief body, 2-3 sentences max)
    4. Ask: "PRD plan is ready. Please review docs/plan-prd-YYYYMMDD.md and the proposed commit
       message. What is your decision?"
    - Options: Approve / Request Changes / Modify Commit Message / Reject
    - If Approve: Commit with the proposed message, proceed to Generate PRD
    - If Request Changes: Ask "What changes are needed?" then revise the plan and present for review again
    - If Modify Commit Message: Ask for the new message, then commit and proceed
    - If Reject: Stop workflow
  - You MUST wait for explicit human approval before committing and continuing

- Generate PRD
  - Agent: Product Manager
  - Input: Approved plan from review
  - Output: docs/prd-YYYYMMDD.md, DIAGRAMS.md (with System Context diagram)
  - Template: templates/prd.template.md
  - Action: Generate the full PRD document without tasks section based on the approved plan using
    the PRD template. Create a C4 System Context diagram (Level 1) in DIAGRAMS.md showing the
    system in scope, external systems, and users.
  - Validate: Verify the output md file exists, is well-formed markdown, and contains all template
    sections (Background, Success Criteria, Scope, Out of Scope, Requirements, Constraints,
    Assumptions, Tasks). Verify markdown passes `npm run lint:md`. Verify DIAGRAMS.md exists with
    a valid System Context diagram.

- Review Generated PRD
  - Agent: Orchestrator (delegates to independent Product Manager subagent)
  - Input: docs/prd-YYYYMMDD.md
  - Action: Review for completeness, clarity, internal consistency, and alignment with the approved plan

- Human Gate: PRD Approval
  - Reviewer: Human
  - Input: docs/prd-YYYYMMDD.md
  - Decision: Approve or request revisions
  - Gate: Must pass before committing PRD and proceeding to Phase 2
  - CRITICAL: DO NOT commit PRD before human approval
  - Instruction: STOP. Do not proceed. Present the following to the human:
    1. PRD summary
    2. Review status and findings
    3. Proposed commit message (Conventional Commits: concise subject + brief body, 2-3 sentences max)
    4. Ask: "Please review docs/prd-YYYYMMDD.md and the proposed commit message. What is your decision?"
    - Options: Approve / Request Changes / Modify Commit Message / Reject
    - If Approve: Commit with the proposed message, proceed to Phase 2
    - If Request Changes: Ask "What changes are needed?" then revise the PRD and present for review again
    - If Modify Commit Message: Ask for the new message, then commit and proceed
    - If Reject: Stop workflow and explain why PRD was insufficient
  - You MUST wait for explicit human approval before committing and continuing

## Phase 2: Task Breakdown

When planning tasks, if any architectural or design decisions are made (e.g., choice of library,
data format, communication pattern, trade-off resolution), document each as an Architecture
Decision Record at docs/adr-N-YYYYMMDD.md. Use sequential numbering (N = 1, 2, 3, ...).

- Plan Tasks
  - Agent: Product Manager
  - Input: Approved docs/prd-YYYYMMDD.md
  - Output: docs/plan-prdtasks-YYYYMMDD.md, and docs/adr-N-YYYYMMDD.md for each decision made
  - Action: Create a plan to break down the PRD into specific, actionable tasks. For any decisions
    made during planning, create an ADR documenting the context, decision, and consequences.
  - Validate: Verify the output md file exists, is well-formed markdown, and contains task summary
    with dependency chain. Verify markdown passes `npm run lint:md`. Verify any ADR files exist
    and contain: Title, Date, Status, Context, Decision, Consequences.

- Review Task Plan
  - Agent: Orchestrator (delegates to independent Software Engineer subagent)
  - Input: docs/plan-prdtasks-YYYYMMDD.md
  - Action: Review the task breakdown for completeness and technical feasibility

- Human Gate: Task Plan Approval
  - Reviewer: Human
  - Input: docs/plan-prdtasks-YYYYMMDD.md and any ADRs created
  - Decision: Approve, request changes, or reject
  - Gate: Must pass before committing plan and generating the tasks section
  - CRITICAL: DO NOT commit plan before human approval
  - Instruction: STOP. Do not proceed. Present the following to the human:
    1. Task plan summary (number of tasks, dependency chain, criticality)
    2. Review status and findings
    3. Proposed commit message (Conventional Commits: concise subject + brief body, 2-3 sentences max)
    4. Ask: "Task plan is ready. Please review docs/plan-prdtasks-YYYYMMDD.md and the proposed
       commit message. What is your decision?"
    - Options: Approve / Request Changes / Modify Commit Message / Reject
    - If Approve: Commit with the proposed message, proceed to Generate Tasks Section
    - If Request Changes: Ask "What changes are needed?" then revise the plan and present for review again
    - If Modify Commit Message: Ask for the new message, then commit and proceed
    - If Reject: Stop workflow
  - You MUST wait for explicit human approval before committing and continuing

- Generate Tasks Section
  - Agent: Product Manager
  - Input: Approved plan from review
  - Output: Update docs/prd-YYYYMMDD.md with tasks section
  - Action: Add the detailed tasks section to the existing PRD. All newly created tasks must
    have their Status column set to `TO_DO`.
  - Validate: Verify the tasks section in the PRD md file is well-formed, contains a properly
    formatted table with all required columns (ID, Title, Criticality, Status, Requirements,
    Dependencies). Verify all tasks have Status set to `TO_DO`. Verify markdown passes
    `npm run lint:md`.

- Review Generated Tasks
  - Agent: Orchestrator (delegates to independent Software Engineer subagent)
  - Input: Updated docs/prd-YYYYMMDD.md with tasks section
  - Action: Review for technical feasibility, completeness, correct dependency ordering, and alignment with PRD requirements

- Human Gate: Task Plan Approval
  - Reviewer: Human
  - Input: Updated docs/prd-YYYYMMDD.md with tasks
  - Decision: Approve or request revisions
  - Gate: Must pass before committing tasks and proceeding to Phase 3
  - CRITICAL: DO NOT commit tasks before human approval
  - Instruction: STOP. Do not proceed. Present the following to the human:
    1. Task breakdown summary
    2. Review status and findings
    3. Proposed commit message (Conventional Commits: concise subject + brief body, 2-3 sentences max)
    4. Ask: "Please review the tasks section in docs/prd-YYYYMMDD.md and the proposed commit message. What is your decision?"
    - Options: Approve / Request Changes / Modify Commit Message / Reject
    - If Approve: Commit with the proposed message, proceed to Phase 3
    - If Request Changes: Ask "What changes are needed?" then revise the tasks and present for review again
    - If Modify Commit Message: Ask for the new message, then commit and proceed
    - If Reject: Stop workflow and explain why tasks were insufficient
  - You MUST wait for explicit human approval before committing and continuing

## Phase 3: Task Execution

Repeat this phase for each task identified in the PRD. Execute tasks ordered by dependencies
first, then by criticality (CRITICAL before HIGH before MEDIUM before LOW). A task must not
start until all tasks listed in its Dependencies column are complete.

- Update Status: IN_PROGRESS
  - Agent: Software Engineer
  - Action: Update the task's Status column in the PRD task table (docs/prd-YYYYMMDD.md) from
    `TO_DO` to `IN_PROGRESS` before beginning any planning or execution work on the task.
    This change will be committed together with the implementation at the Task Approval Human Gate.

- Plan Task
  - Agent: Software Engineer
  - Input: Single task from docs/prd-YYYYMMDD.md
  - Output: docs/plan-task-N-YYYYMMDD.md, and docs/adr-N-YYYYMMDD.md for each decision made
  - Template: .agents/templates/task.template.md (MUST follow exactly)
  - Action: Create implementation plan for the specific task including approach, files to modify,
    and acceptance criteria. For any architectural or design decisions made during planning,
    create an ADR. For tasks involving system architecture or new components, create or update a
    C4 Container diagram (Level 2) in DIAGRAMS.md showing applications, databases, and their
    interactions.
  - Validate: Verify the plan follows task.template.md structure exactly (header, Details,
    Description, Acceptance Criteria with EARS format, Implementation Plan, Test Strategy).
    Verify markdown is well-formed and passes `npm run lint:md`. Verify any ADR files exist and
    contain: Title, Date, Status, Context, Decision, Consequences. Verify DIAGRAMS.md is updated
    if architectural components were added.

- Review Task Plan
  - Agent: Orchestrator (delegates to independent Software Engineer subagent)
  - Input: docs/plan-task-N-YYYYMMDD.md
  - Action: Review for technical soundness and alignment with PRD

- Human Gate: Task Plan Approval
  - Reviewer: Human
  - Input: docs/plan-task-N-YYYYMMDD.md and any ADRs created
  - Decision: Approve, request changes, or reject
  - Gate: Must pass before executing the task
  - Instruction: STOP. Do not proceed. Present the following to the human:
    1. Plan summary (what will be built)
    2. Review status and findings
    3. Ask: "Task N plan is ready. Please review docs/plan-task-N-YYYYMMDD.md. What is your decision?"
    - Options: Approve / Request Changes / Reject
    - If Approve: Proceed to Execute Task (plan will be committed with implementation at Human Gate 6)
    - If Request Changes: Ask "What changes are needed?" then revise the plan and present for review again
    - If Reject: Re-plan the task from scratch
  - You MUST wait for explicit human approval before executing

- Execute Task
  - Agent: Software Engineer
  - Input: Approved plan from review
  - Output: Code changes, new files, or configuration updates
  - Location: src/ for application code, infrastructure/ for deployment config
  - Action: Implement the task according to the approved plan
  - Testing: Run npm test and npm run lint - all tests must pass before submitting for review
  - Deployment: After infrastructure setup task is complete, the subsequent tasks include deploying to Heroku
    and verifying as standard practice (git push heroku main, confirm dyno runs)

- Review Executed Task
  - Agent: Orchestrator (delegates to independent Software Engineer subagent)
  - Input: Code changes and implementation
  - Action: Review for code quality, completeness, and adherence to plan

- Human Gate: Task Approval
  - Reviewer: Human
  - Input: Completed task implementation and reviews
  - Decision: Approve, request changes, or reject
  - Gate: Must pass before committing and considering task complete
  - CRITICAL: DO NOT commit code before human approval
  - Instruction: STOP. Do not proceed. Present the following to the human:
    1. Implementation summary (what was built)
    2. Test results (all must pass)
    3. Code review status and findings
    4. Proposed commit message (Conventional Commits: concise subject + brief body, 2-3 sentences max)
    5. Ask: "Task N implementation is complete. Please review the code changes and proposed
       commit message. What is your decision?"
    - Options: Approve / Request Changes / Modify Commit Message / Reject
    - If Approve: Update status to DONE in the PRD task table, then commit plan + implementation +
      status change together with the proposed message. Proceed to next task.
    - If Request Changes: Ask "What changes are needed?" then revise and present for review again
    - If Modify Commit Message: Ask for the new message, then commit and proceed
    - If Reject: Revert changes, re-plan the task from scratch. Status remains `IN_PROGRESS`.
  - You MUST wait for explicit human approval before committing and continuing to the next task

- Update Status: DONE
  - Agent: Software Engineer
  - Action: After human approval, update the task's Status column in the PRD task table
    (docs/prd-YYYYMMDD.md) from `IN_PROGRESS` to `DONE`. Commit the status change together
    with the approved implementation in a single commit.

## File Naming Conventions

- PRD Plans: docs/plan-prd-YYYYMMDD.md
- PRD Documents: docs/prd-YYYYMMDD.md
- Task Plans for PRD: docs/plan-prdtasks-YYYYMMDD.md
- Individual Task Plans: docs/plan-task-N-YYYYMMDD.md
- Architecture Decision Records: docs/adr-N-YYYYMMDD.md
- Date Format: YYYYMMDD
- Task Number: N is the sequential task number
- ADR Number: N is a sequential number across the project (1, 2, 3, ...)

## Code Organization

- Generated Artifacts: docs/
- Application Code: src/
- Deployment Configuration: infrastructure/
- Agent Documentation: .agents/

## Revision Flow

When a review returns REJECTED or PARTIALLY_APPROVED status:

- REJECTED: Work goes back to the previous step
  - The same agent who created the work addresses the issues OR
  - Orchestrator spawns a new subagent to fix the issues
  - All CRITICAL issues must be fixed before proceeding
  - HIGH/MEDIUM/LOW issues should be addressed based on priority
  - Revised work goes through review again
  - Cycle repeats until APPROVED or all CRITICAL issues resolved

- PARTIALLY_APPROVED: Work can proceed with conditions
  - CRITICAL issues must be fixed immediately (blocks progress)
  - HIGH issues should be fixed before next phase
  - MEDIUM/LOW issues can be tracked and addressed later
  - Document all unresolved issues with criticality for tracking

## Appendices

### Templates

- templates/prd.template.md - PRD structure (includes task table)
- templates/task.template.md - Individual task detail

All reviews output a status (APPROVED/PARTIALLY_APPROVED/REJECTED) with issues tagged by criticality. No template required.

### Review Status Definitions

- APPROVED: No issues or only LOW issues. Ready to proceed.
- PARTIALLY_APPROVED: No CRITICAL issues. Has HIGH/MEDIUM that don't block. Can proceed with conditions.
- REJECTED: Has CRITICAL issues. Must go back to previous step.

### Criticality Levels

- CRITICAL: Blocks progress. Must fix immediately. (e.g., missing requirements, security vulnerability)
- HIGH: Impacts quality. Should fix before proceeding. (e.g., unclear criteria, missing edge cases)
- MEDIUM: Not blocking. Should fix in current phase. (e.g., style issues, documentation gaps)
- LOW: Minor. Can defer. (e.g., naming suggestions, optional refactoring)

### Task Status

- DONE: Task is complete and verified.
- IN_PROGRESS: Task is currently being worked on.
- TO_DO: Task has not been started yet.
