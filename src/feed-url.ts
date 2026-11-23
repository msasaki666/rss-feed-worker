export type UrlCheck =
  | { ok: true; url: string }
  | { ok: false; message: string };

const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const isIpv4Literal = (hostname: string): boolean => {
  return ipv4.test(hostname);
};

const isIpv6Literal = (hostname: string): boolean => {
  return hostname.startsWith("[") || hostname.includes(":");
};

const isLocalHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  );
};

export const validateFeedUrl = (value: string): UrlCheck => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, message: "rssUrl を URL として解釈できません。" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, message: "rssUrl は https だけ使えます。" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, message: "認証情報付きの URL は使えません。" };
  }
  const hostname = url.hostname;
  if (hostname === "") {
    return { ok: false, message: "rssUrl のホスト名が空です。" };
  }
  if (
    isLocalHostname(hostname) ||
    isIpv4Literal(hostname) ||
    isIpv6Literal(hostname)
  ) {
    return {
      ok: false,
      message: "rssUrl に localhost、.local、IP アドレスそのものは使えません。",
    };
  }
  if (url.toString().length > 2048) {
    return { ok: false, message: "rssUrl が長すぎます。" };
  }
  return { ok: true, url: url.toString() };
};
