import { sendDiscordWebhook } from "./discord";
import type { FeedTarget } from "./feeds";
import {
  type ExtractedItem,
  extractItems,
  fetchFeed,
  parseFeedSafely,
} from "./rss";

export type LoadFeedResult =
  | { ok: true; items: ExtractedItem[] }
  | { ok: false; status: "fetch_failed"; httpStatus: number }
  | { ok: false; status: "parse_failed" };

export const loadFeedItems = async (
  url: string,
  sourceName: string,
): Promise<LoadFeedResult> => {
  const res = await fetchFeed(url);
  const body = await res.text();
  if (!res.ok) {
    console.log({ target: sourceName, status: res.status, body });
    return { ok: false, status: "fetch_failed", httpStatus: res.status };
  }

  const feed = parseFeedSafely(body, sourceName);
  if (!feed) {
    return { ok: false, status: "parse_failed" };
  }

  return { ok: true, items: await extractItems(feed) };
};

export interface FeedItemSummary {
  title: string;
  link: string;
  linkHash: string;
}

export interface ProcessFeedResult {
  postTitle: string;
  status: "ok" | "fetch_failed" | "parse_failed" | "no_new_items";
  httpStatus?: number;
  totalItems: number;
  newItemCount: number;
  published: FeedItemSummary[];
  failed: FeedItemSummary[];
}

const emptyResult = (
  postTitle: string,
  status: ProcessFeedResult["status"],
  extra: Partial<ProcessFeedResult> = {},
): ProcessFeedResult => {
  return {
    postTitle,
    status,
    totalItems: 0,
    newItemCount: 0,
    published: [],
    failed: [],
    ...extra,
  };
};

export const partitionUnseen = async (
  items: ExtractedItem[],
  kv: Env["RSS_FEED_WORKER_KV"],
): Promise<{ existingKeys: string[]; unseen: ExtractedItem[] }> => {
  const map = await kv.get(
    items.map((item) => {
      return item.linkHash;
    }),
  );
  const existingKeys = Array.from(map)
    .filter((entry) => {
      return entry[1] !== null;
    })
    .map((entry) => {
      return entry[0];
    });
  const unseen = items.filter((item) => {
    return !existingKeys.includes(item.linkHash);
  });
  return { existingKeys, unseen };
};

export const processFeed = async (
  target: FeedTarget,
  env: Env,
): Promise<ProcessFeedResult> => {
  const loaded = await loadFeedItems(target.rssUrl, target.postTitle);
  if (!loaded.ok) {
    return emptyResult(target.postTitle, loaded.status, {
      httpStatus:
        loaded.status === "fetch_failed" ? loaded.httpStatus : undefined,
    });
  }

  const { existingKeys, unseen } = await partitionUnseen(
    loaded.items,
    env.RSS_FEED_WORKER_KV,
  );
  console.log(`existingKeys(): ${existingKeys}`);
  console.log(`newItems: ${unseen.map((item) => item.linkHash)}`);

  if (unseen.length === 0) {
    return emptyResult(target.postTitle, "no_new_items", {
      totalItems: loaded.items.length,
    });
  }

  const listContent = unseen.map((item) => item.link).join("\n");
  if (env.DISCORD_WEBHOOK_URL_NOTEBOOKLM) {
    const listWebhookResult = await sendDiscordWebhook(
      env.DISCORD_WEBHOOK_URL_NOTEBOOKLM,
      listContent,
    );
    if (!listWebhookResult.ok) {
      console.log({
        status: listWebhookResult.status,
        body: await listWebhookResult.text(),
      });
    }
  }

  const published: FeedItemSummary[] = [];
  const failed: FeedItemSummary[] = [];
  for (const item of unseen) {
    const content = [`**${target.postTitle} | ${item.title}**`, item.link]
      .filter(Boolean)
      .join("\n\n");

    const webhookResult = await sendDiscordWebhook(
      target.discordWebhookUrl,
      content,
    );
    const summary = {
      title: item.title,
      link: item.link,
      linkHash: item.linkHash,
    };

    if (!webhookResult.ok) {
      console.log({
        status: webhookResult.status,
        body: await webhookResult.text(),
      });
      failed.push(summary);
      continue;
    }

    console.log(`Successfully sent message to Discord: ${item.title}`);
    try {
      await env.RSS_FEED_WORKER_KV.put(
        item.linkHash,
        JSON.stringify({
          title: item.title,
          link: item.link,
        }),
        {
          expirationTtl: 60 * 60 * 24 * 10, // 10日。保存容量の上限を越えないようにするため。
        },
      );
    } catch (error) {
      console.error("Error storing item in KV:", error);
    }
    published.push(summary);
  }

  return {
    postTitle: target.postTitle,
    status: "ok",
    totalItems: loaded.items.length,
    newItemCount: unseen.length,
    published,
    failed,
  };
};
