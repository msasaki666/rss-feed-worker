# RSS Feed Worker

Cloudflare Workers を使って複数の RSS フィードを監視し、新着記事の URL 一覧を Discord Webhook に通知するサービスです。Cron トリガーで定期的に起動し、KV ストレージに既読 URL を保存することで重複投稿を防ぎます。

## 機能概要

- JST 8:00 の Cron で実行（`wrangler.jsonc` の cron が正）
- RSS 取得 → 未処理記事の抽出 → Discord へ個別通知・URL 一覧送信 → KV 保存の一連処理
- URL を SHA-256 でハッシュ化して既読判定
- HTTP の既存レスポンスは環境変数 `ENABLE_HTTP_REQUEST` で切り替わる
- AI クライアント向けに、同じ処理を MCP（Streamable HTTP）として `/mcp` で公開する

## コード構成

- **`src/index.ts`**: Cron と HTTP の入口。`/mcp` だけ MCP に渡し、それ以外は従来のレスポンス
- **`src/feeds.ts`**: 監視対象フィード。Webhook URL は env から読む
- **`src/feed-processor.ts`**: RSS 取得、既読判定、Discord 投稿（`processFeed`）
- **`src/mcp.ts`**: MCP サーバーとツール
- **`src/access.ts`**: `Cf-Access-Jwt-Assertion` の検証
- **`src/rss.ts`** / **`src/discord.ts`**: フィード解析と Webhook 送信
- **`src/mock.ts`**: テスト用のスタブ

## MCP サーバー

エンドポイントは `https://<Worker のホスト名>/mcp` です。トランスポートは Streamable HTTP で、クライアントは `POST` に JSON-RPC を送ります。`Accept` には `application/json` と `text/event-stream` の両方が必要です。ブラウザで `/mcp` を開いてもツール一覧は出ません。

パスは完全一致です。`/mcp/` は MCP ではありません。

### ツール

| ツール              | 副作用                 | 説明                                                                               |
| ------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| `list_feeds`        | なし                   | 設定済みフィードの `postTitle` と RSS URL。Webhook URL は返さない                  |
| `preview_feed`      | なし                   | 指定フィードを取得して記事のタイトルと URL を返す。既読にしない                    |
| `list_unseen_items` | なし                   | KV に無い記事だけ返す。投稿も既読保存もしない                                      |
| `publish_new_items` | Discord 投稿と KV 保存 | Cron と同じ処理。`feed` を省略すると全フィード。投稿できた記事を 10 日間既読にする |

`feed` には `list_feeds` の `postTitle` をそのまま渡します（例: `はてブ IT`）。設定に無い URL は取得できません。

`preview_feed` と `list_unseen_items` の `limit` は省略時 20、最大 50 です。件数を超える分は `truncated: true` になります。`publish_new_items` は件数で切らず、未読をすべて処理します。

### 認証

OAuth サーバーは Worker に置いていません。Cloudflare Access の **Managed OAuth** が、MCP クライアント向けの OAuth 2.0 認可サーバーになります。クライアントが受け取るのは不透明なアクセストークンです。Access がそのトークンをユーザーに引き当て、オリジンへ `Cf-Access-Jwt-Assertion` を付けます。

Worker はその JWT を、チームの公開鍵（`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`）で検証します。検証に使う値はコードに書きません。

| 変数                 | 置き場所              | 値                                                 |
| -------------------- | --------------------- | -------------------------------------------------- |
| `ACCESS_TEAM_DOMAIN` | `wrangler secret put` | `https://<team-name>.cloudflareaccess.com`         |
| `ACCESS_AUD`         | `wrangler secret put` | アプリケーションの Application Audience (AUD) タグ |

両方あるときだけ `/mcp` で JWT を必須にします。両方空なら検証しません。ローカルの `wrangler dev` 用です。本番の `/mcp` を公開する前に両方入れてください。片方だけだと設定ミスとして HTTP 500 になります。検証は `/mcp` だけです。それ以外のパスのレスポンスは変えていません。

署名アルゴリズムは RS256、`iss` はチームドメイン、`aud` は AUD タグと一致する必要があります。トークンに書かれた issuer は信用しません。

### Cloudflare Access の設定

ダッシュボード操作はこのリポジトリからは行いません。次を Zero Trust 側で作ります。

1. Zero Trust 組織と、ログインに使う IdP（または One-time PIN）を用意する。
2. **Zero Trust** → **Access controls** → **Applications** → アプリケーションを作成する。
3. 種類は **Self-hosted**（公開ホスト名）にする。作成画面に、自前の MCP サーバー向けの **MCP server** タイプがあり、そのタイプがホスト名を Access で保護するならそちらでもよい。どちらも次の Managed OAuth を有効にする。ポータルへ登録するだけの MCP server 追加は、オリジン URL 自体を保護しない。
4. アプリケーションのドメインを Worker のホスト名にする（`*.workers.dev` か、プロキシを通したカスタムドメイン）。パスはホスト全体にする。Managed OAuth は `https://<ホスト>/.well-known/oauth-authorization-server` をそのホストで返す。`/mcp` だけを保護すると、クライアントがディスカバリを Worker に取りにいって失敗する。
5. ポリシーの Action は **Allow**。Include は使ってよい人（メールアドレス、メールドメイン、グループなど）。**Bypass** にはしない。
6. 認証タブで IdP を選ぶ。IdP が 1 つなら **Apply instant authentication** を推奨する。
7. **Advanced settings** で **Managed OAuth** をオンにする。
   - **Allow localhost clients** と **Allow loopback clients** をオンにする（Claude Code や MCP Inspector）。
   - **Allowed redirect URIs** にクライアントのコールバックを入れる。Cursor は `cursor://anysphere.cursor-mcp/oauth/callback`。Workers AI Playground を使うなら `https://playground.ai.cloudflare.com/*`。
   - アクセストークンは短く（5〜15 分）、Grant session は長く（1〜2 週間）する。期限が来ると Access がポリシーを再評価する。
8. **Additional settings** の Application Audience (AUD) Tag をコピーする。チームドメインは `https://<Zero Trust のチーム名>.cloudflareaccess.com`。
9. Worker に secret を入れる。`wrangler.jsonc` には空文字を置かない（deploy が空文字で上書きするため）。

```bash
npx wrangler secret put ACCESS_TEAM_DOMAIN
npx wrangler secret put ACCESS_AUD
```

10. Worker をデプロイする。この変更だけではデプロイしない。

ホスト全体を Access の後ろに置くと、`/mcp` 以外の HTTP もログインが必要になる。Cron は HTTP ではないので従来どおり動く。ログイン後のレスポンス本文は、これまでと同じです。

人が介在しないクライアントには、同じアプリケーションへ **Service Auth** ポリシーと Service Token を足せる。クライアントは `CF-Access-Client-Id` と `CF-Access-Client-Secret` を送る。Access が JWT を付けるので、Worker 側の検証コードはユーザーログインと共通です。

### MCP クライアント

デプロイ後の URL 例は `https://rss-feed-worker.<subdomain>.workers.dev/mcp` です。

Cursor の MCP 設定:

```json
{
  "mcpServers": {
    "rss-feed-worker": {
      "url": "https://rss-feed-worker.<subdomain>.workers.dev/mcp"
    }
  }
}
```

Claude Code:

```bash
claude mcp add --transport http rss-feed-worker https://rss-feed-worker.<subdomain>.workers.dev/mcp
```

ローカルでは secret を空のまま `npm run dev` し、MCP Inspector で `http://localhost:8787/mcp` に接続する。

```bash
npx @modelcontextprotocol/inspector
```

Access を有効にした本番 URL では、Inspector の **Quick OAuth Flow** か、各クライアントのブラウザログインで Access に入る。

### 設計上の前提

- AI 向けインターフェースはリモート MCP とした。チャット API や API キーは追加していない。
- 認可の本体は Access の Managed OAuth。Worker は JWT の再検証だけを行う。
- JWT 検証は `ACCESS_TEAM_DOMAIN` と `ACCESS_AUD` が両方あるときだけ有効。未設定の本番は `/mcp` が開いたままになる。
- ツールが触れるフィードは `src/feeds.ts` の定義だけ。任意 URL の取得はできない。
- `publish_new_items` は Discord に投稿し、成功した URL を既読にする。確認だけなら `preview_feed` か `list_unseen_items` を使う。

## 設定ファイル

- **`wrangler.jsonc`**: Cron スケジュール、KV 名前空間、環境変数などの Worker 設定
- **`package.json`**: `npm run dev` (ローカル開発) / `npm run deploy` (デプロイ) などのコマンド
- **`biome.json`**: Biome による整形・Lint 設定。スペースインデントとダブルクォートを使用

## 必要な環境変数

- Discord Webhook URL (IT 用・Science 用)
- URL 一覧を送る Discord Webhook URL (例: NotebookLM 用)
- `ENABLE_HTTP_REQUEST`: `/mcp` 以外の HTTP レスポンスを切り替えるフラグ（`wrangler.jsonc` の var）
- `ACCESS_TEAM_DOMAIN` と `ACCESS_AUD`: 本番の `/mcp` で必須。入れ方は「Cloudflare Access の設定」

Discord の Webhook URL は wrangler の secret にしてください。

## 開発の始め方

```bash
npm install
npm run dev
```

## 今後学ぶと良いこと

1. Cloudflare Workers の基礎（Cron、KV、環境変数）
2. `htmlparser2` による RSS/HTML パーシングと `p-retry` のリトライ戦略
3. Discord Webhook API とレート制限対策
4. TypeScript と Biome を用いた整ったコードスタイル
