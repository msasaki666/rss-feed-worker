# Tasks: Refactor RSS Feed Worker with Effect-TS

**Input**: Design documents from `/specs/002-effect-ts-refactoring/`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/

## Execution Flow (main)
```
1. Load plan.md from feature directory
   → Loaded: Effect-TS refactoring, single project, Cloudflare Workers
   → Extract: TypeScript 5.9.2, Effect-TS 3.17.13, @effect/platform 0.90.9
2. Load optional design documents:
   → data-model.md: 6 service interfaces → model tasks
   → contracts/services.ts: Service contracts → contract test tasks
   → research.md: Effect-TS patterns → setup tasks
3. Generate tasks by category:
   → Setup: directory structure, Effect-TS configuration
   → Tests: contract tests, integration tests for each service
   → Core: service implementations, Effect composition
   → Integration: Layer composition, worker handlers
   → Polish: unit tests, performance validation
4. Apply task rules:
   → Different service files = mark [P] for parallel
   → Same service file = sequential (no [P])
   → Contract tests before implementation (TDD)
5. Number tasks sequentially (T001, T002...)
6. Generate dependency graph based on service dependencies
7. Create parallel execution examples for independent services
8. Validate task completeness: All services have tests and implementations
9. Return: SUCCESS (tasks ready for execution)
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

## Path Conventions
- **Single project**: `src/`, `tests/` at repository root
- Paths assume single project structure per plan.md

## Phase 3.1: Setup

- [ ] T001 Create Effect-TS service directory structure in src/services/, src/models/, tests/contract/, tests/integration/
- [ ] T002 Create service contracts file from design at src/models/ServiceContracts.ts
- [ ] T003 [P] Create test fixtures and mock data in tests/fixtures/TestData.ts
- [ ] T004 [P] Create test setup with Effect layer configuration in tests/setup/TestLayers.ts

## Phase 3.2: Tests First (TDD) ⚠️ MUST COMPLETE BEFORE 3.3
**CRITICAL: These tests MUST be written and MUST FAIL before ANY implementation**

### Contract Tests (All Independent - Can Run in Parallel)
- [ ] T005 [P] Contract test HttpService.fetchFeed in tests/contract/HttpService.test.ts
- [ ] T006 [P] Contract test ConfigService.getDiscordWebhook and getFeatureFlag in tests/contract/ConfigService.test.ts  
- [ ] T007 [P] Contract test KvStorageService.checkExisting and storeItem in tests/contract/KvStorageService.test.ts
- [ ] T008 [P] Contract test RssService.processFeed in tests/contract/RssService.test.ts
- [ ] T009 [P] Contract test DiscordService.sendWebhook in tests/contract/DiscordService.test.ts
- [ ] T010 [P] Contract test HealthService.getStatus and recordFeedProcessing in tests/contract/HealthService.test.ts

### Integration Tests (Service Composition)
- [ ] T011 [P] Integration test service layer composition in tests/integration/ServiceComposition.test.ts
- [ ] T012 [P] Integration test ProcessFeedEffect workflow in tests/integration/ProcessFeedEffect.test.ts
- [ ] T013 [P] Integration test Layer dependencies and initialization in tests/integration/LayerDependencies.test.ts

### End-to-End Tests
- [ ] T014 [P] E2E test complete RSS processing workflow in tests/e2e/RssProcessing.test.ts
- [ ] T015 [P] E2E test refactoring regression scenarios in tests/e2e/RegressionTests.test.ts

## Phase 3.3: Core Implementation (ONLY after tests are failing)

### Service Models and Error Types
- [ ] T016 [P] Implement service error types (ServiceError, HttpError, etc.) in src/models/Errors.ts
- [ ] T017 [P] Implement data models (ExtractedItem, TargetOption, etc.) in src/models/Types.ts

### Leaf Services (No Dependencies - Can Run in Parallel)
- [ ] T018 [P] Implement ConfigService with environment variable access in src/services/ConfigService.ts
- [ ] T019 [P] Implement HttpService with @effect/platform HttpClient in src/services/HttpService.ts
- [ ] T020 [P] Implement KvStorageService with Cloudflare KV operations in src/services/KvStorageService.ts  
- [ ] T021 [P] Implement DiscordService with webhook sending and rate limiting in src/services/DiscordService.ts

### Dependent Services (Sequential - Dependencies Required)
- [ ] T022 Implement RssService with feed processing (depends on HttpService) in src/services/RssService.ts
- [ ] T023 Implement HealthService with status monitoring (depends on KvStorageService) in src/services/HealthService.ts

### Service Layer Composition
- [ ] T024 Create service layer implementations with Effect Layer in src/services/ServiceLayers.ts
- [ ] T025 Create combined AppLayer for dependency injection in src/services/AppLayer.ts

### Effect Composition
- [ ] T026 Implement ProcessFeedEffect with service orchestration in src/effects/ProcessFeedEffect.ts
- [ ] T027 Implement structured logging with Effect Logger in src/lib/Logger.ts

## Phase 3.4: Integration

### Worker Handler Updates
- [ ] T028 Update main handleScheduled to use Effect.runPromise in src/index.ts
- [ ] T029 [P] Create health check endpoint handler in src/handlers/HealthHandler.ts
- [ ] T030 Update worker exports with new Effect-based handlers in src/index.ts

### Migration Support
- [ ] T031 Create Effect-Promise bridge utilities for gradual migration in src/lib/EffectUtils.ts
- [ ] T032 Update target options configuration with Effect patterns in src/config/TargetOptions.ts

## Phase 3.5: Polish

### Unit Tests for Service Logic
- [ ] T033 [P] Unit tests for RSS parsing logic in tests/unit/RssParser.test.ts
- [ ] T034 [P] Unit tests for Discord rate limit handling in tests/unit/DiscordRateLimit.test.ts
- [ ] T035 [P] Unit tests for configuration validation in tests/unit/ConfigValidation.test.ts

### Performance and Validation
- [ ] T036 Performance regression tests to ensure <200ms processing in tests/performance/ProcessingSpeed.test.ts
- [ ] T037 [P] Update package.json with correct version increment per plan.md
- [ ] T038 Execute quickstart.md validation scenarios to verify functionality

### Documentation Updates  
- [ ] T039 [P] Update CLAUDE.md with final Effect-TS implementation patterns
- [ ] T040 Clean up any remaining Promise-based code patterns and console.log statements

## Dependencies

**Critical TDD Dependencies:**
- All Tests (T005-T015) MUST complete and FAIL before any implementation (T016-T040)

**Service Implementation Dependencies:**  
- T016, T017 (models) must complete before service implementations (T018-T023)
- T018, T019, T020, T021 (leaf services) before T022, T023 (dependent services)
- T022, T023 before T024, T025 (layer composition)
- T024, T025 before T026, T027 (effect composition)
- T026, T027 before T028-T032 (worker integration)

**Polish Dependencies:**
- All core implementation (T016-T032) before polish tasks (T033-T040)

## Parallel Execution Examples

### Phase 3.2 - Contract Tests (All Parallel):
```bash
# Launch contract tests together - all independent:
Task: "Contract test HttpService.fetchFeed in tests/contract/HttpService.test.ts"
Task: "Contract test ConfigService in tests/contract/ConfigService.test.ts"  
Task: "Contract test KvStorageService in tests/contract/KvStorageService.test.ts"
Task: "Contract test RssService.processFeed in tests/contract/RssService.test.ts"
Task: "Contract test DiscordService.sendWebhook in tests/contract/DiscordService.test.ts"
Task: "Contract test HealthService in tests/contract/HealthService.test.ts"
```

### Phase 3.3 - Leaf Service Implementation:
```bash  
# Launch leaf services together - no dependencies:
Task: "Implement ConfigService with environment variable access in src/services/ConfigService.ts"
Task: "Implement HttpService with @effect/platform HttpClient in src/services/HttpService.ts"
Task: "Implement KvStorageService with Cloudflare KV operations in src/services/KvStorageService.ts"
Task: "Implement DiscordService with webhook sending in src/services/DiscordService.ts"
```

### Phase 3.5 - Unit Tests (Parallel):
```bash
# Launch unit tests together - independent test files:
Task: "Unit tests for RSS parsing logic in tests/unit/RssParser.test.ts"
Task: "Unit tests for Discord rate limit handling in tests/unit/DiscordRateLimit.test.ts"  
Task: "Unit tests for configuration validation in tests/unit/ConfigValidation.test.ts"
```

## Notes
- [P] tasks = different files, no shared dependencies
- Verify all contract tests fail before implementing services (TDD requirement)
- Commit after each task completion
- Service dependencies: Config/Http/Kv/Discord → Rss/Health → Layers → Effects → Worker

## Validation Checklist
*GATE: All items must be checked before task execution*

- [x] All service contracts have corresponding contract tests (T005-T010)
- [x] All service entities have implementation tasks (T018-T023)
- [x] All tests come before implementation (T005-T015 before T016+)
- [x] Parallel tasks are truly independent (different files, no shared dependencies)
- [x] Each task specifies exact file path
- [x] No [P] task modifies same file as another [P] task
- [x] TDD order strictly enforced (contract tests must fail first)
- [x] Service dependency graph correctly represented in task order

## Success Criteria

When all tasks complete:
- ✅ All RSS feed processing functionality preserved using Effect-TS patterns
- ✅ Service layer with dependency injection implemented
- ✅ Structured error handling with tagged error types  
- ✅ Effect composition replaces Promise chains
- ✅ Comprehensive test coverage (contract, integration, unit, e2e)
- ✅ Cloudflare Workers compatibility maintained
- ✅ Performance characteristics within acceptable range