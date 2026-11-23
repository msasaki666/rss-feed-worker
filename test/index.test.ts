import type { Feed } from "htmlparser2";
import { describe, expect, it, vi } from "vitest";
import * as discord from "../src/discord";
import * as rss from "../src/rss";
import { memoryKv } from "./memory-kv";
import { IT_WEBHOOK_URL, SCIENCE_WEBHOOK_URL } from "./webhook-fixtures";

vi.mock("cloudflare:workers", () => ({ env: {} }));

describe("processFeed", () => {
  it("sends list to secondary webhook and individual links", async () => {
    const items = [
      {
        title: "New",
        link: "https://example.com/new",
        linkHash: "hash-new",
        id: undefined,
      },
      {
        title: "Old",
        link: "https://example.com/old",
        linkHash: "hash-old",
        id: undefined,
      },
    ];

    const fetchFeedMock = vi
      .spyOn(rss, "fetchFeed")
      .mockResolvedValue(new Response("ok", { status: 200 }));
    const parseMock = vi
      .spyOn(rss, "parseFeedSafely")
      .mockReturnValue({} as Feed);
    const extractMock = vi.spyOn(rss, "extractItems").mockResolvedValue(items);

    const webhookMock = vi
      .spyOn(discord, "sendDiscordWebhook")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const kvStore = new Map<string, string>();
    kvStore.set("hash-old", "cached");
    const env = {
      RSS_FEED_WORKER_KV: {
        get: async (keys: string[]) => {
          return new Map(keys.map((k) => [k, kvStore.get(k) ?? null]));
        },
        put: async (key: string, value: string) => {
          kvStore.set(key, value);
        },
      },
      DISCORD_WEBHOOK_URL_NOTEBOOKLM: "https://discord.example/bulk",
    } as unknown as Env;

    const { processFeed } = await import("../src/index");
    await processFeed(
      {
        postTitle: "test",
        rssUrl: "https://example.com/feed",
        discordWebhookUrl: "https://discord.example",
      },
      env,
    );

    expect(webhookMock).toHaveBeenNthCalledWith(
      1,
      "https://discord.example/bulk",
      "https://example.com/new",
    );
    expect(webhookMock).toHaveBeenNthCalledWith(
      2,
      "https://discord.example",
      "**test | New**\n\nhttps://example.com/new",
    );
    expect(webhookMock).toHaveBeenCalledTimes(2);
    expect(kvStore.has("hash-new")).toBe(true);

    fetchFeedMock.mockRestore();
    parseMock.mockRestore();
    extractMock.mockRestore();
    webhookMock.mockRestore();
  });

  it("stores only the posted item and continues after a summary failure", async () => {
    const items = [
      {
        title: "Fail",
        link: "https://example.com/fail",
        linkHash: "hash-fail",
        id: undefined,
      },
      {
        title: "Ok",
        link: "https://example.com/ok",
        linkHash: "hash-ok",
        id: undefined,
      },
    ];
    vi.spyOn(rss, "fetchFeed").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    vi.spyOn(rss, "parseFeedSafely").mockReturnValue({} as Feed);
    vi.spyOn(rss, "extractItems").mockResolvedValue(items);

    const calls: string[] = [];
    const itemWebhook = "https://discord.example/item";
    const summaryWebhook = "https://discord.example/bulk";
    vi.spyOn(discord, "sendDiscordWebhook").mockImplementation(
      async (url: string) => {
        calls.push(url);
        if (url === summaryWebhook) {
          return new Response("list fail", { status: 500 });
        }
        const individualCalls = calls.filter((called) => {
          return called === itemWebhook;
        }).length;
        if (individualCalls === 1) {
          return new Response("fail", { status: 500 });
        }
        return new Response(null, { status: 200 });
      },
    );

    const puts: Array<[string, { expirationTtl?: number } | undefined]> = [];
    const env = {
      RSS_FEED_WORKER_KV: {
        get: async (keys: string[]) => {
          return new Map(keys.map((key) => [key, null]));
        },
        put: async (
          key: string,
          _value: string,
          options?: { expirationTtl?: number },
        ) => {
          puts.push([key, options]);
        },
      },
      DISCORD_WEBHOOK_URL_NOTEBOOKLM: summaryWebhook,
    } as unknown as Env;

    const { processFeed } = await import("../src/index");
    const result = await processFeed(
      {
        postTitle: "test",
        rssUrl: "https://example.com/feed",
        discordWebhookUrl: itemWebhook,
      },
      env,
    );

    expect(calls).toEqual([summaryWebhook, itemWebhook, itemWebhook]);
    expect(result.status).toBe("ok");
    expect(result.failed.map((item) => item.linkHash)).toEqual(["hash-fail"]);
    expect(result.published.map((item) => item.linkHash)).toEqual(["hash-ok"]);
    expect(puts).toEqual([["hash-ok", { expirationTtl: 864000 }]]);
    vi.restoreAllMocks();
  });

  it("does not post or store when the feed cannot be loaded", async () => {
    const webhook = vi.spyOn(discord, "sendDiscordWebhook");
    const put = vi.fn();
    const env = {
      RSS_FEED_WORKER_KV: {
        get: async () => new Map(),
        put,
      },
      DISCORD_WEBHOOK_URL_NOTEBOOKLM: "https://discord.example/bulk",
    } as unknown as Env;
    const target = {
      postTitle: "test",
      rssUrl: "https://example.com/feed",
      discordWebhookUrl: "https://discord.example/item",
    };
    const { processFeed } = await import("../src/index");

    vi.spyOn(rss, "fetchFeed").mockResolvedValue(
      new Response("down", { status: 500 }),
    );
    const fetched = await processFeed(target, env);
    expect(fetched).toMatchObject({
      status: "fetch_failed",
      httpStatus: 500,
      published: [],
      failed: [],
    });

    vi.mocked(rss.fetchFeed).mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    vi.spyOn(rss, "parseFeedSafely").mockReturnValue(null);
    const parsed = await processFeed(target, env);
    expect(parsed.status).toBe("parse_failed");

    vi.mocked(rss.fetchFeed).mockRejectedValue(new Error("network down"));
    await expect(processFeed(target, env)).rejects.toThrow("network down");

    expect(webhook).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("runs every configured feed from the schedule", async () => {
    vi.spyOn(rss, "fetchFeed").mockImplementation(async () => {
      return new Response("ok", { status: 200 });
    });
    vi.spyOn(rss, "parseFeedSafely").mockReturnValue({} as Feed);
    let feedNumber = 0;
    vi.spyOn(rss, "extractItems").mockImplementation(async () => {
      feedNumber += 1;
      return [
        {
          title: "Scheduled",
          link: `https://example.com/scheduled-${feedNumber}`,
          linkHash: `hash-scheduled-${feedNumber}`,
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
    const env = {
      RSS_FEED_WORKER_KV: memoryKv().kv as unknown as Env["RSS_FEED_WORKER_KV"],
      DISCORD_WEBHOOK_URL_IT: IT_WEBHOOK_URL,
      DISCORD_WEBHOOK_URL_SCIENCE: SCIENCE_WEBHOOK_URL,
      DISCORD_WEBHOOK_URL_NOTEBOOKLM: "",
    } as unknown as Env;

    const worker = (await import("../src/index")).default;
    if (!worker.scheduled) {
      throw new Error("scheduled handler is missing");
    }
    await worker.scheduled(
      {
        cron: "0 23 * * *",
        scheduledTime: Date.now(),
        noRetry: () => {},
      } as ScheduledController,
      env,
      {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as unknown as ExecutionContext,
    );

    expect(rss.fetchFeed).toHaveBeenCalledWith(
      "https://b.hatena.ne.jp/hotentry/it.rss",
    );
    expect(rss.fetchFeed).toHaveBeenCalledWith("https://wired.jp/feed/rss");
    expect(rss.fetchFeed).toHaveBeenCalledTimes(2);
    expect(destinations).toContain(IT_WEBHOOK_URL);
    expect(destinations).toContain(SCIENCE_WEBHOOK_URL);
    vi.restoreAllMocks();
  });

  it("does not schedule a disabled feed", async () => {
    const bucket = memoryKv();
    const env = {
      RSS_FEED_WORKER_KV: bucket.kv,
      DISCORD_WEBHOOK_URL_IT: IT_WEBHOOK_URL,
      DISCORD_WEBHOOK_URL_SCIENCE: SCIENCE_WEBHOOK_URL,
      DISCORD_WEBHOOK_URL_NOTEBOOKLM: "",
    } as unknown as Env;
    const { updateFeed } = await import("../src/feed-store");
    await updateFeed(env, { id: "wired-japan", enabled: false });
    const urls: string[] = [];
    vi.spyOn(rss, "fetchFeed").mockImplementation(async (url: string) => {
      urls.push(url);
      return new Response("ok", { status: 200 });
    });
    vi.spyOn(rss, "parseFeedSafely").mockReturnValue({} as Feed);
    vi.spyOn(rss, "extractItems").mockResolvedValue([
      {
        title: "Scheduled",
        link: "https://example.com/scheduled",
        linkHash: "hash-scheduled-disabled",
        id: undefined,
      },
    ]);
    const destinations: string[] = [];
    vi.spyOn(discord, "sendDiscordWebhook").mockImplementation(
      async (url: string) => {
        destinations.push(url);
        return new Response(null, { status: 200 });
      },
    );
    const worker = (await import("../src/index")).default;
    if (!worker.scheduled) {
      throw new Error("scheduled handler is missing");
    }
    await worker.scheduled(
      {
        cron: "0 23 * * *",
        scheduledTime: Date.now(),
        noRetry: () => {},
      } as ScheduledController,
      env,
      {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as unknown as ExecutionContext,
    );
    expect(urls).toContain("https://b.hatena.ne.jp/hotentry/it.rss");
    expect(urls).not.toContain("https://wired.jp/feed/rss");
    expect(destinations).toContain(IT_WEBHOOK_URL);
    expect(destinations).not.toContain(SCIENCE_WEBHOOK_URL);
    vi.restoreAllMocks();
  });
});
