import pRetry, { AbortError, type FailedAttemptError } from "p-retry";

class DiscordRateLimitExceededError extends Error {
  retryAfter: number;
  global: boolean;
  code?: number;

  constructor(
    message: string,
    retryAfter: number,
    global: boolean,
    code?: number,
  ) {
    super(message);
    this.name = "DiscordRateLimitExceededError";
    Object.setPrototypeOf(this, new.target.prototype);
    this.retryAfter = retryAfter;
    this.global = global;
    this.code = code;
  }
}

interface DiscordRateLimitExceededErrorBody {
  message: string;
  retry_after: number;
  global: boolean;
  code?: number;
}

export const sendDiscordWebhook = async (
  webhookUrl: string,
  content: string,
): Promise<Response> => {
  const request = async () => {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
      }),
    });

    if (res.status === 404) {
      throw new AbortError(res.statusText);
    }
    if (res.status === 429) {
      const body = await res.json<DiscordRateLimitExceededErrorBody>();
      throw new DiscordRateLimitExceededError(
        body.message,
        body.retry_after,
        body.global,
        body.code,
      );
    }
    return res;
  };

  const shouldRetry = (error: FailedAttemptError) => {
    if (error instanceof DiscordRateLimitExceededError) {
      console.log(
        `Discord rate limit exceeded. Retrying after ${error.retryAfter}s...`,
      );
      setTimeout(() => {
        console.log("Retrying...");
      }, error.retryAfter * 1000);
      return true;
    }
    return false;
  };

  return pRetry(request, {
    retries: 3,
    shouldRetry,
  });
};
