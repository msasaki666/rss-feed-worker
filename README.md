# RSS Feed Worker

Cloudflare Workers を使って複数の RSS フィードを監視し、新着記事を Discord Webhook に通知するサービスです。Cron トリガーで定期的に起動し、KV ストレージに既読 URL を保存することで重複投稿を防ぎます。

## 機能概要
- JST 8:00 / 12:00 / 16:00 の Cron で実行
- RSS 取得 → 未処理記事の抽出 → Discord 送信 → KV 保存の一連処理
- URL を SHA-256 でハッシュ化して既読判定
- HTTP エンドポイントは環境変数 `ENABLE_HTTP_REQUEST` で有効化

## コード構成
- **`src/index.ts`**: `handleScheduled()` が入口。`confirmRss()` が RSS 取得から Discord 送信までを担当
- **`src/mock.ts`**: Discord Webhook をスタブ化したテスト用関数

## 設定ファイル
- **`wrangler.jsonc`**: Cron スケジュール、KV 名前空間、環境変数などの Worker 設定
- **`package.json`**: `npm run dev` (ローカル開発) / `npm run deploy` (デプロイ) などのコマンド
- **`biome.json`**: Biome による整形・Lint 設定。スペースインデントとダブルクォートを使用

## 必要な環境変数
- Discord Webhook URL (IT 用・Science 用)
- `ENABLE_HTTP_REQUEST`: HTTP エンドポイントの有効化フラグ

これらは wrangler の secret として設定してください。

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

