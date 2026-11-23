declare namespace Cloudflare {
  interface Env {
    /**
     * `https://<team>.cloudflareaccess.com`。空または未設定で、かつ
     * ACCESS_AUD も空なら /mcp の JWT 検証は行わない。
     */
    ACCESS_TEAM_DOMAIN?: string;
    /** Access アプリケーションの Application Audience (AUD) タグ。 */
    ACCESS_AUD?: string;
    /**
     * `"true"` のときだけ、Access 未設定のローカル開発で /mcp の JWT 検証を省略する。
     * 本番には設定しない。Access の設定がある場合は無視され、JWT 検証が優先される。
     */
    MCP_ALLOW_UNAUTHENTICATED?: string;
    /**
     * 追加の Discord Webhook。`{"ALIAS":"https://discord.com/api/webhooks/..."}`。
     * `IT` と `SCIENCE` は DISCORD_WEBHOOK_URL_IT / DISCORD_WEBHOOK_URL_SCIENCE が優先される。
     */
    DISCORD_WEBHOOKS?: string;
  }
}
