# Test Scenarios for Effect-TS Refactoring

**Feature**: Effect-TS Service Layer Testing  
**Date**: 2025-09-12  
**Status**: Contract Tests Required

## Test Strategy

### Testing Approach
- **Contract Tests**: Verify service interfaces and behavior contracts
- **Integration Tests**: Test service composition and Effect chains  
- **Unit Tests**: Test individual service implementations
- **End-to-End Tests**: Test complete RSS processing workflow

### Test Execution Order
1. Contract tests (must fail initially)
2. Unit tests for service implementations  
3. Integration tests for service composition
4. End-to-end tests for complete workflows

---

## Contract Test Scenarios

### HttpService Contract Tests

**File**: `tests/contract/HttpService.test.ts`

**Test Cases**:
```typescript
describe("HttpService Contract", () => {
  test("fetchFeed returns HttpClientResponse for valid URL", async () => {
    // Contract: fetchFeed should return Effect<HttpClientResponse, HttpClientError>
    // MUST FAIL: No implementation yet
  })
  
  test("fetchFeed fails with HttpClientError for invalid URL", async () => {
    // Contract: fetchFeed should handle network errors gracefully
    // MUST FAIL: No implementation yet
  })
  
  test("fetchFeed retries on transient failures", async () => {
    // Contract: fetchFeed should implement retry logic
    // MUST FAIL: No implementation yet
  })
})
```

### ConfigService Contract Tests

**File**: `tests/contract/ConfigService.test.ts`

**Test Cases**:
```typescript
describe("ConfigService Contract", () => {
  test("getDiscordWebhook returns webhook URL for valid type", async () => {
    // Contract: getDiscordWebhook should return string for 'IT' | 'SCIENCE' | 'NOTEBOOKLM'
    // MUST FAIL: No implementation yet
  })
  
  test("getDiscordWebhook fails with ConfigError for missing env var", async () => {
    // Contract: getDiscordWebhook should fail when environment variable missing
    // MUST FAIL: No implementation yet  
  })
  
  test("getFeatureFlag returns boolean for flag name", async () => {
    // Contract: getFeatureFlag should parse environment variable as boolean
    // MUST FAIL: No implementation yet
  })
})
```

### KvStorageService Contract Tests

**File**: `tests/contract/KvStorageService.test.ts`

**Test Cases**:
```typescript
describe("KvStorageService Contract", () => {
  test("checkExisting returns array of existing hashes", async () => {
    // Contract: checkExisting should return string[] of found hashes
    // MUST FAIL: No implementation yet
  })
  
  test("storeItem persists ExtractedItem with TTL", async () => {
    // Contract: storeItem should store item data with expiration
    // MUST FAIL: No implementation yet
  })
  
  test("checkExisting handles empty input array", async () => {
    // Contract: checkExisting should return empty array for empty input
    // MUST FAIL: No implementation yet
  })
  
  test("operations fail with KvError on storage issues", async () => {
    // Contract: KV operations should wrap errors in KvError type
    // MUST FAIL: No implementation yet
  })
})
```

### RssService Contract Tests

**File**: `tests/contract/RssService.test.ts`

**Test Cases**:
```typescript
describe("RssService Contract", () => {
  test("processFeed returns ExtractedItem array for valid RSS", async () => {
    // Contract: processFeed should parse RSS and return structured items
    // MUST FAIL: No implementation yet
  })
  
  test("processFeed fails with RssError for invalid XML", async () => {
    // Contract: processFeed should handle parsing errors gracefully
    // MUST FAIL: No implementation yet
  })
  
  test("processFeed generates consistent linkHash for same URL", async () => {
    // Contract: processFeed should create reproducible hash for deduplication
    // MUST FAIL: No implementation yet
  })
  
  test("processFeed handles feed with no items", async () => {
    // Contract: processFeed should return empty array for feed with no items
    // MUST FAIL: No implementation yet
  })
})
```

### DiscordService Contract Tests

**File**: `tests/contract/DiscordService.test.ts`

**Test Cases**:
```typescript
describe("DiscordService Contract", () => {
  test("sendWebhook returns Response for successful send", async () => {
    // Contract: sendWebhook should return Response for successful webhook
    // MUST FAIL: No implementation yet
  })
  
  test("sendWebhook fails with DiscordError for invalid webhook", async () => {
    // Contract: sendWebhook should handle 404 errors appropriately
    // MUST FAIL: No implementation yet
  })
  
  test("sendWebhook retries on rate limit with backoff", async () => {
    // Contract: sendWebhook should handle 429 responses with retry logic
    // MUST FAIL: No implementation yet
  })
  
  test("sendWebhook respects retry-after header", async () => {
    // Contract: sendWebhook should parse Discord's retry-after value
    // MUST FAIL: No implementation yet
  })
})
```

### HealthService Contract Tests

**File**: `tests/contract/HealthService.test.ts`

**Test Cases**:
```typescript
describe("HealthService Contract", () => {
  test("getStatus returns HealthStatus structure", async () => {
    // Contract: getStatus should return complete health status
    // MUST FAIL: No implementation yet
  })
  
  test("recordFeedProcessing updates metrics correctly", async () => {
    // Contract: recordFeedProcessing should track success/failure counts
    // MUST FAIL: No implementation yet
  })
  
  test("getStatus determines health based on recent errors", async () => {
    // Contract: getStatus should calculate healthy/degraded/unhealthy status
    // MUST FAIL: No implementation yet
  })
})
```

---

## Integration Test Scenarios

### Service Composition Tests

**File**: `tests/integration/ServiceComposition.test.ts`

**Test Cases**:
```typescript
describe("Service Composition Integration", () => {
  test("ProcessFeedEffect composes all services correctly", async () => {
    // Integration: Full RSS processing workflow with real services
    // Uses TestContainers or mock KV for isolated testing
  })
  
  test("Error handling propagates correctly through Effect chain", async () => {
    // Integration: Service failures should be handled gracefully
    // Test with controlled service failures
  })
  
  test("Concurrent processing handles multiple feeds", async () => {
    // Integration: Multiple feeds processed simultaneously
    // Verify no race conditions or resource conflicts
  })
})
```

### Layer Dependency Tests

**File**: `tests/integration/LayerDependencies.test.ts`

**Test Cases**:
```typescript
describe("Layer Dependencies Integration", () => {
  test("AppLayer provides all required services", async () => {
    // Integration: Layer composition should satisfy all dependencies
  })
  
  test("Service layers handle initialization errors", async () => {
    // Integration: Layer creation should fail fast for invalid config
  })
  
  test("Mock layers work correctly for testing", async () => {
    // Integration: Test layer substitution works
  })
})
```

---

## End-to-End Test Scenarios

### Complete Workflow Tests

**File**: `tests/e2e/RssProcessing.test.ts`

**Test Cases**:
```typescript
describe("RSS Processing End-to-End", () => {
  test("Scheduled handler processes all feeds successfully", async () => {
    // E2E: Complete scheduled execution with real RSS feeds
    // Verify Discord notifications and KV storage
  })
  
  test("Worker handles feed parsing errors gracefully", async () => {
    // E2E: Invalid RSS feed should not stop other feed processing
  })
  
  test("Worker respects Discord rate limits", async () => {
    // E2E: High volume of notifications should be throttled appropriately
  })
  
  test("Worker maintains health status correctly", async () => {
    // E2E: Health endpoint reflects actual processing status
  })
})
```

### Regression Tests

**File**: `tests/e2e/RegressionTests.test.ts`

**Test Cases**:
```typescript
describe("Refactoring Regression Tests", () => {
  test("All existing RSS feeds continue to be processed", async () => {
    // Regression: Verify no functionality is lost during refactoring
  })
  
  test("Discord notification format remains unchanged", async () => {
    // Regression: Verify notification content format is preserved
  })
  
  test("KV storage schema remains compatible", async () => {
    // Regression: Verify stored item format is unchanged
  })
  
  test("Scheduled execution timing is preserved", async () => {
    // Regression: Verify cron schedule continues to work
  })
})
```

---

## Test Configuration

### Test Environment Setup
```typescript
// tests/setup.ts
import { Layer } from "effect"
import { TestServices } from "./mocks/TestServices"

export const TestAppLayer = Layer.mergeAll(
  TestHttpService,
  TestConfigService,
  TestKvStorageService,
  TestRssService,  
  TestDiscordService,
  TestHealthService
)

export const IntegrationTestLayer = Layer.mergeAll(
  HttpServiceLive,
  TestConfigService,
  TestKvStorageService, // Use real KV for integration tests
  RssServiceLive,
  TestDiscordService, // Mock Discord to avoid spam
  HealthServiceLive
)
```

### Test Data
```typescript
// tests/fixtures/TestData.ts
export const mockRssXml = `<?xml version="1.0" encoding="UTF-8"?>...`
export const mockTargetOptions: TargetOption[] = [...]
export const mockExtractedItems: ExtractedItem[] = [...]
```

---

## Success Criteria

### Contract Tests
- [ ] All contract tests written and failing
- [ ] Test coverage for all service interfaces
- [ ] Error handling scenarios covered
- [ ] Edge cases documented and tested

### Integration Tests  
- [ ] Service composition tests written
- [ ] Layer dependency tests written
- [ ] Real service integration verified
- [ ] Error propagation tested

### End-to-End Tests
- [ ] Complete workflow tests written
- [ ] Regression tests for existing functionality
- [ ] Performance benchmarks established
- [ ] Health check integration verified

**Next Step**: Implement service contracts to make these tests pass following TDD principles.