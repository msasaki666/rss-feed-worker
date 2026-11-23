import type { Feed } from "htmlparser2";
import { describe, expect, it, vi } from "vitest";
import * as discord from "../src/discord";
import {
  addFeed,
  CATALOG_KEY,
  getEnabledFeedTargets,
  listWebhookKeys,
  loadCatalog,
  removeFeed,
  removeWebhook,
  resolveWebhookUrl,
  setWebhook,
  updateFeed,
  WEBHOOK_MIGRATION_KEY,
  WEBHOOKS_KEY,
} from "../src/feed-store";
import * as rss from "../src/rss";
import { memoryKv } from "./memory-kv";

import { IT_WEBHOOK_URL, SCIENCE_WEBHOOK_URL } from "./webhook-fixtures";

const SECRET = IT_WEBHOOK_URL;

const envFor = (
  bucket: ReturnType<typeof memoryKv>,
  extra: Record<string, string> = {},
) => {
  return {
    RSS_FEED_WORKER_KV: bucket.kv,
    DISCORD_WEBHOOK_URL_IT: SECRET,
    DISCORD_WEBHOOK_URL_SCIENCE: SCIENCE_WEBHOOK_URL,
    ...extra,
  } as unknown as Env;
};

const parsedFeed = () => {
  vi.spyOn(rss, "fetchFeed").mockImplementation(async () => {
    return new Response("<rss/>", { status: 200 });
  });
  vi.spyOn(rss, "parseFeedSafely").mockReturnValue({} as Feed);
  vi.spyOn(rss, "extractItems").mockResolvedValue([
    {
      id: undefined,
      title: "既存",
      link: "https://example.com/current",
      linkHash: "hash-current",
    },
  ]);
};

describe("feed catalog", () => {
  it("seeds the existing feeds once and does not restore them after removal", async () => {
    const bucket = memoryKv();
    bucket.store.delete(CATALOG_KEY);
    const env = envFor(bucket);
    const seeded = await loadCatalog(env);
    expect(seeded.map((feed) => feed.id)).toEqual(["hatena-it", "wired-japan"]);
    await removeFeed(env, "hatena-it");
    await removeFeed(env, "wired-japan");
    expect(await loadCatalog(env)).toEqual([]);
  });

  it("keeps the built-in secret aliases and stores new webhooks only by name", async () => {
    const bucket = memoryKv();
    const env = envFor(bucket);
    expect(await resolveWebhookUrl(env, "IT")).toBe(SECRET);
    const saved = await setWebhook(
      env,
      "EXTRA",
      "https://discord.com/api/webhooks/42/abcdefghij",
    );
    expect(saved.ok).toBe(true);
    const listed = await listWebhookKeys(env);
    expect(listed.map((item) => item.name)).toEqual(
      expect.arrayContaining(["IT", "SCIENCE", "EXTRA"]),
    );
    expect(JSON.stringify(listed)).not.toContain(SECRET);
    expect(JSON.stringify(listed)).not.toContain("abcdefghij");
    expect(listed.find((item) => item.name === "EXTRA")?.hint).toBe("ghij");
  });

  it("rejects unsafe URLs before fetching and saves a parsed feed", async () => {
    const fetchFeed = vi.spyOn(rss, "fetchFeed");
    const bucket = memoryKv();
    const env = envFor(bucket);
    const blocked = await addFeed(env, {
      postTitle: "危険",
      rssUrl: "https://127.0.0.1/rss",
      webhookKey: "IT",
    });
    expect(blocked.ok).toBe(false);
    expect(fetchFeed).not.toHaveBeenCalled();

    parsedFeed();
    const webhook = vi.spyOn(discord, "sendDiscordWebhook");
    const saved = await addFeed(env, {
      id: "example",
      postTitle: "Example",
      rssUrl: "https://example.com/rss.xml",
      webhookKey: "IT",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }
    expect(saved.marked).toBe(1);
    expect(saved.feed.webhookKey).toBe("IT");
    expect(JSON.stringify(saved)).not.toContain("TestItWebhookTokenAAAA");
    expect(webhook).not.toHaveBeenCalled();
    expect(bucket.puts.some((put) => put.key === "hash-current")).toBe(true);
    expect(
      bucket.puts.find((put) => put.key === "hash-current")?.options,
    ).toEqual({ expirationTtl: 864000 });
    vi.restoreAllMocks();
  });

  it("marks the new feed as seen when its URL changes", async () => {
    const bucket = memoryKv();
    const env = envFor(bucket);
    parsedFeed();
    const webhook = vi.spyOn(discord, "sendDiscordWebhook");
    bucket.puts.length = 0;
    const updated = await updateFeed(env, {
      id: "hatena-it",
      rssUrl: "https://example.com/new.xml",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) {
      return;
    }
    expect(updated.feed.rssUrl).toBe("https://example.com/new.xml");
    expect(updated.marked).toBe(1);
    expect(webhook).not.toHaveBeenCalled();
    expect(bucket.puts.some((put) => put.key === "hash-current")).toBe(true);

    bucket.puts.length = 0;
    vi.mocked(rss.fetchFeed).mockClear();
    const quiet = await updateFeed(env, {
      id: "hatena-it",
      rssUrl: "https://example.com/again.xml",
      markCurrentAsSeen: false,
    });
    expect(quiet.ok).toBe(true);
    if (!quiet.ok) {
      return;
    }
    expect(quiet.marked).toBe(0);
    expect(bucket.puts.map((put) => put.key)).toEqual([CATALOG_KEY]);
    expect(webhook).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("writes seen hashes before the new catalog is visible", async () => {
    const bucket = memoryKv();
    const env = envFor(bucket);
    parsedFeed();
    bucket.puts.length = 0;
    const added = await addFeed(env, {
      id: "example",
      postTitle: "Example",
      rssUrl: "https://example.com/rss.xml",
      webhookKey: "IT",
    });
    expect(added.ok).toBe(true);
    const addedKeys = bucket.puts.map((put) => put.key);
    expect(addedKeys.indexOf("hash-current")).toBeGreaterThanOrEqual(0);
    expect(addedKeys.indexOf("hash-current")).toBeLessThan(
      addedKeys.lastIndexOf(CATALOG_KEY),
    );

    bucket.puts.length = 0;
    const updated = await updateFeed(env, {
      id: "hatena-it",
      rssUrl: "https://example.com/moved.xml",
    });
    expect(updated.ok).toBe(true);
    const updatedKeys = bucket.puts.map((put) => put.key);
    expect(updatedKeys.indexOf("hash-current")).toBeGreaterThanOrEqual(0);
    expect(updatedKeys.indexOf("hash-current")).toBeLessThan(
      updatedKeys.lastIndexOf(CATALOG_KEY),
    );
    expect(
      bucket.puts.find((put) => put.key === "hash-current")?.options,
    ).toEqual({ expirationTtl: 864000 });
    vi.restoreAllMocks();
  });

  it("does not save a feed when the RSS fetch or parse fails", async () => {
    const bucket = memoryKv();
    const env = envFor(bucket);
    const before = bucket.store.get(CATALOG_KEY);
    vi.spyOn(rss, "fetchFeed").mockResolvedValue(
      new Response("down", { status: 500 }),
    );
    const fetched = await addFeed(env, {
      id: "broken",
      postTitle: "Broken",
      rssUrl: "https://example.com/rss.xml",
      webhookUrl: "https://discord.com/api/webhooks/42/abcdefghij",
    });
    expect(fetched.ok).toBe(false);
    expect(bucket.store.get(CATALOG_KEY)).toBe(before);
    expect(bucket.store.has(WEBHOOKS_KEY)).toBe(false);

    vi.mocked(rss.fetchFeed).mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    vi.spyOn(rss, "parseFeedSafely").mockReturnValue(null);
    const parsed = await updateFeed(env, {
      id: "hatena-it",
      rssUrl: "https://example.com/new.xml",
      webhookUrl: "https://discord.com/api/webhooks/42/abcdefghij",
    });
    expect(parsed.ok).toBe(false);
    expect(bucket.store.get(CATALOG_KEY)).toBe(before);
    expect(bucket.store.has(WEBHOOKS_KEY)).toBe(false);
    vi.restoreAllMocks();
  });

  it("rejects redirects to a private address or http and saves nothing", async () => {
    const bucket = memoryKv();
    const env = envFor(bucket);
    const before = bucket.store.get(CATALOG_KEY);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.startsWith("https://example.com/private")) {
          return new Response(null, {
            status: 302,
            headers: { location: "https://127.0.0.1/rss" },
          });
        }
        if (url.startsWith("https://example.com/plain")) {
          return new Response(null, {
            status: 302,
            headers: { location: "http://example.com/rss" },
          });
        }
        return new Response("unexpected", { status: 500 });
      });
    const privateRedirect = await addFeed(env, {
      id: "redir",
      postTitle: "Redir",
      rssUrl: "https://example.com/private",
      webhookUrl: "https://discord.com/api/webhooks/42/abcdefghij",
    });
    expect(privateRedirect.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    const httpRedirect = await updateFeed(env, {
      id: "hatena-it",
      rssUrl: "https://example.com/plain",
      webhookUrl: "https://discord.com/api/webhooks/42/abcdefghij",
    });
    expect(httpRedirect.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bucket.store.get(CATALOG_KEY)).toBe(before);
    expect(bucket.store.has(WEBHOOKS_KEY)).toBe(false);
    fetchMock.mockRestore();
  });

  it("rejects duplicate ids, empty titles, and unknown webhook keys", async () => {
    const bucket = memoryKv();
    const env = envFor(bucket);
    const before = bucket.store.get(CATALOG_KEY);
    const fetchFeed = vi.spyOn(rss, "fetchFeed");
    const duplicate = await addFeed(env, {
      id: "hatena-it",
      postTitle: "Another",
      rssUrl: "https://example.com/rss.xml",
      webhookKey: "IT",
    });
    const blank = await addFeed(env, {
      postTitle: " ",
      rssUrl: "https://example.com/rss.xml",
      webhookKey: "IT",
    });
    const brokenTitle = await updateFeed(env, {
      id: "hatena-it",
      postTitle: "line\nbreak",
    });
    const unknown = await addFeed(env, {
      id: "missing-hook",
      postTitle: "Missing",
      rssUrl: "https://example.com/rss.xml",
      webhookKey: "NOPE",
    });
    expect(duplicate.ok).toBe(false);
    expect(blank.ok).toBe(false);
    expect(brokenTitle.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    expect(fetchFeed).not.toHaveBeenCalled();
    expect(bucket.store.get(CATALOG_KEY)).toBe(before);
    const stored = JSON.parse(bucket.store.get(WEBHOOKS_KEY) ?? "{}") as Record<
      string,
      string
    >;
    expect(stored).toEqual({
      IT: SECRET,
      SCIENCE: SCIENCE_WEBHOOK_URL,
    });
    expect(bucket.store.get(WEBHOOK_MIGRATION_KEY)).toBe("1");
    expect((await loadCatalog(env))[0]?.postTitle).toBe("はてブ IT");
    fetchFeed.mockRestore();
  });

  it("does not mark current items when asked not to", async () => {
    const bucket = memoryKv();
    const env = envFor(bucket);
    parsedFeed();
    const webhook = vi.spyOn(discord, "sendDiscordWebhook");
    bucket.puts.length = 0;
    const saved = await addFeed(env, {
      id: "quiet",
      postTitle: "Quiet",
      rssUrl: "https://example.com/rss.xml",
      webhookKey: "IT",
      markCurrentAsSeen: false,
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.marked).toBe(0);
    }
    expect(bucket.puts.map((put) => put.key)).toEqual([
      WEBHOOKS_KEY,
      WEBHOOK_MIGRATION_KEY,
      CATALOG_KEY,
    ]);
    expect(webhook).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("lets a KV webhook named IT override the migrated secret", async () => {
    const bucket = memoryKv();
    const env = envFor(bucket);
    expect(await resolveWebhookUrl(env, "IT")).toBe(SECRET);
    const override = "https://discord.com/api/webhooks/42/abcdefghij";
    const saved = await setWebhook(env, "IT", override);
    expect(saved.ok).toBe(true);
    expect(await resolveWebhookUrl(env, "IT")).toBe(override);
    env.DISCORD_WEBHOOK_URL_IT =
      "https://discord.com/api/webhooks/99/ShouldNotBeRead9999";
    expect(await resolveWebhookUrl(env, "IT")).toBe(override);
    const listed = await listWebhookKeys(env);
    expect(JSON.stringify(listed)).not.toContain("abcdefghij");
    expect(JSON.stringify(listed)).not.toContain("ShouldNotBeRead9999");
    expect(listed.find((item) => item.name === "IT")?.hint).toBe("ghij");

    const inUse = await removeWebhook(env, "IT");
    expect(inUse.ok).toBe(false);
    await removeFeed(env, "hatena-it");
    await removeFeed(env, "wired-japan");
    const removed = await removeWebhook(env, "IT");
    expect(removed.ok).toBe(true);
    expect(await resolveWebhookUrl(env, "IT")).toBeUndefined();
  });

  it("keeps seen article hashes when a feed definition is removed", async () => {
    const bucket = memoryKv({ "hash-current": "cached" });
    const env = envFor(bucket);
    const removed = await removeFeed(env, "hatena-it");
    expect(removed.ok).toBe(true);
    expect(bucket.store.get("hash-current")).toBe("cached");
    expect(
      (await loadCatalog(env)).some((feed) => feed.id === "hatena-it"),
    ).toBe(false);
  });

  it("skips disabled feeds and feeds with an unknown webhook key", async () => {
    const bucket = memoryKv();
    const env = envFor(bucket);
    await updateFeed(env, { id: "wired-japan", enabled: false });
    const targets = await getEnabledFeedTargets(env);
    expect(targets.map((target) => target.postTitle)).toEqual(["はてブ IT"]);
    expect(targets[0]?.discordWebhookUrl).toBe(SECRET);
  });
});
