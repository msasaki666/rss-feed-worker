import type { Feed } from "htmlparser2";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as discord from "../src/discord";
import * as rss from "../src/rss";
import {
  type AccessSigner,
  buildForgedTokens,
  createAccessSigner,
  TEST_AUD,
  TEST_TEAM_DOMAIN,
} from "./access-fixture";
import { memoryKv } from "./memory-kv";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const baseEnv = (overrides: Partial<Env> = {}): Env => {
  return {
    RSS_FEED_WORKER_KV: memoryKv().kv as unknown as Env["RSS_FEED_WORKER_KV"],
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
      "list_webhook_keys",
      "add_feed",
      "update_feed",
      "remove_feed",
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
        id: "hatena-it",
        postTitle: "はてブ IT",
        rssUrl: "https://b.hatena.ne.jp/hotentry/it.rss",
        webhookKey: "IT",
        enabled: true,
      },
      {
        id: "wired-japan",
        postTitle: "WIRED Japan",
        rssUrl: "https://wired.jp/feed/rss",
        webhookKey: "SCIENCE",
        enabled: true,
      },
    ]);
    expect(called.text).not.toContain("discord.example");
  });

  it("does not return webhook URLs from feed registration tools", async () => {
    const bucket = memoryKv();
    const env = baseEnv({
      RSS_FEED_WORKER_KV: bucket.kv as unknown as Env["RSS_FEED_WORKER_KV"],
      DISCORD_WEBHOOK_URL_IT: "https://discord.example/super-secret-webhook",
    });
    vi.spyOn(rss, "fetchFeed").mockImplementation(async () => {
      return new Response("ok", { status: 200 });
    });
    vi.spyOn(rss, "parseFeedSafely").mockReturnValue({} as Feed);
    vi.spyOn(rss, "extractItems").mockResolvedValue([]);
    const keys = await rpc(env, "tools/call", {
      name: "list_webhook_keys",
      arguments: {},
    });
    const added = await rpc(env, "tools/call", {
      name: "add_feed",
      arguments: {
        postTitle: "Extra",
        rssUrl: "http://127.0.0.1/rss",
        webhookKey: "IT",
      },
    });
    const listed = await rpc(env, "tools/call", {
      name: "list_feeds",
      arguments: {},
    });
    const combined = `${keys.text}\n${added.text}\n${listed.text}`;
    expect(combined).not.toContain("super-secret-webhook");
    expect(added.text).toContain("https");
    expect(rss.fetchFeed).not.toHaveBeenCalled();
    vi.restoreAllMocks();
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
    const bucket = memoryKv();
    const env = baseEnv({
      RSS_FEED_WORKER_KV: bucket.kv as unknown as Env["RSS_FEED_WORKER_KV"],
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
    expect(bucket.puts).toEqual([]);
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
    const bucket = memoryKv({ "hash-old": "cached" });
    const env = baseEnv({
      RSS_FEED_WORKER_KV: bucket.kv as unknown as Env["RSS_FEED_WORKER_KV"],
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
    expect(bucket.puts).toEqual([]);
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

  it("rejects forged Access tokens when the local bypass flag is also set", async () => {
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
    const forged = await buildForgedTokens(signer, TEST_TEAM_DOMAIN);
    for (const token of Object.values(forged)) {
      const called = await rpc(
        baseEnv({
          ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
          ACCESS_AUD: TEST_AUD,
          MCP_ALLOW_UNAUTHENTICATED: "true",
        }),
        "tools/list",
        {},
        { "cf-access-jwt-assertion": token },
      );
      expect(called.status).toBe(403);
      expect(called.text).toMatch(/^Invalid token/);
    }
    fetchMock.mockRestore();
  });

  it("reports load failures without posting or marking items seen", async () => {
    const bucket = memoryKv();
    const webhook = vi.spyOn(discord, "sendDiscordWebhook");
    const env = baseEnv({
      RSS_FEED_WORKER_KV: bucket.kv as unknown as Env["RSS_FEED_WORKER_KV"],
    });
    vi.spyOn(rss, "fetchFeed").mockResolvedValue(
      new Response("down", { status: 500 }),
    );

    const preview = await rpc(env, "tools/call", {
      name: "preview_feed",
      arguments: { feed: "はてブ IT" },
    });
    const previewResult = (
      preview.body as {
        result: { isError?: boolean; content: Array<{ text: string }> };
      }
    ).result;
    expect(previewResult.isError).toBe(true);
    expect(previewResult.content[0]?.text).toContain("既読にはしていません");
    expect(previewResult.content[0]?.text).not.toContain("既読として");

    vi.mocked(rss.fetchFeed).mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    vi.spyOn(rss, "parseFeedSafely").mockReturnValue(null);
    const unseen = await rpc(env, "tools/call", {
      name: "list_unseen_items",
      arguments: { feed: "WIRED Japan" },
    });
    const unseenResult = (
      unseen.body as {
        result: { isError?: boolean; content: Array<{ text: string }> };
      }
    ).result;
    expect(unseenResult.isError).toBe(true);
    expect(unseenResult.content[0]?.text).toContain("既読にはしていません");

    vi.mocked(rss.fetchFeed).mockRejectedValue(new Error("network down"));
    const published = await rpc(env, "tools/call", {
      name: "publish_new_items",
      arguments: { feed: "はてブ IT" },
    });
    const publishedResult = (
      published.body as {
        result: {
          isError?: boolean;
          structuredContent: {
            feeds: Array<{ status: string; message?: string }>;
          };
          content: Array<{ text: string }>;
        };
      }
    ).result;
    expect(publishedResult.isError).toBeUndefined();
    expect(publishedResult.structuredContent.feeds[0]).toMatchObject({
      status: "error",
      message: "network down",
    });
    expect(publishedResult.content[0]?.text).not.toContain("既読として");
    expect(webhook).not.toHaveBeenCalled();
    expect(bucket.puts).toEqual([]);
    vi.restoreAllMocks();
  });

  it("rejects an empty feed name before touching the network", async () => {
    const fetchFeed = vi.spyOn(rss, "fetchFeed");
    const webhook = vi.spyOn(discord, "sendDiscordWebhook");
    const bucket = memoryKv();
    const env = baseEnv({
      RSS_FEED_WORKER_KV: bucket.kv as unknown as Env["RSS_FEED_WORKER_KV"],
    });

    for (const feed of ["", "   ", "https://evil.example/rss.xml"]) {
      for (const name of [
        "preview_feed",
        "list_unseen_items",
        "publish_new_items",
      ]) {
        const called = await rpc(env, "tools/call", {
          name,
          arguments: { feed },
        });
        const result = (called.body as { result: { isError?: boolean } })
          .result;
        expect(result.isError).toBe(true);
      }
    }

    expect(fetchFeed).not.toHaveBeenCalled();
    expect(webhook).not.toHaveBeenCalled();
    expect(bucket.puts).toEqual([]);
    vi.restoreAllMocks();
  });

  it("processes only the configured feeds when feed is omitted", async () => {
    vi.spyOn(rss, "fetchFeed").mockImplementation(async () => {
      return new Response("ok", { status: 200 });
    });
    vi.spyOn(rss, "parseFeedSafely").mockReturnValue({} as Feed);
    let feedNumber = 0;
    vi.spyOn(rss, "extractItems").mockImplementation(async () => {
      feedNumber += 1;
      return [
        {
          title: "全件",
          link: `https://example.com/all-${feedNumber}`,
          linkHash: `hash-all-${feedNumber}`,
          id: undefined,
        },
      ];
    });
    const destinations: string[] = [];
    vi.spyOn(discord, "sendDiscordWebhook").mockImplementation(
      async (url: string) => {
        destinations.push(url);
        return new Response(null, { status: 200 });
      },
    );
    const called = await rpc(baseEnv(), "tools/call", {
      name: "publish_new_items",
      arguments: {},
    });
    const result = (
      called.body as {
        result: { structuredContent: { feeds: Array<{ postTitle: string }> } };
      }
    ).result;
    expect(
      result.structuredContent.feeds.map((feed) => feed.postTitle),
    ).toEqual(["はてブ IT", "WIRED Japan"]);
    expect(rss.fetchFeed).toHaveBeenCalledTimes(2);
    expect(rss.fetchFeed).toHaveBeenCalledWith(
      "https://b.hatena.ne.jp/hotentry/it.rss",
    );
    expect(rss.fetchFeed).toHaveBeenCalledWith("https://wired.jp/feed/rss");
    expect(destinations).toContain("https://discord.example/it-secret");
    expect(destinations).toContain("https://discord.example/science-secret");
    expect(destinations).not.toContain("https://evil.example/rss.xml");
    vi.restoreAllMocks();
  });

  it("pages unseen items without posting and publishes every unseen item", async () => {
    const many = Array.from({ length: 21 }, (_, index) => {
      return {
        title: `記事${index}`,
        link: `https://example.com/${index}`,
        linkHash: `hash-${index}`,
        id: undefined,
      };
    });
    vi.spyOn(rss, "fetchFeed").mockImplementation(async () => {
      return new Response("ok", { status: 200 });
    });
    vi.spyOn(rss, "parseFeedSafely").mockReturnValue({} as Feed);
    vi.spyOn(rss, "extractItems").mockResolvedValue(many.slice(0, 3));
    const webhook = vi.spyOn(discord, "sendDiscordWebhook");
    const paged = await rpc(baseEnv(), "tools/call", {
      name: "list_unseen_items",
      arguments: { feed: "はてブ IT", limit: 2 },
    });
    const pagedResult = (
      paged.body as {
        result: {
          structuredContent: {
            total: number;
            returned: number;
            truncated: boolean;
            items: Array<{ linkHash: string }>;
          };
        };
      }
    ).result.structuredContent;
    expect(pagedResult).toMatchObject({
      total: 3,
      returned: 2,
      truncated: true,
    });
    expect(pagedResult.items.map((item) => item.linkHash)).toEqual([
      "hash-0",
      "hash-1",
    ]);
    expect(webhook).not.toHaveBeenCalled();

    vi.mocked(rss.extractItems).mockResolvedValue(many);
    const defaults = await rpc(baseEnv(), "tools/call", {
      name: "preview_feed",
      arguments: { feed: "はてブ IT" },
    });
    expect(
      (
        defaults.body as {
          result: {
            structuredContent: { returned: number; truncated: boolean };
          };
        }
      ).result.structuredContent,
    ).toMatchObject({ returned: 20, truncated: true });

    for (const limit of [0, 51, 1.5]) {
      const rejected = await rpc(baseEnv(), "tools/call", {
        name: "preview_feed",
        arguments: { feed: "はてブ IT", limit },
      });
      const rejectedBody = rejected.body as {
        error?: { message: string };
        result?: { isError?: boolean };
      };
      const rejectedTool = rejectedBody.result?.isError === true;
      const rejectedRpc = rejectedBody.error !== undefined;
      expect(rejectedTool || rejectedRpc || rejected.status !== 200).toBe(true);
    }
    expect(rss.fetchFeed).toHaveBeenCalledTimes(2);

    const publishWebhook = vi
      .spyOn(discord, "sendDiscordWebhook")
      .mockResolvedValue(new Response(null, { status: 200 }));
    await rpc(baseEnv({ DISCORD_WEBHOOK_URL_NOTEBOOKLM: "" }), "tools/call", {
      name: "publish_new_items",
      arguments: { feed: "はてブ IT" },
    });
    const individual = publishWebhook.mock.calls.filter((call) => {
      return call[0] === "https://discord.example/it-secret";
    });
    expect(individual).toHaveLength(21);
    vi.restoreAllMocks();
  });
});
