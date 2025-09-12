# Data Model: Effect-TS Service Layer for RSS Feed Worker

**Feature**: Effect-TS Refactoring  
**Date**: 2025-09-12  
**Status**: Design Complete

## Service Interfaces

### HttpService
Handles HTTP requests with retry logic and error handling.

**Interface**:
```typescript
interface HttpService {
  readonly fetchFeed: (url: string) => Effect<HttpClientResponse, HttpClientError>
}
```

**Error Types**:
- `HttpClientError` - Network failures, timeouts, HTTP errors
- Custom retry policies for 5xx errors and timeouts

**Dependencies**: None (leaf service)

---

### ConfigService  
Manages environment variable access with type safety.

**Interface**:
```typescript
interface ConfigService {
  readonly getDiscordWebhook: (type: 'IT' | 'SCIENCE' | 'NOTEBOOKLM') => Effect<string, ConfigError>
  readonly getFeatureFlag: (flag: string) => Effect<boolean, ConfigError>
}
```

**Error Types**:
- `ConfigError` - Missing required environment variables

**Dependencies**: None (leaf service)

---

### KvStorageService
Abstracts Cloudflare KV operations with Effect patterns.

**Interface**:
```typescript
interface KvStorageService {
  readonly checkExisting: (hashes: string[]) => Effect<string[], KvError>
  readonly storeItem: (item: ExtractedItem) => Effect<void, KvError>  
}

interface ExtractedItem {
  readonly id: string | undefined
  readonly title: string
  readonly link: string
  readonly linkHash: string
}
```

**Error Types**:
- `KvError` - Storage failures, quota exceeded, network issues

**Dependencies**: None (leaf service, injected KVNamespace)

---

### RssService
Handles RSS feed fetching, parsing, and item extraction.

**Interface**:
```typescript
interface RssService {
  readonly processFeed: (url: string, sourceName: string) => Effect<ExtractedItem[], RssError>
}
```

**Error Types**:  
- `RssError` - Feed parsing failures, invalid XML, network issues

**Dependencies**: HttpService

**State Transitions**:
1. Fetch feed via HttpService
2. Parse RSS/XML content  
3. Extract and normalize items
4. Generate link hashes
5. Return extracted items

---

### DiscordService
Manages Discord webhook sending with rate limit handling.

**Interface**:
```typescript
interface DiscordService {
  readonly sendWebhook: (webhookUrl: string, content: string) => Effect<Response, DiscordError>
}
```

**Error Types**:
- `DiscordError` - General webhook failures  
- `DiscordRateLimitError` - Rate limit exceeded (retriable)

**Dependencies**: None (uses fetch directly)

**Rate Limit Handling**:
- Automatic retry with exponential backoff
- Respects Discord's retry-after headers
- Maximum 3 retry attempts

---

### HealthService  
Provides worker health status and metrics collection.

**Interface**:
```typescript
interface HealthService {
  readonly getStatus: () => Effect<HealthStatus, never>
  readonly recordFeedProcessing: (target: string, success: boolean) => Effect<void, never>
}

interface HealthStatus {
  readonly status: 'healthy' | 'degraded' | 'unhealthy'
  readonly timestamp: string
  readonly version: string
  readonly lastProcessing: Record<string, ProcessingMetrics>
  readonly errors: ErrorSummary[]
}

interface ProcessingMetrics {
  readonly lastRun: string | null
  readonly successCount: number
  readonly errorCount: number  
  readonly lastError: string | null
}
```

**Dependencies**: KvStorageService (for metrics persistence)

---

## Main Application Effects

### ProcessFeedEffect
Main business logic composition that orchestrates all services.

**Signature**:
```typescript
const processFeedEffect: (target: TargetOption) => Effect<void, ProcessingError>
```

**Composition Flow**:
1. Load configuration via ConfigService
2. Process RSS feed via RssService  
3. Check existing items via KvStorageService
4. Filter new items
5. Send Discord notifications via DiscordService
6. Store new items via KvStorageService
7. Update health metrics via HealthService

**Error Handling**:
- Individual service errors are logged but don't stop processing other feeds
- Critical errors (config missing) fail fast
- Transient errors (network) are retried with backoff

---

## Configuration Types

### TargetOption
Configuration for RSS feed targets (unchanged from current implementation).

```typescript
interface TargetOption {
  readonly postTitle: string
  readonly rssUrl: string  
  readonly discordWebhookUrl: string
}
```

### Environment
Cloudflare Worker environment interface.

```typescript
interface Env {
  readonly RSS_FEED_WORKER_KV: KVNamespace
  readonly DISCORD_WEBHOOK_URL_IT: string
  readonly DISCORD_WEBHOOK_URL_SCIENCE: string
  readonly DISCORD_WEBHOOK_URL_NOTEBOOKLM?: string
  readonly ENABLE_HTTP_REQUEST?: string
}
```

---

## Error Hierarchy

All service errors extend from tagged error base:

```typescript
// Base error types
abstract class ServiceError extends Data.TaggedError<{
  readonly service: string
  readonly operation: string
  readonly cause?: unknown
}> {}

// Specific error implementations  
class HttpError extends ServiceError
class ConfigError extends ServiceError
class KvError extends ServiceError
class RssError extends ServiceError
class DiscordError extends ServiceError

// Special case for retriable errors
class DiscordRateLimitError extends DiscordError<{
  readonly retryAfter: number
  readonly global: boolean
}>
```

---

## Service Layer Composition

Services are composed using Effect-TS Layer system:

```typescript
// Individual service layers
export const ConfigServiceLive: Layer<ConfigService, never, never>
export const HttpServiceLive: Layer<HttpService, never, never>  
export const KvServiceLive: (kv: KVNamespace) => Layer<KvStorageService, never, never>
export const RssServiceLive: Layer<RssService, never, HttpService>
export const DiscordServiceLive: Layer<DiscordService, never, never>
export const HealthServiceLive: Layer<HealthService, never, KvStorageService>

// Combined application layer
export const AppLayer: Layer<AppServices, never, never>

type AppServices = 
  | ConfigService
  | HttpService
  | KvStorageService  
  | RssService
  | DiscordService
  | HealthService
```

This data model provides:
- **Type safety** through Effect and service interfaces
- **Clear separation** of concerns between services
- **Testability** through dependency injection
- **Error handling** with structured error types
- **Composability** through Effect and Layer patterns