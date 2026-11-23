import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  env: { ENABLE_HTTP_REQUEST: "true" },
}));

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const env = {
  RSS_FEED_WORKER_KV: {},
  DISCORD_WEBHOOK_URL_IT: "",
  DISCORD_WEBHOOK_URL_SCIENCE: "",
  DISCORD_WEBHOOK_URL_NOTEBOOKLM: "",
  ENABLE_HTTP_REQUEST: "true",
  ACCESS_TEAM_DOMAIN: "",
  ACCESS_AUD: "",
  MCP_ALLOW_UNAUTHENTICATED: "true",
} as unknown as Env;

describe("ENABLE_HTTP_REQUEST", () => {
  it("keeps the scheduled-handler hint and still serves /mcp", async () => {
    const worker = (await import("../src/index")).default;
    if (!worker.fetch) {
      throw new Error("fetch handler is missing");
    }

    const hint = await worker.fetch(new Request("http://localhost/"), env, ctx);
    expect(hint.status).toBe(200);
    const hintBody = await hint.text();
    expect(hintBody).toContain("--test-scheduled");
    expect(hintBody).toContain("/__scheduled");

    const mcp = await worker.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          host: "localhost",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      }),
      env,
      ctx,
    );
    expect(mcp.status).toBe(200);
    const raw = await mcp.text();
    const dataLine = raw.split("\n").find((line) => line.startsWith("data:"));
    const payload = dataLine?.slice(5).trim() ?? raw;
    const body = JSON.parse(payload) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(body.result.tools.map((tool) => tool.name)).toContain("list_feeds");
  });
});
