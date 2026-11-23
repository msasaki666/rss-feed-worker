import { describe, expect, it } from "vitest";
import {
  ensureWebhookMigration,
  listWebhookKeys,
  resolveWebhookUrl,
  WEBHOOK_MIGRATION_KEY,
  WEBHOOKS_KEY,
} from "../src/feed-store";
import { memoryKv } from "./memory-kv";
import { IT_WEBHOOK_URL, SCIENCE_WEBHOOK_URL } from "./webhook-fixtures";

const envFor = (bucket: ReturnType<typeof memoryKv>) => {
  return {
    RSS_FEED_WORKER_KV: bucket.kv,
    DISCORD_WEBHOOK_URL_IT: IT_WEBHOOK_URL,
    DISCORD_WEBHOOK_URL_SCIENCE: "not-a-discord-webhook",
  } as unknown as Env;
};

describe("legacy webhook migration", () => {
  it("copies a valid secret once and then ignores later secret changes", async () => {
    const bucket = memoryKv();
    const env = envFor(bucket);
    let currentSecret = IT_WEBHOOK_URL;
    let secretReads = 0;
    Object.defineProperty(env, "DISCORD_WEBHOOK_URL_IT", {
      configurable: true,
      get() {
        secretReads += 1;
        return currentSecret;
      },
      set(value: string) {
        currentSecret = value;
      },
    });

    await Promise.all([
      ensureWebhookMigration(env),
      ensureWebhookMigration(env),
    ]);

    expect(await resolveWebhookUrl(env, "IT")).toBe(IT_WEBHOOK_URL);
    expect(await resolveWebhookUrl(env, "SCIENCE")).toBeUndefined();
    expect(bucket.store.get(WEBHOOK_MIGRATION_KEY)).toBe("1");
    const stored = JSON.parse(bucket.store.get(WEBHOOKS_KEY) ?? "{}") as Record<
      string,
      string
    >;
    expect(stored.IT).toBe(IT_WEBHOOK_URL);
    expect(stored.SCIENCE).toBeUndefined();
    const listed = JSON.stringify(await listWebhookKeys(env));
    expect(listed).not.toContain("TestItWebhookTokenAAAA");
    expect(listed).not.toContain("/api/webhooks/111111111111111111");
    expect(listed).toContain("AAAA");

    const readsAfterMarker = secretReads;
    env.DISCORD_WEBHOOK_URL_IT =
      "https://discord.com/api/webhooks/333333333333333333/ChangedAfterMigrationCCCC";
    expect(await resolveWebhookUrl(env, "IT")).toBe(IT_WEBHOOK_URL);
    expect(secretReads).toBe(readsAfterMarker);
    expect(JSON.stringify(await listWebhookKeys(env))).not.toContain(
      "ChangedAfterMigrationCCCC",
    );
  });

  it("skips a missing science secret without failing", async () => {
    const bucket = memoryKv();
    const env = {
      RSS_FEED_WORKER_KV: bucket.kv,
      DISCORD_WEBHOOK_URL_IT: IT_WEBHOOK_URL,
      DISCORD_WEBHOOK_URL_SCIENCE: "",
    } as unknown as Env;
    await ensureWebhookMigration(env);
    expect(await resolveWebhookUrl(env, "SCIENCE")).toBeUndefined();
    expect((await listWebhookKeys(env)).map((item) => item.name)).toEqual([
      "IT",
    ]);
  });

  it("does not migrate again when the marker already exists", async () => {
    const bucket = memoryKv();
    bucket.store.set(WEBHOOK_MIGRATION_KEY, "1");
    bucket.store.set(WEBHOOKS_KEY, JSON.stringify({ IT: SCIENCE_WEBHOOK_URL }));
    const env = envFor(bucket);
    await ensureWebhookMigration(env);
    expect(await resolveWebhookUrl(env, "IT")).toBe(SCIENCE_WEBHOOK_URL);
    expect(bucket.store.get(WEBHOOKS_KEY)).toBe(
      JSON.stringify({ IT: SCIENCE_WEBHOOK_URL }),
    );
  });
});
