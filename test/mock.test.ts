import { describe, expect, it, vi } from "vitest";
import { mockRequestDiscordWebhook } from "../src/mock";

// Unit test for mockRequestDiscordWebhook

describe("mockRequestDiscordWebhook", () => {
  it("returns a function that posts to Discord", async () => {
    const item = { title: "Example", linkHash: "abc123" };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const send = await mockRequestDiscordWebhook(item);
    const response = send();

    expect(logSpy).toHaveBeenCalledWith(
      `Sending message to Discord: ${item.title} - ${item.linkHash}`,
    );
    expect(response instanceof Response).toBe(true);
    await expect(response.json()).resolves.toEqual({ test: true });

    logSpy.mockRestore();
  });
});
