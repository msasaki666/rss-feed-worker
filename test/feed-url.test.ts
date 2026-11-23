import { describe, expect, it } from "vitest";
import { validateFeedUrl } from "../src/feed-url";

describe("validateFeedUrl", () => {
  it("accepts a public https URL", () => {
    expect(validateFeedUrl("https://b.hatena.ne.jp/hotentry/it.rss")).toEqual({
      ok: true,
      url: "https://b.hatena.ne.jp/hotentry/it.rss",
    });
  });

  it("rejects non-https, credentials, localhost, and IP literals", () => {
    const rejected = [
      "http://example.com/rss",
      "https://user:pass@example.com/rss",
      "https://localhost/rss",
      "https://news.localhost/rss",
      "https://printer.local/rss",
      "https://127.0.0.1/rss",
      "https://10.1.2.3/rss",
      "https://192.168.0.1/rss",
      "https://172.16.0.1/rss",
      "https://8.8.8.8/rss",
      "https://[::1]/rss",
      "https://0x7f000001/rss",
    ];
    for (const value of rejected) {
      const result = validateFeedUrl(value);
      expect(result.ok, value).toBe(false);
    }
  });
});
