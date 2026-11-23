import { type Feed, parseFeed } from "htmlparser2";
import pRetry, { AbortError } from "p-retry";
import { validateFeedUrl } from "./feed-url";

export interface ExtractedItem {
  id: string | undefined;
  title: string;
  link: string;
  linkHash: string;
}

const MAX_REDIRECTS = 3;

export const fetchFeed = async (url: string): Promise<Response> => {
  const request = async () => {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const checked = validateFeedUrl(current);
      if (!checked.ok) {
        throw new AbortError(checked.message);
      }
      const res = await fetch(checked.url, { redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location || hop === MAX_REDIRECTS) {
          throw new AbortError("リダイレクトを追跡できません。");
        }
        current = new URL(location, checked.url).toString();
        continue;
      }
      if (res.status === 404) {
        throw new AbortError(res.statusText);
      }
      return res;
    }
    throw new AbortError("リダイレクトを追跡できません。");
  };
  return pRetry(request, { retries: 3 });
};

export const parseFeedSafely = (
  body: string,
  sourceName: string,
): Feed | null => {
  const nullableFeed = parseFeed(body);
  if (!nullableFeed) {
    console.log(`${sourceName} feed parsing failed`);
    console.log(`Response body: ${body.substring(0, 500)}`);
    return null;
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
  return feed;
};

export const extractItems = async (feed: Feed): Promise<ExtractedItem[]> => {
  return Promise.all(
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
          .map((b) => {
            return b.toString(16).padStart(2, "0");
          })
          .join("");
        return {
          id: item.id,
          title: item.title as string,
          link,
          linkHash,
        };
      }),
  );
};
