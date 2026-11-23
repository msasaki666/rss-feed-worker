import { loadFeedItems, SEEN_TTL_SECONDS } from "./feed-processor";
import { validateFeedUrl } from "./feed-url";
import type { FeedTarget } from "./feeds";

export const CATALOG_KEY = "feed:v1:catalog";

const WEBHOOK_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FEED_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export interface StoredFeed {
  id: string;
  postTitle: string;
  rssUrl: string;
  webhookKey: string;
  enabled: boolean;
}

export interface PublicFeed {
  id: string;
  postTitle: string;
  rssUrl: string;
  webhookKey: string;
  enabled: boolean;
}

export interface FeedMutation {
  ok: true;
  feed: PublicFeed;
  marked: number;
}

export interface FeedMutationError {
  ok: false;
  message: string;
}

type WebhookEnv = {
  DISCORD_WEBHOOK_URL_IT?: string;
  DISCORD_WEBHOOK_URL_SCIENCE?: string;
  DISCORD_WEBHOOKS?: string;
};

type FeedWriteEnv = WebhookEnv & {
  RSS_FEED_WORKER_KV: Env["RSS_FEED_WORKER_KV"];
};

const nonempty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
};

export const defaultCatalog = (): StoredFeed[] => {
  return [
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
  ];
};

export const toPublicFeed = (feed: StoredFeed): PublicFeed => {
  return {
    id: feed.id,
    postTitle: feed.postTitle,
    rssUrl: feed.rssUrl,
    webhookKey: feed.webhookKey,
    enabled: feed.enabled,
  };
};

const extraWebhooks = (env: WebhookEnv): Record<string, string> => {
  const raw = env.DISCORD_WEBHOOKS?.trim() ?? "";
  if (raw.length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("DISCORD_WEBHOOKS is not valid JSON");
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error("DISCORD_WEBHOOKS must be a JSON object");
    return {};
  }
  const webhooks: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!WEBHOOK_KEY.test(key) || typeof value !== "string") {
      continue;
    }
    const url = value.trim();
    if (!url.startsWith("https://")) {
      continue;
    }
    webhooks[key] = url;
  }
  return webhooks;
};

export const listWebhookKeys = (env: WebhookEnv): string[] => {
  const keys: string[] = [];
  if (nonempty(env.DISCORD_WEBHOOK_URL_IT)) {
    keys.push("IT");
  }
  if (nonempty(env.DISCORD_WEBHOOK_URL_SCIENCE)) {
    keys.push("SCIENCE");
  }
  for (const key of Object.keys(extraWebhooks(env))) {
    if (!keys.includes(key)) {
      keys.push(key);
    }
  }
  return keys;
};

export const resolveWebhookUrl = (
  env: WebhookEnv,
  webhookKey: string,
): string | undefined => {
  if (webhookKey === "IT") {
    return nonempty(env.DISCORD_WEBHOOK_URL_IT);
  }
  if (webhookKey === "SCIENCE") {
    return nonempty(env.DISCORD_WEBHOOK_URL_SCIENCE);
  }
  return nonempty(extraWebhooks(env)[webhookKey]);
};

const asStoredFeed = (value: unknown): StoredFeed | null => {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.postTitle !== "string" ||
    typeof record.rssUrl !== "string" ||
    typeof record.webhookKey !== "string" ||
    typeof record.enabled !== "boolean"
  ) {
    return null;
  }
  return {
    id: record.id,
    postTitle: record.postTitle,
    rssUrl: record.rssUrl,
    webhookKey: record.webhookKey,
    enabled: record.enabled,
  };
};

const readCatalog = (raw: string): StoredFeed[] => {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("feed catalog is not an array");
  }
  const feeds: StoredFeed[] = [];
  for (const item of parsed) {
    const feed = asStoredFeed(item);
    if (!feed) {
      throw new Error("feed catalog contains an invalid record");
    }
    feeds.push(feed);
  }
  return feeds;
};

const writeCatalog = async (
  env: FeedWriteEnv,
  feeds: StoredFeed[],
): Promise<void> => {
  await env.RSS_FEED_WORKER_KV.put(CATALOG_KEY, JSON.stringify(feeds));
};

export const loadCatalog = async (env: FeedWriteEnv): Promise<StoredFeed[]> => {
  const raw = await env.RSS_FEED_WORKER_KV.get(CATALOG_KEY);
  if (raw === null) {
    const seeded = defaultCatalog();
    await writeCatalog(env, seeded);
    return seeded;
  }
  return readCatalog(raw);
};

export const getEnabledFeedTargets = async (
  env: FeedWriteEnv,
): Promise<FeedTarget[]> => {
  const feeds = await loadCatalog(env);
  const targets: FeedTarget[] = [];
  for (const feed of feeds) {
    if (!feed.enabled) {
      continue;
    }
    const discordWebhookUrl = resolveWebhookUrl(env, feed.webhookKey);
    if (!discordWebhookUrl) {
      console.error(`Missing webhook for feed ${feed.id} (${feed.webhookKey})`);
      continue;
    }
    targets.push({
      postTitle: feed.postTitle,
      rssUrl: feed.rssUrl,
      discordWebhookUrl,
    });
  }
  return targets;
};

const normalizeTitle = (value: string): string | null => {
  const title = value.trim();
  if (title.length === 0 || title.length > 80 || /[\r\n]/.test(title)) {
    return null;
  }
  return title;
};

const newFeedId = (): string => {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `f${Array.from(bytes, (byte) => {
    return byte.toString(16).padStart(2, "0");
  }).join("")}`;
};

const markSeen = async (
  env: FeedWriteEnv,
  items: Array<{ title: string; link: string; linkHash: string }>,
): Promise<number> => {
  for (const item of items) {
    await env.RSS_FEED_WORKER_KV.put(
      item.linkHash,
      JSON.stringify({ title: item.title, link: item.link }),
      { expirationTtl: SEEN_TTL_SECONDS },
    );
  }
  return items.length;
};

const loadParsedFeed = async (rssUrl: string, postTitle: string) => {
  try {
    const loaded = await loadFeedItems(rssUrl, postTitle);
    if (!loaded.ok) {
      const detail =
        loaded.status === "fetch_failed"
          ? `HTTP ${loaded.httpStatus}`
          : "RSS として解釈できない";
      return {
        ok: false as const,
        message: `${postTitle} を確認できませんでした (${detail})。保存していません。`,
      };
    }
    return { ok: true as const, items: loaded.items };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      ok: false as const,
      message: `${postTitle} を確認できませんでした (${message})。保存していません。`,
    };
  }
};

export interface AddFeedInput {
  id?: string;
  postTitle: string;
  rssUrl: string;
  webhookKey: string;
  enabled?: boolean;
  markCurrentAsSeen?: boolean;
}

export const addFeed = async (
  env: FeedWriteEnv,
  input: AddFeedInput,
): Promise<FeedMutation | FeedMutationError> => {
  const postTitle = normalizeTitle(input.postTitle);
  if (!postTitle) {
    return {
      ok: false,
      message: "postTitle は 1〜80 文字で、改行は使えません。",
    };
  }
  const checked = validateFeedUrl(input.rssUrl);
  if (!checked.ok) {
    return checked;
  }
  const webhookKey = input.webhookKey.trim();
  if (!WEBHOOK_KEY.test(webhookKey) || !resolveWebhookUrl(env, webhookKey)) {
    return {
      ok: false,
      message: `webhookKey「${webhookKey}」は設定されていません。list_webhook_keys を確認してください。`,
    };
  }
  const feeds = await loadCatalog(env);
  let id = input.id?.trim() ?? "";
  if (id.length === 0) {
    do {
      id = newFeedId();
    } while (
      feeds.some((feed) => {
        return feed.id === id;
      })
    );
  } else if (!FEED_ID.test(id)) {
    return {
      ok: false,
      message: "id は小文字、数字、ハイフンだけです。",
    };
  }
  if (
    feeds.some((feed) => {
      return feed.id === id;
    })
  ) {
    return { ok: false, message: `id「${id}」は既にあります。` };
  }
  const loaded = await loadParsedFeed(checked.url, postTitle);
  if (!loaded.ok) {
    return loaded;
  }
  const feed: StoredFeed = {
    id,
    postTitle,
    rssUrl: checked.url,
    webhookKey,
    enabled: input.enabled ?? true,
  };
  feeds.push(feed);
  await writeCatalog(env, feeds);
  const marked =
    (input.markCurrentAsSeen ?? true) ? await markSeen(env, loaded.items) : 0;
  return { ok: true, feed: toPublicFeed(feed), marked };
};

export interface UpdateFeedInput {
  id: string;
  postTitle?: string;
  rssUrl?: string;
  webhookKey?: string;
  enabled?: boolean;
  markCurrentAsSeen?: boolean;
}

export const updateFeed = async (
  env: FeedWriteEnv,
  input: UpdateFeedInput,
): Promise<FeedMutation | FeedMutationError> => {
  const feeds = await loadCatalog(env);
  const index = feeds.findIndex((feed) => {
    return feed.id === input.id;
  });
  if (index < 0) {
    return { ok: false, message: `id「${input.id}」のフィードはありません。` };
  }
  const current = feeds[index] as StoredFeed;
  let postTitle = current.postTitle;
  if (input.postTitle !== undefined) {
    const normalized = normalizeTitle(input.postTitle);
    if (!normalized) {
      return {
        ok: false,
        message: "postTitle は 1〜80 文字で、改行は使えません。",
      };
    }
    postTitle = normalized;
  }
  let webhookKey = current.webhookKey;
  if (input.webhookKey !== undefined) {
    webhookKey = input.webhookKey.trim();
    if (!WEBHOOK_KEY.test(webhookKey) || !resolveWebhookUrl(env, webhookKey)) {
      return {
        ok: false,
        message: `webhookKey「${webhookKey}」は設定されていません。list_webhook_keys を確認してください。`,
      };
    }
  }
  let rssUrl = current.rssUrl;
  let loadedItems: Array<{ title: string; link: string; linkHash: string }> =
    [];
  const urlChanged =
    input.rssUrl !== undefined && input.rssUrl.trim() !== current.rssUrl;
  if (urlChanged) {
    const checked = validateFeedUrl(input.rssUrl ?? "");
    if (!checked.ok) {
      return checked;
    }
    const loaded = await loadParsedFeed(checked.url, postTitle);
    if (!loaded.ok) {
      return loaded;
    }
    rssUrl = checked.url;
    loadedItems = loaded.items;
  }
  const next: StoredFeed = {
    id: current.id,
    postTitle,
    rssUrl,
    webhookKey,
    enabled: input.enabled ?? current.enabled,
  };
  feeds[index] = next;
  await writeCatalog(env, feeds);
  const shouldMark = urlChanged && (input.markCurrentAsSeen ?? true);
  const marked = shouldMark ? await markSeen(env, loadedItems) : 0;
  return { ok: true, feed: toPublicFeed(next), marked };
};

export const removeFeed = async (
  env: FeedWriteEnv,
  id: string,
): Promise<{ ok: true; id: string } | FeedMutationError> => {
  const feeds = await loadCatalog(env);
  const next = feeds.filter((feed) => {
    return feed.id !== id;
  });
  if (next.length === feeds.length) {
    return { ok: false, message: `id「${id}」のフィードはありません。` };
  }
  await writeCatalog(env, next);
  return { ok: true, id };
};
