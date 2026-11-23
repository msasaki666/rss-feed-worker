import type { Feed } from "htmlparser2";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as discord from "../src/discord";
import * as rss from "../src/rss";
import { memoryKv } from "./memory-kv";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const ID = "123456789012345678";
const TOKEN = "ZzDistinctiveWebhookToken9999";
const WEBHOOK_URL = `https://discord.com/api/webhooks/${ID}/${TOKEN}`;
const WEBHOOK_PATH = `/api/webhooks/${ID}/${TOKEN}`;
const LEGACY = "LegacyScienceSecretToken7777";
const REGISTERED_ID = "987654321098765432";
const REGISTERED_TOKEN = "YyRegisteredWebhookToken8888";
const REGISTERED_URL = `https://discord.com/api/webhooks/${REGISTERED_ID}/${REGISTERED_TOKEN}`;

const secrets = [
  WEBHOOK_URL,
  TOKEN,
  WEBHOOK_PATH,
  ID,
  `/api/webhooks/${ID}`,
  LEGACY,
  REGISTERED_URL,
  REGISTERED_TOKEN,
  REGISTERED_ID,
  `/api/webhooks/${REGISTERED_ID}`,
];

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const assertHidden = (payload: string) => {
  for (const secret of secrets) {
    expect(payload, secret).not.toContain(secret);
  }
};

const serialized = (text: string, contentType: string | null): string => {
  let parsed: unknown = text;
  try {
    if (contentType?.includes("text/event-stream")) {
      const data = text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter((line) => line.length > 0);
      parsed = JSON.parse(data[data.length - 1] ?? "null");
    } else {
      parsed = JSON.parse(text);
    }
  } catch {
    parsed = text;
  }
  return `${text}\n${JSON.stringify(parsed)}`;
};

const callTool = async (
  env: Env,
  name: string,
  args: Record<string, unknown>,
) => {
  const worker = (await import("../src/index")).default;
  if (!worker.fetch) {
    throw new Error("fetch handler is missing");
  }
  const response = await worker.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        host: "localhost",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
    env,
    ctx,
  );
  const text = await response.text();
  return serialized(text, response.headers.get("content-type"));
};

const base = (kv: unknown): Env => {
  return {
    RSS_FEED_WORKER_KV: kv,
    DISCORD_WEBHOOK_URL_IT: WEBHOOK_URL,
    DISCORD_WEBHOOK_URL_SCIENCE: LEGACY,
    DISCORD_WEBHOOK_URL_NOTEBOOKLM: "",
    ENABLE_HTTP_REQUEST: "false",
    ACCESS_TEAM_DOMAIN: "",
    ACCESS_AUD: "",
    MCP_ALLOW_UNAUTHENTICATED: "true",
  } as unknown as Env;
};

describe("webhook URLs are never returned", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(rss, "fetchFeed").mockImplementation(async () => {
      return new Response("<rss/>", { status: 200 });
    });
    vi.spyOn(rss, "parseFeedSafely").mockReturnValue({} as Feed);
    vi.spyOn(rss, "extractItems").mockResolvedValue([
      {
        id: undefined,
        title: "記事",
        link: "https://example.com/story",
        linkHash: "hash-story",
      },
    ]);
    vi.spyOn(discord, "sendDiscordWebhook").mockImplementation(async () => {
      throw new Error(`discord failed ${WEBHOOK_URL} ${LEGACY}`);
    });
  });

  it("hides legacy and registered secrets on every tool result", async () => {
    const bucket = memoryKv();
    const env = base(bucket.kv);
    const calls: Array<[string, Record<string, unknown>]> = [
      ["list_feeds", {}],
      ["list_webhook_keys", {}],
      ["set_webhook", { name: "extra", webhookUrl: REGISTERED_URL }],
      [
        "set_webhook",
        { name: "bad", webhookUrl: `http://evil.example/${TOKEN}` },
      ],
      [
        "add_feed",
        {
          id: "extra-feed",
          postTitle: "Extra",
          rssUrl: "https://example.com/rss.xml",
          webhookUrl: REGISTERED_URL,
        },
      ],
      [
        "add_feed",
        {
          postTitle: "Bad",
          rssUrl: "https://example.com/rss.xml",
          webhookUrl: "https://evil.example/api/webhooks/1/abcdefghij",
        },
      ],
      ["update_feed", { id: "hatena-it", postTitle: "はてブ" }],
      [
        "update_feed",
        {
          id: "hatena-it",
          webhookUrl: `http://discord.com/api/webhooks/${ID}/${TOKEN}`,
        },
      ],
      ["remove_webhook", { name: "missing-hook" }],
      ["remove_webhook", { name: "IT" }],
      ["remove_feed", { id: "missing-feed" }],
      ["preview_feed", { feed: "hatena-it" }],
      ["preview_feed", { feed: "" }],
      ["list_unseen_items", { feed: "wired-japan" }],
      ["list_unseen_items", { feed: "no-such-feed" }],
      ["publish_new_items", { feed: "hatena-it" }],
      ["publish_new_items", { feed: "   " }],
      ["publish_new_items", {}],
    ];
    for (const [name, args] of calls) {
      assertHidden(await callTool(env, name, args));
    }
    assertHidden(await callTool(env, "remove_feed", { id: "extra-feed" }));
    assertHidden(await callTool(env, "remove_webhook", { name: "extra" }));
  });

  it("hides secrets when a dependency throws them", async () => {
    const kv = {
      get: async () => {
        throw new Error(`kv down ${WEBHOOK_URL} ${LEGACY} ${REGISTERED_URL}`);
      },
      put: async () => {
        throw new Error(`kv put ${TOKEN} ${WEBHOOK_PATH}`);
      },
      delete: async () => {
        throw new Error(`kv delete ${ID}`);
      },
    };
    const env = base(kv);
    vi.mocked(rss.fetchFeed).mockRejectedValue(
      new Error(`fetch ${WEBHOOK_URL} ${LEGACY}`),
    );
    for (const [name, args] of [
      ["list_feeds", {}],
      ["list_webhook_keys", {}],
      ["set_webhook", { name: "extra", webhookUrl: REGISTERED_URL }],
      ["remove_webhook", { name: "extra" }],
      [
        "add_feed",
        {
          postTitle: "Extra",
          rssUrl: "https://example.com/rss.xml",
          webhookKey: "IT",
        },
      ],
      ["update_feed", { id: "hatena-it", postTitle: "次" }],
      ["remove_feed", { id: "hatena-it" }],
      ["preview_feed", { feed: "hatena-it" }],
      ["list_unseen_items", { feed: "hatena-it" }],
      ["publish_new_items", { feed: "hatena-it" }],
      ["publish_new_items", {}],
    ] as Array<[string, Record<string, unknown>]>) {
      assertHidden(await callTool(env, name, args));
    }
  });
});
