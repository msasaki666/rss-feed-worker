import type { Feed } from "htmlparser2";
import { describe, expect, it, vi } from "vitest";
import * as discord from "../src/discord";
import * as rss from "../src/rss";
import type { Env } from "../worker-configuration";

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
});
