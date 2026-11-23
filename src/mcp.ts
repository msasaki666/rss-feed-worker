import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { authorizeMcpRequest } from "./access";
import { loadFeedItems, partitionUnseen, processFeed } from "./feed-processor";
import type { StoredFeed } from "./feed-store";
import {
  addFeed,
  getEnabledFeedTargets,
  knownWebhookSecrets,
  listWebhookKeys,
  loadCatalog,
  removeFeed,
  removeWebhook,
  resolveWebhookUrl,
  setWebhook,
  toPublicFeed,
  updateFeed,
} from "./feed-store";
import type { FeedTarget } from "./feeds";
import type { ExtractedItem } from "./rss";
import { redactText, redactValue } from "./webhook-url";

const SERVER_INSTRUCTIONS = [
  "設定済み RSS フィードの確認、登録、未読記事の Discord 通知に使う。",
  "Webhook の URL は返さない。set_webhook で登録するか、add_feed に webhookUrl を渡す。",
  "先に list_feeds と list_webhook_keys を確認する。",
  "preview_feed と list_unseen_items は読み取り専用で、既読にはしない。",
  "add_feed と、rssUrl を変える update_feed は、既定で今ある記事を投稿せず既読にする。",
  "publish_new_items は Discord に投稿し、投稿できた記事を 10 日間既読として保存する。",
].join("\n");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const feedNameSchema = z
  .string()
  .describe("list_feeds の id または postTitle。例: hatena-it、はてブ IT");

const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .optional()
  .describe(`返す件数。省略時は ${DEFAULT_LIMIT}。最大 ${MAX_LIMIT}。`);

type ToolText = {
  type: "text";
  text: string;
};

const textContent = (text: string): ToolText[] => {
  return [{ type: "text", text }];
};

const fail = async (env: Env, message: string) => {
  const text = redactText(message, await secretStrings(env));
  return {
    isError: true as const,
    content: textContent(text),
  };
};

const present = async (env: Env, value: Record<string, unknown>) => {
  const redacted = redactValue(value, await secretStrings(env)) as Record<
    string,
    unknown
  >;
  return {
    content: textContent(JSON.stringify(redacted, null, 2)),
    structuredContent: redacted,
  };
};

const secretStrings = async (env: Env): Promise<string[]> => {
  const builtIn = [
    env.DISCORD_WEBHOOK_URL_IT,
    env.DISCORD_WEBHOOK_URL_SCIENCE,
    env.DISCORD_WEBHOOK_URL_NOTEBOOKLM,
  ].filter((value): value is string => {
    return typeof value === "string" && value.length > 0;
  });
  try {
    return [...builtIn, ...(await knownWebhookSecrets(env))];
  } catch {
    return builtIn;
  }
};

const guard = async (
  env: Env,
  run: () => Promise<{
    isError?: true;
    content: ToolText[];
    structuredContent?: Record<string, unknown>;
  }>,
) => {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return fail(env, message);
  }
};

const pageItems = (items: ExtractedItem[], limit: number | undefined) => {
  const size = limit ?? DEFAULT_LIMIT;
  const page = items.slice(0, size).map((item) => {
    return {
      title: item.title,
      link: item.link,
      linkHash: item.linkHash,
    };
  });
  return {
    total: items.length,
    returned: page.length,
    truncated: items.length > page.length,
    items: page,
  };
};

const findStored = async (env: Env, feed: string) => {
  const name = feed.trim();
  const feeds = await loadCatalog(env);
  const stored = feeds.find((item) => {
    return item.id === name || item.postTitle === name;
  });
  if (stored) {
    return { stored, feeds };
  }
  const names = feeds
    .map((item) => {
      return `${item.id} (${item.postTitle})`;
    })
    .join(", ");
  return {
    stored: undefined,
    feeds,
    message: `未知のフィード「${name}」です。使えるフィード: ${names}`,
  };
};

const toProcessTarget = async (
  env: Env,
  stored: StoredFeed,
): Promise<FeedTarget | undefined> => {
  const discordWebhookUrl = await resolveWebhookUrl(env, stored.webhookKey);
  if (!discordWebhookUrl) {
    return undefined;
  }
  return {
    postTitle: stored.postTitle,
    rssUrl: stored.rssUrl,
    discordWebhookUrl,
  };
};

const readFeed = async (env: Env, feed: string, limit: number | undefined) => {
  const found = await findStored(env, feed);
  if (!found.stored) {
    return await fail(env, found.message ?? "未知のフィードです。");
  }
  try {
    const loaded = await loadFeedItems(
      found.stored.rssUrl,
      found.stored.postTitle,
    );
    if (!loaded.ok) {
      return await fail(
        env,
        loaded.status === "fetch_failed"
          ? `${found.stored.postTitle} の取得に失敗しました (HTTP ${loaded.httpStatus})。既読にはしていません。`
          : `${found.stored.postTitle} の RSS を解釈できませんでした。既読にはしていません。`,
      );
    }
    return await present(env, {
      feed: toPublicFeed(found.stored),
      ...pageItems(loaded.items, limit),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return await fail(
      env,
      `${found.stored.postTitle} の取得に失敗しました: ${message}`,
    );
  }
};

export const createRssMcpServer = (env: Env): McpServer => {
  const server = new McpServer(
    {
      name: "rss-feed-worker",
      title: "RSS Feed Worker",
      version: "1.0.0",
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "list_feeds",
    {
      title: "フィード一覧",
      description:
        "保存済みフィードの id、名前、RSS URL、webhookKey、enabled を返す。Webhook URL は含まない。既読の更新もしない。",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () =>
      guard(env, async () => {
        const feeds = await loadCatalog(env);
        return await present(env, {
          feeds: feeds.map((feed) => {
            return toPublicFeed(feed);
          }),
        });
      }),
  );

  server.registerTool(
    "list_webhook_keys",
    {
      title: "Webhook の別名一覧",
      description:
        "登録済み Webhook の名前と、トークン末尾 4 文字だけを返す。URL は返さない。",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () =>
      guard(env, async () => {
        return await present(env, { webhooks: await listWebhookKeys(env) });
      }),
  );

  server.registerTool(
    "set_webhook",
    {
      title: "Webhook を登録",
      description:
        "Discord の Webhook URL を名前で KV に保存する。URL は応答に含めない。ホストは discord.com か discordapp.com、パスは /api/webhooks/{id}/{token}。",
      inputSchema: z.object({
        name: z.string().describe("フィードの webhookKey に使う名前。"),
        webhookUrl: z.string().describe("Discord の Incoming Webhook URL。"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name, webhookUrl }) =>
      guard(env, async () => {
        const result = await setWebhook(env, name, webhookUrl);
        if (!result.ok) {
          return await fail(env, result.message);
        }
        return await present(env, { webhook: result.webhook });
      }),
  );

  server.registerTool(
    "remove_webhook",
    {
      title: "Webhook を削除",
      description:
        "KV に保存した Webhook を名前で削除する。Worker secret の IT / SCIENCE は削除できない。URL は応答に含めない。",
      inputSchema: z.object({
        name: z.string().describe("削除する Webhook の名前。"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name }) =>
      guard(env, async () => {
        const result = await removeWebhook(env, name);
        if (!result.ok) {
          return await fail(env, result.message);
        }
        return await present(env, { name: result.name });
      }),
  );

  server.registerTool(
    "add_feed",
    {
      title: "フィードを追加",
      description:
        "RSS URL が https で、取得して RSS/Atom として解釈できるときだけ保存する。投稿先は webhookKey か、Discord の webhookUrl。URL は保存するが応答には出さない。既定では現在の記事を投稿せず既読にする。",
      inputSchema: z.object({
        id: z
          .string()
          .optional()
          .describe("省略すると自動で付く。小文字、数字、ハイフン。"),
        postTitle: z.string().describe("Discord に出すフィード名。"),
        rssUrl: z.string().describe("https の RSS/Atom URL。"),
        webhookKey: z
          .string()
          .optional()
          .describe(
            "登録済みの名前、または IT / SCIENCE。webhookUrl と一緒ならその名前で保存する。",
          ),
        webhookUrl: z
          .string()
          .optional()
          .describe("Discord の Webhook URL。応答には残らない。"),
        enabled: z
          .boolean()
          .optional()
          .describe("省略時は true。false だと Cron の対象外。"),
        markCurrentAsSeen: z
          .boolean()
          .optional()
          .describe(
            "省略時は true。false だと次の投稿で現在の記事も新規になる。",
          ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) =>
      guard(env, async () => {
        const result = await addFeed(env, input);
        if (!result.ok) {
          return await fail(env, result.message);
        }
        return await present(env, { feed: result.feed, marked: result.marked });
      }),
  );

  server.registerTool(
    "update_feed",
    {
      title: "フィードを更新",
      description:
        "id で指定したフィードの名前、RSS URL、webhookKey、enabled を変える。rssUrl を変えたときは、解釈できる場合だけ保存し、既定で新しい URL の現在の記事を投稿せず既読にする。",
      inputSchema: z.object({
        id: z.string().describe("list_feeds の id。"),
        postTitle: z.string().optional(),
        rssUrl: z.string().optional(),
        webhookKey: z.string().optional(),
        webhookUrl: z.string().optional(),
        enabled: z.boolean().optional(),
        markCurrentAsSeen: z
          .boolean()
          .optional()
          .describe("rssUrl を変えたときの既定は true。"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) =>
      guard(env, async () => {
        const result = await updateFeed(env, input);
        if (!result.ok) {
          return await fail(env, result.message);
        }
        return await present(env, { feed: result.feed, marked: result.marked });
      }),
  );

  server.registerTool(
    "remove_feed",
    {
      title: "フィードを削除",
      description:
        "id のフィード定義を消す。既読ハッシュは残るので、同じ記事 URL を別フィードで見ても再投稿しない。",
      inputSchema: z.object({
        id: z.string().describe("list_feeds の id。"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) =>
      guard(env, async () => {
        const result = await removeFeed(env, id);
        if (!result.ok) {
          return await fail(env, result.message);
        }
        return await present(env, { id: result.id });
      }),
  );

  server.registerTool(
    "preview_feed",
    {
      title: "フィードのプレビュー",
      description:
        "設定済みフィードを取得し、記事のタイトルと URL を返す。KV の既読判定も Discord への投稿もしない。新着確認や投稿の前に内容を見るときに使う。",
      inputSchema: z.object({
        feed: feedNameSchema,
        limit: limitSchema,
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ feed, limit }) =>
      guard(env, async () => {
        return readFeed(env, feed, limit);
      }),
  );

  server.registerTool(
    "list_unseen_items",
    {
      title: "未読記事の確認",
      description:
        "設定済みフィードを取得し、KV にまだ無い記事だけを返す。Discord には投稿せず、既読の保存もしない。publish_new_items の前に差分を確認するときに使う。",
      inputSchema: z.object({
        feed: feedNameSchema,
        limit: limitSchema,
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ feed, limit }) =>
      guard(env, async () => {
        const found = await findStored(env, feed);
        if (!found.stored) {
          return await fail(env, found.message ?? "未知のフィードです。");
        }
        try {
          const loaded = await loadFeedItems(
            found.stored.rssUrl,
            found.stored.postTitle,
          );
          if (!loaded.ok) {
            return await fail(
              env,
              loaded.status === "fetch_failed"
                ? `${found.stored.postTitle} の取得に失敗しました (HTTP ${loaded.httpStatus})。既読にはしていません。`
                : `${found.stored.postTitle} の RSS を解釈できませんでした。既読にはしていません。`,
            );
          }
          const { unseen } = await partitionUnseen(
            loaded.items,
            env.RSS_FEED_WORKER_KV,
          );
          return await present(env, {
            feed: toPublicFeed(found.stored),
            ...pageItems(unseen, limit),
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "unknown error";
          return await fail(
            env,
            `${found.stored.postTitle} の未読確認に失敗しました: ${message}`,
          );
        }
      }),
  );

  server.registerTool(
    "publish_new_items",
    {
      title: "新着記事を Discord に投稿",
      description:
        "Cron と同じ処理を実行する。未読記事を対象フィードの Discord Webhook に投稿し、投稿できた URL を 10 日間既読として KV に保存する。feed を省略すると有効なフィードをすべて処理する。無効なフィードは id を指定したときだけ処理する。",
      inputSchema: z.object({
        feed: feedNameSchema
          .optional()
          .describe("省略すると設定済みフィードをすべて処理する。"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ feed }) =>
      guard(env, async () => {
        if (feed !== undefined && feed.trim().length === 0) {
          return await fail(
            env,
            "feed が空です。省略するか、list_feeds の id か postTitle を指定してください。",
          );
        }
        let targets: FeedTarget[] = [];
        if (feed === undefined) {
          targets = await getEnabledFeedTargets(env);
        } else {
          const found = await findStored(env, feed);
          if (!found.stored) {
            return await fail(env, found.message ?? "未知のフィードです。");
          }
          const target = await toProcessTarget(env, found.stored);
          if (!target) {
            return await fail(
              env,
              `webhookKey「${found.stored.webhookKey}」は設定されていません。`,
            );
          }
          targets = [target];
        }

        const results = [];
        for (const target of targets) {
          try {
            const result = await processFeed(target, env);
            results.push(result);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "unknown error";
            results.push({
              postTitle: target.postTitle,
              status: "error",
              message,
            });
          }
        }
        return await present(env, { feeds: results });
      }),
  );

  return server;
};

export const handleMcpRequest = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> => {
  const denied = await authorizeMcpRequest(request, env);
  if (denied) {
    return denied;
  }
  const handler = createMcpHandler(() => createRssMcpServer(env), {
    route: "/mcp",
  });
  return handler(request, env, ctx);
};
