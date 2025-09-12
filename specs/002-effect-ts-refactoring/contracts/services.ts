/**
 * Service Contracts for Effect-TS RSS Feed Worker Refactoring
 * 
 * These TypeScript interfaces define the contracts for all services
 * that will be implemented during the refactoring process.
 */

import { Context, Effect, Data } from "effect"
import { HttpClientResponse, HttpClientError } from "@effect/platform"

// ============================================================================
// Error Types
// ============================================================================

export abstract class ServiceError extends Data.TaggedError("ServiceError")<{
  readonly service: string
  readonly operation: string
  readonly cause?: unknown
}> {}

export class HttpError extends Data.TaggedError("HttpError")<{
  readonly service: string
  readonly operation: string
  readonly cause?: unknown
}> {}

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly service: string
  readonly operation: string
  readonly cause?: unknown
}> {}

export class KvError extends Data.TaggedError("KvError")<{
  readonly service: string
  readonly operation: string
  readonly cause?: unknown
}> {}

export class RssError extends Data.TaggedError("RssError")<{
  readonly service: string
  readonly operation: string
  readonly cause?: unknown
}> {}

export class DiscordError extends Data.TaggedError("DiscordError")<{
  readonly service: string
  readonly operation: string
  readonly cause?: unknown
}> {}

export class DiscordRateLimitError extends Data.TaggedError("DiscordRateLimitError")<{
  readonly retryAfter: number
  readonly global: boolean
  readonly code?: number
  readonly cause?: unknown
}> {}

// ============================================================================
// Data Models
// ============================================================================

export interface ExtractedItem {
  readonly id: string | undefined
  readonly title: string
  readonly link: string
  readonly linkHash: string
}

export interface TargetOption {
  readonly postTitle: string
  readonly rssUrl: string
  readonly discordWebhookUrl: string
}

export interface ProcessingMetrics {
  readonly lastRun: string | null
  readonly successCount: number
  readonly errorCount: number
  readonly lastError: string | null
}

export interface HealthStatus {
  readonly status: 'healthy' | 'degraded' | 'unhealthy'
  readonly timestamp: string
  readonly version: string
  readonly lastProcessing: Record<string, ProcessingMetrics>
  readonly errors: Array<{
    readonly timestamp: string
    readonly service: string
    readonly error: string
  }>
}

// ============================================================================
// Service Interfaces
// ============================================================================

export interface HttpService {
  readonly fetchFeed: (url: string) => Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>
}

export const HttpService = Context.GenericTag<HttpService>("HttpService")

export interface ConfigService {
  readonly getDiscordWebhook: (type: 'IT' | 'SCIENCE' | 'NOTEBOOKLM') => Effect.Effect<string, ConfigError>
  readonly getFeatureFlag: (flag: string) => Effect.Effect<boolean, ConfigError>
}

export const ConfigService = Context.GenericTag<ConfigService>("ConfigService")

export interface KvStorageService {
  readonly checkExisting: (hashes: string[]) => Effect.Effect<string[], KvError>
  readonly storeItem: (item: ExtractedItem) => Effect.Effect<void, KvError>
  readonly getMetrics: (key: string) => Effect.Effect<ProcessingMetrics | null, KvError>
  readonly updateMetrics: (key: string, metrics: ProcessingMetrics) => Effect.Effect<void, KvError>
}

export const KvStorageService = Context.GenericTag<KvStorageService>("KvStorageService")

export interface RssService {
  readonly processFeed: (url: string, sourceName: string) => Effect.Effect<ExtractedItem[], RssError>
}

export const RssService = Context.GenericTag<RssService>("RssService")

export interface DiscordService {
  readonly sendWebhook: (webhookUrl: string, content: string) => Effect.Effect<Response, DiscordError | DiscordRateLimitError>
}

export const DiscordService = Context.GenericTag<DiscordService>("DiscordService")

export interface HealthService {
  readonly getStatus: () => Effect.Effect<HealthStatus, never>
  readonly recordFeedProcessing: (target: string, success: boolean, error?: string) => Effect.Effect<void, never>
}

export const HealthService = Context.GenericTag<HealthService>("HealthService")

// ============================================================================
// Main Application Effects
// ============================================================================

/**
 * Main processing effect that orchestrates all services to process a single RSS feed
 */
export type ProcessFeedEffect = (target: TargetOption) => Effect.Effect<void, RssError | DiscordError | KvError>

/**
 * Scheduled handler effect that processes all configured RSS feeds
 */
export type HandleScheduledEffect = Effect.Effect<void, ConfigError | RssError | DiscordError | KvError>

/**
 * Health check effect that returns worker status
 */
export type HealthCheckEffect = Effect.Effect<HealthStatus, never>

// ============================================================================
// Service Dependencies
// ============================================================================

/**
 * All services combined for dependency injection
 */
export type AppServices = 
  | HttpService
  | ConfigService  
  | KvStorageService
  | RssService
  | DiscordService
  | HealthService

/**
 * Cloudflare Worker Environment
 */
export interface Env {
  readonly RSS_FEED_WORKER_KV: KVNamespace
  readonly DISCORD_WEBHOOK_URL_IT: string
  readonly DISCORD_WEBHOOK_URL_SCIENCE: string
  readonly DISCORD_WEBHOOK_URL_NOTEBOOKLM?: string
  readonly ENABLE_HTTP_REQUEST?: string
}