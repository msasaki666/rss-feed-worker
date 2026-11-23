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
- **`src/feed-store.ts`**: フィード定義の保存。Webhook は別名で secret を参照する
- **`src/feed-processor.ts`**: RSS 取得、既読判定、Discord 投稿（`processFeed`）
- **`src/mcp.ts`**: MCP サーバーとツール
- **`src/access.ts`**: `Cf-Access-Jwt-Assertion` の検証
- **`src/rss.ts`** / **`src/discord.ts`**: フィード解析と Webhook 送信
- **`src/mock.ts`**: テスト用のスタブ

## MCP サーバー

エンドポイントは `https://<Worker のホスト名>/mcp` です。トランスポートは Streamable HTTP で、クライアントは `POST` に JSON-RPC を送ります。`Accept` には `application/json` と `text/event-stream` の両方が必要です。ブラウザで `/mcp` を開いてもツール一覧は出ません。

パスは完全一致です。`/mcp/` は MCP ではありません。

### ツール

| ツール              | 副作用                             | 説明                                                                                       |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `list_feeds`        | 初回だけ定義を KV に作る           | 保存済みフィードの id、名前、RSS URL、`webhookKey`、enabled。Webhook URL は返さない        |
| `list_webhook_keys` | なし                               | 名前とトークン末尾 4 文字だけ返す。URL は返さない                                          |
| `set_webhook`       | URL を KV に保存                   | Discord の Webhook を名前で登録する。URL は返さない                                        |
| `remove_webhook`    | KV の登録を削除                    | 使われていない登録を消す。secret の IT / SCIENCE は削除できない                            |
| `add_feed`          | 定義の保存。既定で現在の記事を既読 | https の RSS/Atom と解釈できたときだけ追加する。投稿先は名前か Webhook URL                 |
| `update_feed`       | 定義の更新。URL 変更時は既読       | id で名前、RSS URL、投稿先、enabled を変える。Webhook URL は返さない                       |
| `remove_feed`       | 定義の削除                         | フィード定義を消す。記事の既読ハッシュは残す                                               |
| `preview_feed`      | なし                               | 指定フィードを取得して記事のタイトルと URL を返す。既読にしない                            |
| `list_unseen_items` | なし                               | KV に無い記事だけ返す。投稿も既読保存もしない                                              |
| `publish_new_items` | Discord 投稿と KV 保存             | Cron と同じ処理。`feed` を省略すると有効なフィード全部。投稿できた記事を 10 日間既読にする |

`feed` には `list_feeds` の `id` または `postTitle` を渡します（例: `hatena-it`、`はてブ IT`）。設定に無い URL を `feed` に渡しても取得しません。

### フィードの項目

定義は KV の `feed:v1:catalog` にまとめて保存します。既読の記事ハッシュと同じ名前空間ですが、キーは重なりません。初回の読み出しでカタログが無いときだけ、これまでコードに書いてあった 2 件を作ります。全部削除したあとは作り直しません。

| 項目         | 内容                                                                          |
| ------------ | ----------------------------------------------------------------------------- |
| `id`         | 更新と削除に使う安定した ID。省略すると自動で付きます                         |
| `postTitle`  | Discord に出す名前                                                            |
| `rssUrl`     | https の RSS/Atom。localhost、`.local`、IP アドレスそのものは拒否します       |
| `webhookKey` | 登録済み Webhook の名前。`IT` と `SCIENCE` は既存 secret にフォールバックする |
| `webhookUrl` | 追加・更新時だけ渡す Discord の Webhook URL。KV に保存し、応答には出さない    |
| `enabled`    | `false` のフィードは Cron と、`feed` を省略した投稿から外れます               |

Webhook URL はどのツールの応答にも出しません。`list_webhook_keys` は名前とトークン末尾 4 文字だけです。

- `set_webhook` が名前と URL を KV の `feed:v1:webhooks` に保存する
- `add_feed` と `update_feed` は `webhookKey` でその名前を指すか、`webhookUrl` を直接渡す
- 受け付ける URL は https だけで、ホストは `discord.com` か `discordapp.com`（`ptb.` と `canary.` を含む）、パスは `/api/webhooks/{id}/{token}`
- KV に同名が無いとき、`IT` は `DISCORD_WEBHOOK_URL_IT`、`SCIENCE` は `DISCORD_WEBHOOK_URL_SCIENCE` を使う

secret を入れ直す作業はありません。新しい投稿先は MCP の `set_webhook` で登録します。

一覧投稿用の `DISCORD_WEBHOOK_URL_NOTEBOOKLM` はフィードごとではなく、今までどおり全体で 1 つです。

`add_feed` と、`rssUrl` を変える `update_feed` は、保存前にその URL を取得して RSS/Atom として解釈できることを確認します。既定の `markCurrentAsSeen: true` では、その時点の記事を Discord に出さず 10 日間既読にします。既読は記事 URL のハッシュなので、フィードの URL を変えても、同じ記事 URL は再投稿しません。`markCurrentAsSeen: true` のときは、新しいフィード定義をカタログに出す前に、今ある記事のハッシュを KV へ書きます。そのあいだに Cron が走っても、既存記事は未読になりません。RSS として読めなかった場合は、Webhook もカタログも変えません。取得時のリダイレクトは最大 3 回まで自分で追い、飛び先も https で、localhost、`.local`、IP アドレス、認証情報を拒否します。新しいフィードにしか無い記事も、この既定では初回の一斉投稿になりません。バックログも投稿したいときは `markCurrentAsSeen: false` にします。

カタログは 1 つの JSON を丸ごと上書きします。追加の RSS 取得中に別の追加・更新・削除が重なると、先に終わった変更が残らないことがあります。

`preview_feed` と `list_unseen_items` の `limit` は省略時 20、最大 50 です。件数を超える分は `truncated: true` になります。`publish_new_items` は件数で切らず、未読をすべて処理します。

### 認証

OAuth サーバーは Worker に置いていません。Cloudflare Access の **Managed OAuth** が、MCP クライアント向けの OAuth 2.0 認可サーバーになります。クライアントが受け取るのは不透明なアクセストークンです。Access がそのトークンをユーザーに引き当て、オリジンへ `Cf-Access-Jwt-Assertion` を付けます。

Worker はその JWT を、チームの公開鍵（`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`）で検証します。検証に使う値はコードに書きません。

| 変数                 | 置き場所              | 値                                                 |
| -------------------- | --------------------- | -------------------------------------------------- |
| `ACCESS_TEAM_DOMAIN` | `wrangler secret put` | `https://<team-name>.cloudflareaccess.com`         |
| `ACCESS_AUD`         | `wrangler secret put` | アプリケーションの Application Audience (AUD) タグ |

両方あるとき `/mcp` は JWT を必須にします。未設定の `/mcp` は HTTP 403 で拒否します。片方だけだと設定ミスとして HTTP 500 です。検証は `/mcp` だけです。それ以外のパスのレスポンスは変えていません。

ローカルの `wrangler dev` で検証を省略するには、git に含めない `.dev.vars` へ次を書きます。本番の変数や secret には入れません。Access の 2 つが設定されているときは、このフラグがあっても JWT を検証します。

```bash
MCP_ALLOW_UNAUTHENTICATED=true
```

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

ローカルでは `.dev.vars` に `MCP_ALLOW_UNAUTHENTICATED=true` を書いて `npm run dev` し、MCP Inspector で `http://localhost:8787/mcp` に接続する。

```bash
npx @modelcontextprotocol/inspector
```

Access を有効にした本番 URL では、Inspector の **Quick OAuth Flow** か、各クライアントのブラウザログインで Access に入る。

### 設計上の前提

- AI 向けインターフェースはリモート MCP とした。チャット API や API キーは追加していない。
- 認可の本体は Access の Managed OAuth。Worker は JWT の再検証だけを行う。
- `/mcp` は Access の JWT 設定が無いと拒否する。検証の省略はローカルの `MCP_ALLOW_UNAUTHENTICATED=true` だけ。
- ツールが触れるフィードは KV に保存した定義だけ。任意 URL の取得はできない。
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
- `MCP_ALLOW_UNAUTHENTICATED=true`: ローカルの `.dev.vars` だけ。本番には入れない

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
