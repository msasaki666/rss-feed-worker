import { describe, expect, it, vi } from "vitest";
import { sendDiscordWebhook } from "./discord";

describe("sendDiscordWebhook", () => {
  it("retries on 429 and succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: "rate limit",
            retry_after: 0,
            global: false,
          }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const promise = sendDiscordWebhook("https://discord.example", "hi");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);

    fetchMock.mockRestore();
    vi.useRealTimers();
  });

  it("throws AbortError on 404", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, { status: 404, statusText: "Not Found" }),
      );
    await expect(
      sendDiscordWebhook("https://discord.example", "hi"),
    ).rejects.toThrow("Not Found");
    fetchMock.mockRestore();
  });
});
