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
  resolveWebhookUrl,
  setWebhook,
  updateFeed,
} from "../src/feed-store";
import * as rss from "../src/rss";
import { memoryKv } from "./memory-kv";

const SECRET = "https://discord.example/super-secret-webhook";

const envFor = (
  bucket: ReturnType<typeof memoryKv>,
  extra: Record<string, string> = {},
) => {
  return {
    RSS_FEED_WORKER_KV: bucket.kv,
    DISCORD_WEBHOOK_URL_IT: SECRET,
    DISCORD_WEBHOOK_URL_SCIENCE: "https://discord.example/science-secret",
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
    expect(JSON.stringify(saved)).not.toContain("super-secret-webhook");
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
    vi.restoreAllMocks();
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
