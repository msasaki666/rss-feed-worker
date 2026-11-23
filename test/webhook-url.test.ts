import { describe, expect, it } from "vitest";
import { validateWebhookUrl } from "../src/webhook-url";

const ok = "https://discord.com/api/webhooks/42/abcdefghij";

describe("validateWebhookUrl", () => {
  it("accepts discord.com, discordapp.com, ptb, and canary", () => {
    for (const url of [
      ok,
      "https://discordapp.com/api/webhooks/42/abcdefghij",
      "https://ptb.discord.com/api/webhooks/42/abcdefghij",
      "https://canary.discordapp.com/api/webhooks/42/abcdefghij/",
    ]) {
      const result = validateWebhookUrl(url);
      expect(result.ok, url).toBe(true);
    }
  });

  it("rejects other hosts, schemes, and paths", () => {
    for (const url of [
      "http://discord.com/api/webhooks/42/abcdefghij",
      "https://evil.com/api/webhooks/42/abcdefghij",
      "https://discord.com.evil.com/api/webhooks/42/abcdefghij",
      "https://discord.example/super-secret-webhook",
      "https://user:pass@discord.com/api/webhooks/42/abcdefghij",
      "https://discord.com/api/webhooks/42/abcdefghij?wait=true",
      "https://discord.com/api/webhooks/not-a-number/abcdefghij",
      "https://discord.com/api/channels/42/abcdefghij",
    ]) {
      expect(validateWebhookUrl(url).ok, url).toBe(false);
    }
  });
});
