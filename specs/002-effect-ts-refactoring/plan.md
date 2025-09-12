# Implementation Plan: Refactor RSS Feed Worker with Effect-TS

**Branch**: `002-effect-ts-refactoring` | **Date**: 2025-09-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-effect-ts-refactoring/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → Loaded: Refactor RSS feed worker codebase using Effect-TS patterns
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detected Project Type: single (Cloudflare Worker)
   → Set Structure Decision based on project type
3. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
4. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
5. Execute Phase 1 → contracts, data-model.md, quickstart.md, CLAUDE.md
6. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
7. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
8. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
Refactor RSS feed worker from Promise-based patterns to Effect-TS for improved type safety, error handling, and maintainability. Implement service abstraction layer while preserving all existing functionality and Cloudflare Workers compatibility.

## Technical Context
**Language/Version**: TypeScript 5.9.2 (Cloudflare Workers runtime)  
**Primary Dependencies**: @effect/platform 0.90.9, effect 3.17.13, htmlparser2, p-retry  
**Storage**: Cloudflare KV (RSS_FEED_WORKER_KV namespace)  
**Testing**: vitest 3.2.4  
**Target Platform**: Cloudflare Workers Edge Runtime
**Project Type**: single (serverless worker refactoring)  
**Performance Goals**: Maintain <200ms RSS processing, <100ms health checks  
**Constraints**: No breaking changes to external behavior, preserve scheduled execution  
**Scale/Scope**: Single worker instance, 3 RSS feeds, Discord webhook integration

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Simplicity**:
- Projects: 1 (rss-feed-worker refactoring only)
- Using framework directly? (Effect-TS patterns, no wrapper abstractions)
- Single data model? (service interfaces with clear separation)
- Avoiding patterns? (direct Effect composition, no unnecessary Repository patterns)

**Architecture**:
- EVERY feature as library? (services as reusable modules)
- Libraries listed: http-service (HTTP requests), rss-service (feed processing), discord-service (webhooks), kv-service (storage), config-service (environment), health-service (monitoring)
- CLI per library: N/A (Cloudflare Worker environment)
- Library docs: CLAUDE.md update planned

**Testing (NON-NEGOTIABLE)**:
- RED-GREEN-Refactor cycle enforced? (refactoring with tests first)
- Git commits show tests before implementation? (will enforce)
- Order: Contract→Integration→E2E→Unit strictly followed? (yes)
- Real dependencies used? (actual KV store, HTTP endpoints for testing)
- Integration tests for: service contracts, Effect composition, worker functionality
- FORBIDDEN: Implementation before test, skipping RED phase

**Observability**:
- Structured logging included? (Effect Logger implementation)
- Frontend logs → backend? (N/A - worker only)
- Error context sufficient? (Effect error types with context)

**Versioning**:
- Version number assigned? (will increment BUILD in package.json)
- BUILD increments on every change? (yes)
- Breaking changes handled? (internal refactoring, no external API changes)

## Project Structure

### Documentation (this feature)
```
specs/002-effect-ts-refactoring/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)
```
# Option 1: Single project (DEFAULT)
src/
├── models/              # Effect-TS service interfaces and types
├── services/            # Service implementations (http, rss, discord, kv, config, health)
├── cli/                # N/A for Cloudflare Worker
└── lib/                # Utility functions and Effect helpers

tests/
├── contract/           # Service contract tests
├── integration/        # Worker integration tests  
└── unit/              # Service unit tests
```

**Structure Decision**: Option 1 (Single project) - Cloudflare Worker with Effect-TS service refactoring

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - Effect-TS HTTP client patterns for Cloudflare Workers
   - Effect-TS service composition patterns
   - Migration strategy from Promise to Effect
   - Effect-TS error handling patterns for Discord rate limits
   - Effect-TS logging integration

2. **Generate and dispatch research agents**:
   ```
   Task: "Research @effect/platform HttpClient compatibility with Cloudflare Workers"
   Task: "Find best practices for Effect-TS service layer patterns"
   Task: "Research Effect-TS error handling for external API failures"
   Task: "Find Effect-TS migration strategies from Promise-based code"
   Task: "Research Effect Logger integration patterns"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: research.md with all technical decisions resolved

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - HttpService interface (request/response types, retry patterns)
   - RssService interface (feed processing, item extraction)
   - DiscordService interface (webhook sending, rate limit handling)
   - KvStorageService interface (get/put operations)
   - ConfigService interface (environment access)
   - HealthService interface (status reporting)

2. **Generate API contracts** from functional requirements:
   - Service method signatures and Effect types
   - Error types for each service
   - Configuration schemas
   - Output TypeScript interfaces to `/contracts/`

3. **Generate contract tests** from contracts:
   - One test file per service interface
   - Assert Effect composition behavior
   - Tests must fail (no implementation yet)

4. **Extract test scenarios** from user stories:
   - RSS processing → integration test scenario
   - Error handling → test scenarios for each service
   - Quickstart test = refactored worker functionality validation

5. **Update agent file incrementally** (O(1) operation):
   - Update CLAUDE.md with Effect-TS refactoring context
   - Add service layer patterns and composition examples
   - Preserve manual additions between markers
   - Keep under 150 lines for token efficiency

**Output**: data-model.md, /contracts/*, failing tests, quickstart.md, CLAUDE.md

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Each service interface → contract test task [P]
- Each service implementation → implementation task [P]
- Effect composition → integration test task
- Migration tasks to preserve functionality

**Ordering Strategy**:
- TDD order: Contract tests → Service implementations → Integration tests
- Dependency order: Config service → HTTP service → RSS/Discord services → Main worker
- Mark [P] for parallel execution (independent services)

**Estimated Output**: 20-25 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*No constitutional violations - maintaining simplicity with direct Effect-TS patterns*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | - | - |

## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [x] Complexity deviations documented

---
*Based on Constitution v2.1.1 - See `/memory/constitution.md`*