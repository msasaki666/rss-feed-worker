import { createHash } from "node:crypto";
import type { Feed } from "htmlparser2";
import { describe, expect, it, vi } from "vitest";
import { extractItems, parseFeedSafely } from "../src/rss";

const sampleFeed = `<?xml version="1.0"?>
<rss><channel>
  <title>Sample</title>
  <item>
    <title>Example</title>
    <link>https://example.com/1</link>
  </item>
</channel></rss>`;

describe("parseFeedSafely", () => {
  it("returns feed for valid RSS", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const feed = parseFeedSafely(sampleFeed, "sample");
    expect(feed?.items).toHaveLength(1);
    logSpy.mockRestore();
  });

  it("returns null for invalid RSS", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const feed = parseFeedSafely("", "invalid");
    expect(feed).toBeNull();
    expect(logSpy).toHaveBeenCalledWith("invalid feed parsing failed");
    logSpy.mockRestore();
  });
});

describe("extractItems", () => {
  it("filters items without title or link and hashes link", async () => {
    const feed = {
      items: [
        { title: "Valid", link: "https://example.com/1" },
        { title: "Missing link" },
        { link: "https://example.com/2" },
      ],
    } as unknown as Feed;

    const items = await extractItems(feed);
    expect(items).toHaveLength(1);
    const normalized = new URL("https://example.com/1").toString();
    const expectedHash = createHash("sha256").update(normalized).digest("hex");
    expect(items[0]).toEqual({
      id: undefined,
      title: "Valid",
      link: "https://example.com/1",
      linkHash: expectedHash,
    });
  });
});
