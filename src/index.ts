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
import { type Feed, parseFeed } from "htmlparser2";
import pRetry, { AbortError, type FailedAttemptError } from "p-retry";

class DiscordRateLimitExceededError extends Error {
  retryAfter: number;
  global: boolean;
  code?: number | undefined;

  constructor(
    message: string,
    retryAfter: number,
    global: boolean,
    code?: number,
  ) {
    super(message);
    this.name = "DiscordRateLimitExceededError";
    Object.setPrototypeOf(this, new.target.prototype);

    this.retryAfter = retryAfter;
    this.global = global;
    this.code = code;
  }
}

interface DiscordRateLimitExceededErrorBody {
  message: string;
  retry_after: number;
  global: boolean;
  code?: number;
}

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

const handleScheduled = async (
  event: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> => {
  // A Cron Trigger can make requests to other endpoints on the Internet,
  // publish to a Queue, query a D1 Database, and much more.
  //
  // We'll keep it simple and make an API call to a Cloudflare API:
  const res = await fetch("https://b.hatena.ne.jp/hotentry/it.rss");
  const body = await res.text();
  if (!res.ok) {
    return console.log({ status: res.status, body });
  }
  const nullableFeed = parseFeed(body);
  if (!nullableFeed) {
    return console.log("feed is null");
  }
  const feed = nullableFeed as Feed;

  console.log({
    title: feed.title,
    link: feed.link,
    description: feed.description,
    updated: feed.updated,
    author: feed.author,
    items: feed.items.length,
    type: feed.type,
  });
  const extractedItems = await Promise.all(
    feed.items
      .filter((item) => {
        return item.link && item.title;
      })
      .map(async (item) => {
        const link = item.link as string;
        const normalizedLink = new URL(link).toString();
        const encodedLink = new TextEncoder().encode(normalizedLink);
        const buffer = await crypto.subtle.digest("SHA-256", encodedLink);
        const linkHash = Array.from(new Uint8Array(buffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        return {
          id: item.id,
          title: item.title,
          link,
          linkHash,
        };
      }),
  );

  const map = await env.RSS_FEED_WORKER_KV.get(
    extractedItems.map((item) => {
      return item.linkHash;
    }),
  );

  const existingKeys = Array.from(map)
    .filter((kv) => {
      return kv[1] === null;
    })
    .map(([key]) => key[0]) as string[];
  console.log(`existingKeys(): ${existingKeys}`);

  const newItems = extractedItems.filter((item) => {
    return !existingKeys.includes(item.linkHash);
  });

  console.log(`newItems: ${newItems.map((item) => item.linkHash)}`);

  const discordWebhookUrl = env.DISCORD_WEBHOOK_URL;

  for (const item of newItems) {
    const requestDiscordWebhook = async () => {
      const res = await fetch(discordWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: [`**${item.title}**`, item.link]
            .filter(Boolean)
            .join("\n\n"),
        }),
      });

      // Abort retrying if the resource doesn't exist
      if (res.status === 404) {
        throw new AbortError(res.statusText);
      }
      if (res.status === 429) {
        const body = await res.json<DiscordRateLimitExceededErrorBody>();

        throw new DiscordRateLimitExceededError(
          body.message,
          body.retry_after,
          body.global,
          body.code,
        );
      }
      return res;
    };

    const shouldRetry = (error: FailedAttemptError) => {
      if (error instanceof DiscordRateLimitExceededError) {
        console.log(
          `Discord rate limit exceeded. Retrying after ${error.retryAfter}s...`,
        );
        setTimeout(() => {
          console.log("Retrying...");
        }, error.retryAfter * 1000);
        return true;
      }
      return false;
    };

    const webhookResult = await pRetry(requestDiscordWebhook, {
      retries: 3,
      shouldRetry,
    });

    if (!webhookResult.ok) {
      return console.log({
        status: webhookResult.status,
        body: await webhookResult.text(),
      });
    }

    console.log(`Successfully sent message to Discord: ${item.title}`);
    try {
      await env.RSS_FEED_WORKER_KV.put(
        item.linkHash,
        JSON.stringify({
          title: item.title,
          link: item.link,
        }),
      );
    } catch (error) {
      console.error("Error storing item in KV:", error);
    }
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
          req: Request<unknown, IncomingRequestCfProperties<unknown>>,
        ) => {
          return new Response("", { status: 200, statusText: "OK" });
        },
        scheduled: handleScheduled,
      };

export default exportable;
