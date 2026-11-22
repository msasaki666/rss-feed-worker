export interface FeedTarget {
  postTitle: string;
  rssUrl: string;
  discordWebhookUrl: string;
}

export interface PublicFeed {
  postTitle: string;
  rssUrl: string;
}

/**
 * Cron と MCP が同じフィード定義を使う。
 * Discord Webhook URL は呼び出し元の env から読み、応答には出さない。
 */
export const getFeedTargets = (env: {
  DISCORD_WEBHOOK_URL_IT: string;
  DISCORD_WEBHOOK_URL_SCIENCE: string;
}): FeedTarget[] => {
  return [
    {
      postTitle: "はてブ IT",
      rssUrl: "https://b.hatena.ne.jp/hotentry/it.rss",
      discordWebhookUrl: env.DISCORD_WEBHOOK_URL_IT,
    },
    // {
    //   postTitle: "Science Portal",
    //   rssUrl: "https://scienceportal.jst.go.jp/feed/rss.xml",
    //   discordWebhookUrl: env.DISCORD_WEBHOOK_URL_SCIENCE,
    // },
    {
      postTitle: "WIRED Japan",
      rssUrl: "https://wired.jp/feed/rss",
      discordWebhookUrl: env.DISCORD_WEBHOOK_URL_SCIENCE,
    },
  ];
};

export const toPublicFeed = (target: FeedTarget): PublicFeed => {
  return {
    postTitle: target.postTitle,
    rssUrl: target.rssUrl,
  };
};
