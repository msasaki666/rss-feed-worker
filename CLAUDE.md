# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cloudflare Worker that monitors RSS feeds and sends new articles to Discord webhooks. It's a scheduled worker that runs on cron triggers (8:00, 12:00, 16:00 JST daily) to check multiple RSS feeds and post updates to different Discord channels.

## Development Commands

- `npm run dev` - Start development server with scheduled trigger testing
- `npm run start` - Alias for dev command
- `npm run deploy` - Manual Wrangler deploy. Production deploys automatically via Cloudflare Workers Builds when `main` is pushed or merged (see README).
- `npm run cf-typegen` - Generate TypeScript types from Wrangler configuration

## Code Architecture

### Core Components

**Main Entry Point (`src/index.ts`)**:

- `handleScheduled()` - Main scheduled handler that processes all RSS feeds
- `processFeed()` - Fetches one RSS feed, checks for new items, and sends Discord notifications
- `handleFetch()` - HTTP handler for paths other than `/mcp` (the hint response is off unless `ENABLE_HTTP_REQUEST=true`)
- `handleMcpRequest()` - Streamable HTTP MCP server at `/mcp`. Requires an Access JWT unless `MCP_ALLOW_UNAUTHENTICATED=true` and the Access settings are unset

**Key Data Structures**:

- `TargetOption` interface defines RSS feed configuration with title, RSS URL, and Discord webhook
- Feed definitions live in KV key `feed:v1:catalog`. Webhook URLs live in `feed:v1:webhooks` or the existing IT/SCIENCE secrets.
- Uses SHA-256 hashes of article URLs as unique identifiers

### External Dependencies

- **htmlparser2**: RSS feed parsing
- **p-retry**: Retry logic with custom error handling for Discord rate limits
- **node:https**: HTTP requests (requires `nodejs_compat` flag)

### Cloudflare Integrations

- **KV Storage**: `RSS_FEED_WORKER_KV` namespace stores processed article hashes (10-day TTL)
- **Environment Variables**: Discord webhook URLs, feature flags, and optional Access JWT settings (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`)
- **Cron Triggers**: See `wrangler.jsonc` (`0 23 * * *`, 8:00 JST)
- **nodejs_compat**: Required by the Agents SDK MCP handler (`node:async_hooks`)

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

## Code Style

- Uses Biome for formatting and linting
- TypeScript with strict mode enabled
- Double quotes for strings, space indentation
- All code should pass `@biomejs/biome check`
