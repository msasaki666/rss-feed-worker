declare namespace Cloudflare {
  interface Env {
    /**
     * `https://<team>.cloudflareaccess.com`。空または未設定で、かつ
     * ACCESS_AUD も空なら /mcp の JWT 検証は行わない。
     */
    ACCESS_TEAM_DOMAIN?: string;
    /** Access アプリケーションの Application Audience (AUD) タグ。 */
    ACCESS_AUD?: string;
  }
}
