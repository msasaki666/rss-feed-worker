/**
 * Test fixtures and mock data for Effect-TS RSS Feed Worker testing
 */

import type { ExtractedItem, TargetOption, ProcessingMetrics, HealthStatus } from "../../src/models/ServiceContracts"

// ============================================================================
// Mock RSS XML Data
// ============================================================================

export const mockRssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test RSS Feed</title>
    <link>https://example.com</link>
    <description>Test RSS feed for Effect-TS refactoring</description>
    <item>
      <title>Test Article 1</title>
      <link>https://example.com/article-1</link>
      <description>First test article description</description>
      <pubDate>Thu, 12 Sep 2025 10:00:00 GMT</pubDate>
      <guid>https://example.com/article-1</guid>
    </item>
    <item>
      <title>Test Article 2</title>
      <link>https://example.com/article-2</link>
      <description>Second test article description</description>
      <pubDate>Thu, 12 Sep 2025 11:00:00 GMT</pubDate>
      <guid>https://example.com/article-2</guid>
    </item>
  </channel>
</rss>`

export const mockEmptyRssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Empty RSS Feed</title>
    <link>https://example.com</link>
    <description>Empty RSS feed for testing</description>
  </channel>
</rss>`

export const mockInvalidXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Invalid RSS Feed</title>
    <!-- Missing closing tags to make it invalid -->
  </channel>`

// ============================================================================
// Mock Target Options
// ============================================================================

export const mockTargetOptions: TargetOption[] = [
  {
    postTitle: "Test IT Feed",
    rssUrl: "https://example.com/it-feed.xml",
    discordWebhookUrl: "https://discord.com/api/webhooks/123/test-it"
  },
  {
    postTitle: "Test Science Feed", 
    rssUrl: "https://example.com/science-feed.xml",
    discordWebhookUrl: "https://discord.com/api/webhooks/456/test-science"
  }
]

export const mockSingleTargetOption: TargetOption = {
  postTitle: "Single Test Feed",
  rssUrl: "https://example.com/single-feed.xml", 
  discordWebhookUrl: "https://discord.com/api/webhooks/789/test-single"
}

// ============================================================================
// Mock Extracted Items
// ============================================================================

export const mockExtractedItems: ExtractedItem[] = [
  {
    id: "article-1",
    title: "Test Article 1",
    link: "https://example.com/article-1",
    linkHash: "d4735e3a265e16eee03f59718b9b5d03019c07d8b6c51f90da3a666eec13ab35" // SHA-256 hash
  },
  {
    id: "article-2",
    title: "Test Article 2", 
    link: "https://example.com/article-2",
    linkHash: "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b" // SHA-256 hash
  }
]

export const mockSingleExtractedItem: ExtractedItem = {
  id: "single-article",
  title: "Single Test Article",
  link: "https://example.com/single-article", 
  linkHash: "4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce"
}

// ============================================================================
// Mock Processing Metrics
// ============================================================================

export const mockProcessingMetrics: ProcessingMetrics = {
  lastRun: "2025-09-12T10:30:00.000Z",
  successCount: 5,
  errorCount: 1,
  lastError: null
}

export const mockProcessingMetricsWithError: ProcessingMetrics = {
  lastRun: "2025-09-12T10:25:00.000Z", 
  successCount: 3,
  errorCount: 2,
  lastError: "Failed to fetch RSS feed: Network timeout"
}

// ============================================================================
// Mock Health Status
// ============================================================================

export const mockHealthyStatus: HealthStatus = {
  status: 'healthy',
  timestamp: "2025-09-12T10:30:00.000Z",
  version: "0.0.0",
  lastProcessing: {
    "Test IT Feed": {
      lastRun: "2025-09-12T10:29:45.123Z",
      successCount: 10,
      errorCount: 0,
      lastError: null
    },
    "Test Science Feed": {
      lastRun: "2025-09-12T10:29:46.456Z",
      successCount: 8,
      errorCount: 1, 
      lastError: "Minor parsing issue"
    }
  },
  errors: []
}

export const mockUnhealthyStatus: HealthStatus = {
  status: 'unhealthy',
  timestamp: "2025-09-12T10:30:00.000Z",
  version: "0.0.0",
  lastProcessing: {
    "Test IT Feed": {
      lastRun: "2025-09-12T10:15:00.000Z",
      successCount: 5,
      errorCount: 5,
      lastError: "Repeated network failures"
    }
  },
  errors: [
    {
      timestamp: "2025-09-12T10:29:00.000Z",
      service: "RssService",
      error: "Failed to parse RSS feed"
    },
    {
      timestamp: "2025-09-12T10:28:30.000Z",
      service: "DiscordService", 
      error: "Rate limit exceeded"
    }
  ]
}

// ============================================================================
// Mock HTTP Responses
// ============================================================================

export const mockSuccessResponse = new Response("OK", {
  status: 200,
  statusText: "OK",
  headers: { "Content-Type": "text/plain" }
})

export const mockNotFoundResponse = new Response("Not Found", {
  status: 404,
  statusText: "Not Found"
})

export const mockRateLimitResponse = new Response(
  JSON.stringify({
    message: "You are being rate limited.",
    retry_after: 1.5,
    global: false,
    code: 20028
  }),
  {
    status: 429,
    statusText: "Too Many Requests", 
    headers: { "Content-Type": "application/json" }
  }
)

// ============================================================================
// Mock Environment
// ============================================================================

export const mockEnv = {
  RSS_FEED_WORKER_KV: {
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined
  } as unknown as KVNamespace,
  DISCORD_WEBHOOK_URL_IT: "https://discord.com/api/webhooks/123/test-it",
  DISCORD_WEBHOOK_URL_SCIENCE: "https://discord.com/api/webhooks/456/test-science",
  DISCORD_WEBHOOK_URL_NOTEBOOKLM: "https://discord.com/api/webhooks/789/test-notebooklm",
  ENABLE_HTTP_REQUEST: "true"
}

// ============================================================================
// Test URLs and Configuration
// ============================================================================

export const testUrls = {
  validRssUrl: "https://example.com/valid-rss.xml",
  invalidRssUrl: "https://example.com/invalid-rss.xml",
  notFoundUrl: "https://example.com/not-found.xml",
  timeoutUrl: "https://httpstat.us/200?sleep=5000",
  validDiscordWebhook: "https://discord.com/api/webhooks/123/test",
  invalidDiscordWebhook: "https://discord.com/api/webhooks/invalid"
}

export const testHashes = [
  "d4735e3a265e16eee03f59718b9b5d03019c07d8b6c51f90da3a666eec13ab35",
  "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b", 
  "4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce"
]