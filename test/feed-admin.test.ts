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
    DISCORD_WEBHOOKS: extra.DISCORD_WEBHOOKS,
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

  it("lists webhook names and never the secret URL", () => {
    const keys = listWebhookKeys({
      DISCORD_WEBHOOK_URL_IT: SECRET,
      DISCORD_WEBHOOK_URL_SCIENCE: "",
      DISCORD_WEBHOOKS: JSON.stringify({
        EXTRA: "https://discord.example/extra-secret",
        IT: "https://discord.example/should-not-override",
      }),
    });
    expect(keys).toEqual(["IT", "EXTRA"]);
    expect(JSON.stringify(keys)).not.toContain("secret");
    expect(
      resolveWebhookUrl(
        {
          DISCORD_WEBHOOK_URL_IT: SECRET,
          DISCORD_WEBHOOKS: JSON.stringify({
            IT: "https://discord.example/should-not-override",
          }),
        },
        "IT",
      ),
    ).toBe(SECRET);
  });

  it("ignores a broken webhook secret without dropping built-in keys", () => {
    expect(
      listWebhookKeys({
        DISCORD_WEBHOOK_URL_IT: SECRET,
        DISCORD_WEBHOOK_URL_SCIENCE: "https://discord.example/science-secret",
        DISCORD_WEBHOOKS: "{",
      }),
    ).toEqual(["IT", "SCIENCE"]);
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

  it("skips disabled feeds and feeds with an unknown webhook key", async () => {
    const bucket = memoryKv();
    const env = envFor(bucket);
    await updateFeed(env, { id: "wired-japan", enabled: false });
    const targets = await getEnabledFeedTargets(env);
    expect(targets.map((target) => target.postTitle)).toEqual(["はてブ IT"]);
    expect(targets[0]?.discordWebhookUrl).toBe(SECRET);
  });
});
