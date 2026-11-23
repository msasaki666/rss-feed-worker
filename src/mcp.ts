import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { authorizeMcpRequest } from "./access";
import { loadFeedItems, partitionUnseen, processFeed } from "./feed-processor";
import { getFeedTargets, toPublicFeed } from "./feeds";
import type { ExtractedItem } from "./rss";

const SERVER_INSTRUCTIONS = [
  "設定済み RSS フィードの確認と、未読記事の Discord 通知に使う。",
  "Webhook URL やその他の秘密は返さない。任意の URL は取得できない。",
  "先に list_feeds で postTitle を確認する。",
  "preview_feed と list_unseen_items は読み取り専用で、既読にはしない。",
  "publish_new_items は Discord に投稿し、投稿できた記事を 10 日間既読として保存する。",
].join("\n");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const feedNameSchema = z
  .string()
  .describe("list_feeds が返す postTitle。例: はてブ IT");

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

const errorResult = (message: string) => {
  return {
    isError: true as const,
    content: textContent(message),
  };
};

const jsonResult = (value: Record<string, unknown>) => {
  return {
    content: textContent(JSON.stringify(value, null, 2)),
    structuredContent: value,
  };
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

const findTarget = (env: Env, feed: string) => {
  const name = feed.trim();
  const targets = getFeedTargets(env);
  const target = targets.find((item) => {
    return item.postTitle === name;
  });
  if (target) {
    return { target, targets };
  }
  const names = targets
    .map((item) => {
      return item.postTitle;
    })
    .join(", ");
  return {
    target: undefined,
    targets,
    message: `未知のフィード「${name}」です。使える postTitle: ${names}`,
  };
};

const readFeed = async (env: Env, feed: string, limit: number | undefined) => {
  const found = findTarget(env, feed);
  if (!found.target) {
    return errorResult(found.message ?? "未知のフィードです。");
  }
  try {
    const loaded = await loadFeedItems(
      found.target.rssUrl,
      found.target.postTitle,
    );
    if (!loaded.ok) {
      return errorResult(
        loaded.status === "fetch_failed"
          ? `${found.target.postTitle} の取得に失敗しました (HTTP ${loaded.httpStatus})。既読にはしていません。`
          : `${found.target.postTitle} の RSS を解釈できませんでした。既読にはしていません。`,
      );
    }
    return jsonResult({
      feed: toPublicFeed(found.target),
      ...pageItems(loaded.items, limit),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return errorResult(
      `${found.target.postTitle} の取得に失敗しました: ${message}`,
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
        "監視対象の RSS フィード名と URL を返す。Discord Webhook は含まない。ネットワークアクセスも既読の更新もしない。他のツールに渡す postTitle を確認するために最初に呼ぶ。",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      return jsonResult({
        feeds: getFeedTargets(env).map((target) => {
          return toPublicFeed(target);
        }),
      });
    },
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
    async ({ feed, limit }) => {
      return readFeed(env, feed, limit);
    },
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
    async ({ feed, limit }) => {
      const found = findTarget(env, feed);
      if (!found.target) {
        return errorResult(found.message ?? "未知のフィードです。");
      }
      try {
        const loaded = await loadFeedItems(
          found.target.rssUrl,
          found.target.postTitle,
        );
        if (!loaded.ok) {
          return errorResult(
            loaded.status === "fetch_failed"
              ? `${found.target.postTitle} の取得に失敗しました (HTTP ${loaded.httpStatus})。既読にはしていません。`
              : `${found.target.postTitle} の RSS を解釈できませんでした。既読にはしていません。`,
          );
        }
        const { unseen } = await partitionUnseen(
          loaded.items,
          env.RSS_FEED_WORKER_KV,
        );
        return jsonResult({
          feed: toPublicFeed(found.target),
          ...pageItems(unseen, limit),
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        return errorResult(
          `${found.target.postTitle} の未読確認に失敗しました: ${message}`,
        );
      }
    },
  );

  server.registerTool(
    "publish_new_items",
    {
      title: "新着記事を Discord に投稿",
      description:
        "Cron と同じ処理を実行する。未読記事を対象フィードの Discord Webhook に投稿し、投稿できた URL を 10 日間既読として KV に保存する。feed を省略すると設定済みフィードをすべて処理する。既に既読の記事は再投稿しない。読み取りだけなら preview_feed か list_unseen_items を使う。",
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
    async ({ feed }) => {
      if (feed !== undefined && feed.trim().length === 0) {
        return errorResult(
          "feed が空です。省略するか、list_feeds の postTitle を指定してください。",
        );
      }
      let targets = getFeedTargets(env);
      if (feed !== undefined) {
        const found = findTarget(env, feed);
        if (!found.target) {
          return errorResult(found.message ?? "未知のフィードです。");
        }
        targets = [found.target];
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
      return jsonResult({ feeds: results });
    },
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
