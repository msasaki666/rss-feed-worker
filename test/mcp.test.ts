import type { Feed } from "htmlparser2";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as discord from "../src/discord";
import * as rss from "../src/rss";
import {
  type AccessSigner,
  createAccessSigner,
  TEST_AUD,
  TEST_TEAM_DOMAIN,
} from "./access-fixture";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const baseEnv = (overrides: Partial<Env> = {}): Env => {
  return {
    RSS_FEED_WORKER_KV: {
      get: async (keys: string[]) => {
        return new Map(keys.map((key) => [key, null]));
      },
      put: async () => {},
    },
    DISCORD_WEBHOOK_URL_IT: "https://discord.example/it-secret",
    DISCORD_WEBHOOK_URL_SCIENCE: "https://discord.example/science-secret",
    DISCORD_WEBHOOK_URL_NOTEBOOKLM: "https://discord.example/list-secret",
    ENABLE_HTTP_REQUEST: "false",
    ACCESS_TEAM_DOMAIN: "",
    ACCESS_AUD: "",
    MCP_ALLOW_UNAUTHENTICATED: "true",
    ...overrides,
  } as unknown as Env;
};

const parseBody = (text: string, contentType: string | null): unknown => {
  if (contentType?.includes("text/event-stream")) {
    const data = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line.length > 0);
    const last = data[data.length - 1];
    if (!last) {
      throw new Error(`empty SSE body: ${text}`);
    }
    return JSON.parse(last);
  }
  return JSON.parse(text);
};

const rpc = async (
  env: Env,
  method: string,
  params?: Record<string, unknown>,
  headers?: HeadersInit,
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
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    }),
    env,
    ctx,
  );
  const text = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    text,
    body:
      response.status === 200
        ? parseBody(text, response.headers.get("content-type"))
        : undefined,
  };
};

describe("MCP endpoint", () => {
  let signer: AccessSigner;

  beforeAll(async () => {
    signer = await createAccessSigner("mcp-handler-key");
  });

  it("leaves non-MCP requests on the existing empty response", async () => {
    const worker = (await import("../src/index")).default;
    if (!worker.fetch) {
      throw new Error("fetch handler is missing");
    }
    const response = await worker.fetch(
      new Request("http://localhost/"),
      baseEnv(),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.statusText).toBe("OK");
    expect(await response.text()).toBe("");
  });

  it("does not treat a trailing slash as the MCP endpoint", async () => {
    const worker = (await import("../src/index")).default;
    if (!worker.fetch) {
      throw new Error("fetch handler is missing");
    }
    const response = await worker.fetch(
      new Request("http://localhost/mcp/"),
      baseEnv(),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("lists tools and configured feeds without webhook URLs", async () => {
    const env = baseEnv();
    const listed = await rpc(env, "tools/list", {});
    expect(listed.status).toBe(200);
    const tools = (
      listed.body as {
        result: { tools: Array<{ name: string; description: string }> };
      }
    ).result.tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      "list_feeds",
      "preview_feed",
      "list_unseen_items",
      "publish_new_items",
    ]);
    expect(tools.every((tool) => tool.description.length > 20)).toBe(true);

    const called = await rpc(env, "tools/call", {
      name: "list_feeds",
      arguments: {},
    });
    expect(called.status).toBe(200);
    const result = (
      called.body as {
        result: {
          structuredContent: {
            feeds: Array<{ postTitle: string; rssUrl: string }>;
          };
        };
      }
    ).result;
    expect(result.structuredContent.feeds).toEqual([
      {
        postTitle: "はてブ IT",
        rssUrl: "https://b.hatena.ne.jp/hotentry/it.rss",
      },
      {
        postTitle: "WIRED Japan",
        rssUrl: "https://wired.jp/feed/rss",
      },
    ]);
    expect(called.text).not.toContain("discord.example");
  });

  it("previews a feed without writing KV or calling Discord", async () => {
    const items = [
      {
        title: "新しい記事",
        link: "https://example.com/new",
        linkHash: "hash-new",
        id: undefined,
      },
    ];
    vi.spyOn(rss, "fetchFeed").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    vi.spyOn(rss, "parseFeedSafely").mockReturnValue({} as Feed);
    vi.spyOn(rss, "extractItems").mockResolvedValue(items);
    const webhook = vi.spyOn(discord, "sendDiscordWebhook");
    const put = vi.fn();
    const env = baseEnv({
      RSS_FEED_WORKER_KV: {
        get: async () => new Map(),
        put,
      } as unknown as Env["RSS_FEED_WORKER_KV"],
    });

    const called = await rpc(env, "tools/call", {
      name: "preview_feed",
      arguments: { feed: "はてブ IT", limit: 10 },
    });

    const result = (
      called.body as {
        result: {
          isError?: boolean;
          structuredContent: { items: Array<{ title: string }>; total: number };
        };
      }
    ).result;
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.total).toBe(1);
    expect(result.structuredContent.items[0]?.title).toBe("新しい記事");
    expect(webhook).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("returns unseen items and does not mark them seen", async () => {
    const items = [
      {
        title: "新着",
        link: "https://example.com/new",
        linkHash: "hash-new",
        id: undefined,
      },
      {
        title: "既読",
        link: "https://example.com/old",
        linkHash: "hash-old",
        id: undefined,
      },
    ];
    vi.spyOn(rss, "fetchFeed").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    vi.spyOn(rss, "parseFeedSafely").mockReturnValue({} as Feed);
    vi.spyOn(rss, "extractItems").mockResolvedValue(items);
    const put = vi.fn();
    const env = baseEnv({
      RSS_FEED_WORKER_KV: {
        get: async (keys: string[]) => {
          return new Map(
            keys.map((key) => [key, key === "hash-old" ? "cached" : null]),
          );
        },
        put,
      } as unknown as Env["RSS_FEED_WORKER_KV"],
    });

    const called = await rpc(env, "tools/call", {
      name: "list_unseen_items",
      arguments: { feed: "WIRED Japan" },
    });
    const result = (
      called.body as {
        result: { structuredContent: { items: Array<{ link: string }> } };
      }
    ).result;
    expect(result.structuredContent.items).toEqual([
      {
        title: "新着",
        link: "https://example.com/new",
        linkHash: "hash-new",
      },
    ]);
    expect(put).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("publishes through the existing feed processor", async () => {
    const items = [
      {
        title: "投稿する",
        link: "https://example.com/post",
        linkHash: "hash-post",
        id: undefined,
      },
    ];
    vi.spyOn(rss, "fetchFeed").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    vi.spyOn(rss, "parseFeedSafely").mockReturnValue({} as Feed);
    vi.spyOn(rss, "extractItems").mockResolvedValue(items);
    const webhook = vi
      .spyOn(discord, "sendDiscordWebhook")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const env = baseEnv();

    const called = await rpc(env, "tools/call", {
      name: "publish_new_items",
      arguments: { feed: "はてブ IT" },
    });
    const result = (
      called.body as {
        result: {
          structuredContent: {
            feeds: Array<{
              status: string;
              published: Array<{ title: string }>;
            }>;
          };
        };
      }
    ).result;
    expect(result.structuredContent.feeds).toHaveLength(1);
    expect(result.structuredContent.feeds[0]?.status).toBe("ok");
    expect(result.structuredContent.feeds[0]?.published[0]?.title).toBe(
      "投稿する",
    );
    expect(webhook).toHaveBeenCalledWith(
      "https://discord.example/it-secret",
      "**はてブ IT | 投稿する**\n\nhttps://example.com/post",
    );
    expect(called.text).not.toContain("discord.example");
    vi.restoreAllMocks();
  });

  it("reports an unknown feed without fetching", async () => {
    const fetchFeed = vi.spyOn(rss, "fetchFeed");
    const called = await rpc(baseEnv(), "tools/call", {
      name: "preview_feed",
      arguments: { feed: "存在しない" },
    });
    const result = (called.body as { result: { isError?: boolean } }).result;
    expect(result.isError).toBe(true);
    expect(fetchFeed).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("rejects /mcp when Access is not configured", async () => {
    const called = await rpc(
      baseEnv({ MCP_ALLOW_UNAUTHENTICATED: "" }),
      "tools/list",
      {},
    );
    expect(called.status).toBe(403);
    expect(called.text).toMatch(/ACCESS_TEAM_DOMAIN/);
  });

  it("rejects MCP calls without an Access JWT when validation is configured", async () => {
    const called = await rpc(
      baseEnv({
        ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        ACCESS_AUD: TEST_AUD,
      }),
      "tools/list",
      {},
    );
    expect(called.status).toBe(403);
    expect(called.text).toMatch(/Cf-Access-Jwt-Assertion/);
  });

  it("accepts a valid Access JWT and still serves tools", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === `${TEST_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
          return new Response(JSON.stringify({ keys: [signer.jwk] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("unexpected", { status: 500 });
      });
    const token = await signer.sign();
    const called = await rpc(
      baseEnv({
        ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        ACCESS_AUD: TEST_AUD,
      }),
      "tools/list",
      {},
      { "cf-access-jwt-assertion": token },
    );
    expect(called.status).toBe(200);
    const tools = (
      called.body as { result: { tools: Array<{ name: string }> } }
    ).result.tools;
    expect(tools.map((tool) => tool.name)).toContain("publish_new_items");
    fetchMock.mockRestore();
  });

  it("does not apply the Access check outside /mcp", async () => {
    const worker = (await import("../src/index")).default;
    if (!worker.fetch) {
      throw new Error("fetch handler is missing");
    }
    const response = await worker.fetch(
      new Request("http://localhost/"),
      baseEnv({
        ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        ACCESS_AUD: TEST_AUD,
      }),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});
