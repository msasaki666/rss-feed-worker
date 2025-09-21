/**
 * Test layer configuration for Effect-TS RSS Feed Worker testing
 * 
 * Provides mock service implementations and test layers for different testing scenarios
 */

import { Layer, Effect, Context } from "effect"
import { HttpClientResponse, HttpClientError } from "@effect/platform"
import type {
  HttpService,
  ConfigService,
  KvStorageService,
  RssService,
  DiscordService,
  HealthService,
  ExtractedItem,
  ProcessingMetrics,
  HealthStatus,
  ConfigError,
  KvError,
  RssError,
  DiscordError
} from "../../src/models/ServiceContracts"
import {
  mockExtractedItems,
  mockProcessingMetrics,
  mockHealthyStatus,
  mockSuccessResponse,
  mockRssXml,
  testUrls
} from "../fixtures/TestData"

// ============================================================================
// Mock HTTP Service
// ============================================================================

export const TestHttpService = Layer.succeed(
  Context.GenericTag<HttpService>("HttpService"),
  {
    fetchFeed: (url: string) => {
      if (url === testUrls.validRssUrl) {
        return Effect.succeed({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockRssXml)
        } as any as HttpClientResponse.HttpClientResponse)
      }
      
      if (url === testUrls.notFoundUrl) {
        return Effect.fail({
          _tag: "RequestError",
          status: 404,
          statusText: "Not Found"
        } as any as HttpClientError.HttpClientError)
      }
      
      return Effect.succeed({
        ok: true,
        status: 200, 
        text: () => Promise.resolve(mockRssXml)
      } as any as HttpClientResponse.HttpClientResponse)
    }
  }
)

// ============================================================================
// Mock Config Service
// ============================================================================

export const TestConfigService = Layer.succeed(
  Context.GenericTag<ConfigService>("ConfigService"),
  {
    getDiscordWebhook: (type: 'IT' | 'SCIENCE' | 'NOTEBOOKLM') => {
      const webhooks = {
        IT: "https://discord.com/api/webhooks/123/test-it",
        SCIENCE: "https://discord.com/api/webhooks/456/test-science", 
        NOTEBOOKLM: "https://discord.com/api/webhooks/789/test-notebooklm"
      }
      return Effect.succeed(webhooks[type])
    },
    
    getFeatureFlag: (flag: string) => {
      if (flag === "ENABLE_HTTP_REQUEST") {
        return Effect.succeed(true)
      }
      return Effect.succeed(false)
    }
  }
)

// ============================================================================
// Mock KV Storage Service
// ============================================================================

const mockKvStore = new Map<string, string>()

export const TestKvStorageService = Layer.succeed(
  Context.GenericTag<KvStorageService>("KvStorageService"),
  {
    checkExisting: (hashes: string[]) => {
      const existing = hashes.filter(hash => mockKvStore.has(hash))
      return Effect.succeed(existing)
    },
    
    storeItem: (item: ExtractedItem) => {
      mockKvStore.set(item.linkHash, JSON.stringify({
        title: item.title,
        link: item.link
      }))
      return Effect.void
    },
    
    getMetrics: (key: string) => {
      const stored = mockKvStore.get(`metrics:${key}`)
      if (stored) {
        return Effect.succeed(JSON.parse(stored) as ProcessingMetrics)
      }
      return Effect.succeed(null)
    },
    
    updateMetrics: (key: string, metrics: ProcessingMetrics) => {
      mockKvStore.set(`metrics:${key}`, JSON.stringify(metrics))
      return Effect.void
    }
  }
)

// ============================================================================
// Mock RSS Service
// ============================================================================

export const TestRssService = Layer.succeed(
  Context.GenericTag<RssService>("RssService"),
  {
    processFeed: (url: string, sourceName: string) => {
      if (url === testUrls.invalidRssUrl) {
        return Effect.fail({
          _tag: "RssError",
          service: "RssService",
          operation: "processFeed", 
          cause: "Invalid RSS XML"
        } as RssError)
      }
      
      return Effect.succeed(mockExtractedItems)
    }
  }
)

// ============================================================================
// Mock Discord Service
// ============================================================================

export const TestDiscordService = Layer.succeed(
  Context.GenericTag<DiscordService>("DiscordService"),
  {
    sendWebhook: (webhookUrl: string, content: string) => {
      if (webhookUrl.includes("invalid")) {
        return Effect.fail({
          _tag: "DiscordError",
          service: "DiscordService", 
          operation: "sendWebhook",
          cause: "Invalid webhook URL"
        } as DiscordError)
      }
      
      return Effect.succeed(mockSuccessResponse)
    }
  }
)

// ============================================================================
// Mock Health Service
// ============================================================================

export const TestHealthService = Layer.succeed(
  Context.GenericTag<HealthService>("HealthService"),
  {
    getStatus: () => Effect.succeed(mockHealthyStatus),
    
    recordFeedProcessing: (target: string, success: boolean, error?: string) => {
      // Mock implementation - just log the recording
      console.log(`Recording processing for ${target}: success=${success}, error=${error}`)
      return Effect.void
    }
  }
)

// ============================================================================
// Failing Mock Services for Contract Tests
// ============================================================================

export const FailingHttpService = Layer.succeed(
  Context.GenericTag<HttpService>("HttpService"),
  {
    fetchFeed: () => Effect.fail({
      _tag: "RequestError",
      status: 0,
      statusText: "Mock service not implemented"
    } as any as HttpClientError.HttpClientError)
  }
)

export const FailingConfigService = Layer.succeed(
  Context.GenericTag<ConfigService>("ConfigService"),
  {
    getDiscordWebhook: () => Effect.fail({
      _tag: "ConfigError",
      service: "ConfigService",
      operation: "getDiscordWebhook",
      cause: "Mock service not implemented"
    } as ConfigError),
    
    getFeatureFlag: () => Effect.fail({
      _tag: "ConfigError", 
      service: "ConfigService",
      operation: "getFeatureFlag",
      cause: "Mock service not implemented"
    } as ConfigError)
  }
)

export const FailingKvStorageService = Layer.succeed(
  Context.GenericTag<KvStorageService>("KvStorageService"),
  {
    checkExisting: () => Effect.fail({
      _tag: "KvError",
      service: "KvStorageService",
      operation: "checkExisting", 
      cause: "Mock service not implemented"
    } as KvError),
    
    storeItem: () => Effect.fail({
      _tag: "KvError",
      service: "KvStorageService", 
      operation: "storeItem",
      cause: "Mock service not implemented"
    } as KvError),
    
    getMetrics: () => Effect.fail({
      _tag: "KvError",
      service: "KvStorageService",
      operation: "getMetrics",
      cause: "Mock service not implemented" 
    } as KvError),
    
    updateMetrics: () => Effect.fail({
      _tag: "KvError",
      service: "KvStorageService",
      operation: "updateMetrics",
      cause: "Mock service not implemented"
    } as KvError)
  }
)

export const FailingRssService = Layer.succeed(
  Context.GenericTag<RssService>("RssService"),
  {
    processFeed: () => Effect.fail({
      _tag: "RssError",
      service: "RssService",
      operation: "processFeed",
      cause: "Mock service not implemented"
    } as RssError)
  }
)

export const FailingDiscordService = Layer.succeed(
  Context.GenericTag<DiscordService>("DiscordService"), 
  {
    sendWebhook: () => Effect.fail({
      _tag: "DiscordError",
      service: "DiscordService",
      operation: "sendWebhook",
      cause: "Mock service not implemented"
    } as DiscordError)
  }
)

export const FailingHealthService = Layer.succeed(
  Context.GenericTag<HealthService>("HealthService"),
  {
    getStatus: () => Effect.succeed({
      status: 'unhealthy' as const,
      timestamp: "1970-01-01T00:00:01.000Z",
      version: "0.0.0-NOT-IMPLEMENTED",
      lastProcessing: {},
      errors: [{
        timestamp: "1970-01-01T00:00:01.000Z",
        service: "HealthService",
        error: "Mock service not implemented"
      }]
    }),
    recordFeedProcessing: () => Effect.void // Health service never fails for recordFeedProcessing
  }
)

// ============================================================================
// Combined Test Layers
// ============================================================================

/**
 * Working test layer - all services return successful mock responses
 */
export const TestAppLayer = Layer.mergeAll(
  TestHttpService,
  TestConfigService,
  TestKvStorageService,
  TestRssService,
  TestDiscordService,
  TestHealthService
)

/**
 * Failing test layer - all services fail for contract testing (TDD)
 */
export const FailingAppLayer = Layer.mergeAll(
  FailingHttpService,
  FailingConfigService,
  FailingKvStorageService,
  FailingRssService,
  FailingDiscordService,
  FailingHealthService
)

/**
 * Mixed test layer - some services work, some fail for integration testing
 */
export const MixedTestLayer = Layer.mergeAll(
  TestHttpService,
  TestConfigService,
  FailingKvStorageService, // KV fails
  TestRssService,
  FailingDiscordService, // Discord fails
  TestHealthService
)

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Clear all mock KV storage data between tests
 */
export const clearMockKvStore = () => {
  mockKvStore.clear()
}

/**
 * Seed mock KV storage with test data
 */
export const seedMockKvStore = (data: Record<string, any>) => {
  Object.entries(data).forEach(([key, value]) => {
    mockKvStore.set(key, JSON.stringify(value))
  })
}

/**
 * Get current mock KV storage state for assertions
 */
export const getMockKvStore = () => {
  return new Map(mockKvStore)
}