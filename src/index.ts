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
import { processFeed } from "./feed-processor";
import { getEnabledFeedTargets } from "./feed-store";
import { handleMcpRequest } from "./mcp";

export { processFeed };

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
  _ctx: ExecutionContext,
): Promise<void> => {
  try {
    await Promise.all(
      (await getEnabledFeedTargets(env)).map(async (target) => {
        await processFeed(target, env);
      }),
    );
  } catch (error) {
    return console.error(error);
  }
  console.log(`trigger fired at ${event.cron}`);
};

type WorkerRequest = Request<unknown, IncomingRequestCfProperties<unknown>>;

const routeFetch = (
  legacy: (req: WorkerRequest) => Promise<Response> | Response,
) => {
  return async (
    req: WorkerRequest,
    requestEnv: Env,
    ctx: ExecutionContext,
  ): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname === "/mcp") {
      return handleMcpRequest(req, requestEnv, ctx);
    }
    return legacy(req);
  };
};

const exportable: ExportedHandler<Env> =
  env.ENABLE_HTTP_REQUEST === "true"
    ? {
        fetch: routeFetch(handleFetch),
        scheduled: handleScheduled,
      }
    : {
        fetch: routeFetch(async () => {
          return new Response("", { status: 200, statusText: "OK" });
        }),
        scheduled: handleScheduled,
      };

export default exportable;
