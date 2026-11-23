export type WebhookCheck =
  | { ok: true; url: string; hint: string }
  | { ok: false; message: string };

const HOSTS = new Set([
  "discord.com",
  "discordapp.com",
  "ptb.discord.com",
  "ptb.discordapp.com",
  "canary.discord.com",
  "canary.discordapp.com",
]);

const WEBHOOK_PATH = /^\/api\/webhooks\/(\d+)\/([A-Za-z0-9_-]{8,})\/?$/;

export const validateWebhookUrl = (value: string): WebhookCheck => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, message: "Webhook URL を解釈できません。" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, message: "Webhook URL は https だけ使えます。" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, message: "認証情報付きの Webhook URL は使えません。" };
  }
  if (url.search !== "" || url.hash !== "") {
    return {
      ok: false,
      message: "Webhook URL にクエリやフラグメントは使えません。",
    };
  }
  if (!HOSTS.has(url.hostname)) {
    return {
      ok: false,
      message: "Webhook のホストは discord.com か discordapp.com だけです。",
    };
  }
  const match = WEBHOOK_PATH.exec(url.pathname);
  if (!match) {
    return {
      ok: false,
      message: "Webhook URL は /api/webhooks/{id}/{token} の形だけ使えます。",
    };
  }
  const token = match[2] ?? "";
  const canonical = `https://${url.hostname}/api/webhooks/${match[1]}/${token}`;
  return { ok: true, url: canonical, hint: token.slice(-4) };
};

export const webhookHint = (value: string): string => {
  const checked = validateWebhookUrl(value);
  return checked.ok ? checked.hint : "secret";
};

const WEBHOOK_LEAK =
  /https?:\/\/(?:[\w.-]+\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi;

export const redactText = (text: string, secrets: string[]): string => {
  let redacted = text.replace(WEBHOOK_LEAK, "[redacted]");
  const needles = [...secrets].sort((left, right) => {
    return right.length - left.length;
  });
  for (const secret of needles) {
    const trimmed = secret.trim();
    if (trimmed.length < 8) {
      continue;
    }
    redacted = redacted.split(trimmed).join("[redacted]");
    const checked = validateWebhookUrl(trimmed);
    if (!checked.ok) {
      continue;
    }
    const path = new URL(checked.url).pathname;
    redacted = redacted.split(path).join("[redacted]");
    const parts = path.split("/");
    const token = parts[parts.length - 1] ?? "";
    const id = parts[parts.length - 2] ?? "";
    if (token.length >= 8) {
      redacted = redacted.split(token).join("[redacted]");
    }
    if (id.length >= 8) {
      redacted = redacted.split(id).join("[redacted]");
    }
  }
  return redacted;
};

export const redactValue = (value: unknown, secrets: string[]): unknown => {
  if (typeof value === "string") {
    return redactText(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      return redactValue(item, secrets);
    });
  }
  if (value !== null && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = redactValue(item, secrets);
    }
    return redacted;
  }
  return value;
};
