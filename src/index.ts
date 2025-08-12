/**
 * Welcome to Cloudflare Workers!
 *
 * This is a template for a Scheduled Worker: a Worker that can run on a
 * configurable interval:
 * https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Run `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"` to see your Worker in action
 * - Run `npm run deploy` to publish your Worker
 *
 * Bind resources to your Worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { env } from "cloudflare:workers";
import { sendDiscordWebhook } from "./discord";
import { extractItems, fetchFeed, parseFeedSafely } from "./rss";

interface TargetOption {
  postTitle: string;
  rssUrl: string;
  discordWebhookUrl: string;
}

const targetOptions: TargetOption[] = [
  {
    postTitle: "はてブ IT",
    rssUrl: "https://b.hatena.ne.jp/hotentry/it.rss",
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL_IT,
  },
  // {
  //   postTitle: "Science Portal",
  //   rssUrl: "https://scienceportal.jst.go.jp/feed/rss.xml",
  //   discordWebhookUrl: env.DISCORD_WEBHOOK_URL_SCIENCE,
  // },
  {
    postTitle: "WIRED Japan",
    rssUrl: "https://wired.jp/feed/rss",
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL_SCIENCE,
  },
];

const handleFetch = async (
  req: Request<unknown, IncomingRequestCfProperties<unknown>>,
) => {
  const url = new URL(req.url);
  url.pathname = "/__scheduled";
  url.searchParams.append("cron", "* * * * *");
  return new Response(
    `To test the scheduled handler, ensure you have used the "--test-scheduled" then try running "curl ${url.href}".`,
  );
};

const processFeed = async (target: TargetOption, env: Env): Promise<void> => {
  const res = await fetchFeed(target.rssUrl);
  const body = await res.text();
  if (!res.ok) {
    console.log({ target: target.postTitle, status: res.status, body });
    return;
  }

  const feed = parseFeedSafely(body, target.postTitle);
  if (!feed) {
    return;
  }

  const extractedItems = await extractItems(feed);
  const map = await env.RSS_FEED_WORKER_KV.get(
    extractedItems.map((item) => {
      return item.linkHash;
    }),
  );

  const existingKeys = Array.from(map)
    .filter((kv) => {
      return kv[1] !== null;
    })
    .map((kv) => kv[0]);
  console.log(`existingKeys(): ${existingKeys}`);

  const newItems = extractedItems.filter((item) => {
    return !existingKeys.includes(item.linkHash);
  });

  console.log(`newItems: ${newItems.map((item) => item.linkHash)}`);

  for (const item of newItems) {
    const content = [`**${target.postTitle} | ${item.title}**`, item.link]
      .filter(Boolean)
      .join("\n\n");

    const webhookResult = await sendDiscordWebhook(
      target.discordWebhookUrl,
      content,
    );

    if (!webhookResult.ok) {
      console.log({
        status: webhookResult.status,
        body: await webhookResult.text(),
      });
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
  }
};

const handleScheduled = async (
  event: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> => {
  try {
    await Promise.all(
      targetOptions.map(async (target) => {
        await processFeed(target, env);
      }),
    );
  } catch (error) {
    return console.error(error);
  }
  console.log(`trigger fired at ${event.cron}`);
};

const exportable: ExportedHandler<Env> =
  env.ENABLE_HTTP_REQUEST === "true"
    ? {
        fetch: handleFetch,
        scheduled: handleScheduled,
      }
    : {
        fetch: async (
          _req: Request<unknown, IncomingRequestCfProperties<unknown>>,
        ) => {
          return new Response("", { status: 200, statusText: "OK" });
        },
        scheduled: handleScheduled,
      };

export default exportable;
