# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cloudflare Worker that monitors RSS feeds and sends new articles to Discord webhooks. It's a scheduled worker that runs on cron triggers (8:00, 12:00, 16:00 JST daily) to check multiple RSS feeds and post updates to different Discord channels.

## Development Commands

- `npm run dev` - Start development server with scheduled trigger testing
- `npm run start` - Alias for dev command
- `npm run deploy` - Deploy to Cloudflare Workers
- `npm run cf-typegen` - Generate TypeScript types from Wrangler configuration

## Code Architecture

### Core Components

**Main Entry Point (`src/index.ts`)**:
- `handleScheduled()` - Main scheduled handler that processes all RSS feeds
- `confirmRss()` - Core function that fetches RSS feed, checks for new items, and sends Discord notifications
- `handleFetch()` - HTTP handler (disabled in production unless `ENABLE_HTTP_REQUEST=true`)

**Key Data Structures**:
- `TargetOption` interface defines RSS feed configuration with title, RSS URL, and Discord webhook
- `targetOptions` array contains hardcoded feed configurations for IT news and Science feeds
- Uses SHA-256 hashes of article URLs as unique identifiers

### External Dependencies

- **htmlparser2**: RSS feed parsing
- **p-retry**: Retry logic with custom error handling for Discord rate limits
- **node:https**: HTTP requests (requires `nodejs_compat` flag)
- **effect**: Effect-TS functional programming library (v3.17.13)
- **@effect/platform**: HTTP client and platform abstractions (v0.90.9)

### Cloudflare Integrations

- **KV Storage**: `RSS_FEED_WORKER_KV` namespace stores processed article hashes (10-day TTL)
- **Environment Variables**: Discord webhook URLs and feature flags
- **Cron Triggers**: Configured for "0 23,3,7 * * *" (8:00, 12:00, 16:00 JST)

## Configuration Files

- **wrangler.jsonc**: Worker configuration with KV bindings, cron schedule, and Node.js compatibility
- **biome.json**: Code formatting and linting (space indentation, double quotes)
- **tsconfig.json**: TypeScript configuration with strict mode and ES2021 target

## Development Testing

Use `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"` to test the scheduled handler during development.

## Environment Setup

Required environment variables (set via `wrangler secret`):
- `DISCORD_WEBHOOK_URL_IT` - Discord webhook for IT/tech news
- `DISCORD_WEBHOOK_URL_SCIENCE` - Discord webhook for science news  
- `ENABLE_HTTP_REQUEST` - Feature flag to enable HTTP endpoint

## Effect-TS Refactoring (In Progress)

The codebase is being refactored to use Effect-TS patterns for improved type safety, error handling, and maintainability.

### Service Layer Architecture
- **HttpService**: HTTP requests with retry and timeout using @effect/platform
- **ConfigService**: Type-safe environment variable access
- **KvStorageService**: Cloudflare KV operations with Effect error handling
- **RssService**: RSS feed processing with structured error types
- **DiscordService**: Discord webhook sending with rate limit handling
- **HealthService**: Worker health status and metrics collection

### Effect-TS Patterns
- Context-based dependency injection using `Context.GenericTag`
- Service composition with `Layer.mergeAll`
- Structured error handling with `Data.TaggedError`
- Effect composition with `Effect.gen` for sequential operations
- Retry logic using `Schedule.exponential` and `Effect.retry`
- Structured logging with `Logger.withSpan` and annotations

### Migration Strategy
- Gradual migration from Promise-based to Effect-based patterns
- `Effect.tryPromise` for bridging existing async APIs
- Comprehensive test coverage with contract, integration, and e2e tests
- Backward compatibility maintained during transition

## Code Style

- Uses Biome for formatting and linting
- TypeScript with strict mode enabled
- Double quotes for strings, space indentation
- All code should pass `@biomejs/biome check`
- Effect-TS functional programming patterns with immutable data structures