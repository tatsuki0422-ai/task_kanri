# 🔐 環境変数の安全な設定ガイド

## 📋 概要

このアプリでGoogleカレンダー連携を使用するには、APIキーが必要です。
このガイドでは、**安全に**環境変数を設定する方法を説明します。

## ⚠️ 重要なセキュリティ原則

1. **絶対にGitにコミットしない**
   - `.env`と`.dev.vars`は`.gitignore`に含まれています
   - これらのファイルは自動的にGitから除外されます

2. **ローカル開発と本番環境で分ける**
   - ローカル: `.dev.vars`ファイル
   - 本番: Cloudflare Pagesの環境変数（Wrangler経由）

3. **APIキーは外部に漏らさない**
   - スクリーンショットに写り込ませない
   - チャットやSlackに貼り付けない
   - 公開リポジトリにプッシュしない

## 🔑 Google Calendar APIキーの取得

### 1. Google Cloud Consoleにアクセス
https://console.cloud.google.com/

### 2. プロジェクトを作成
- 左上の「プロジェクトを選択」→「新しいプロジェクト」
- プロジェクト名: `task-manager-app`（任意）

### 3. Google Calendar APIを有効化
1. 「APIとサービス」→「ライブラリ」
2. 検索バーで「Google Calendar API」を検索
3. 「有効にする」をクリック

### 4. APIキーを作成
1. 「APIとサービス」→「認証情報」
2. 「認証情報を作成」→「APIキー」
3. 生成されたAPIキーをコピー
4. 「キーを制限」をクリック（推奨）
   - アプリケーションの制限: なし（または特定のIPアドレス）
   - API の制限: 「キーを制限」を選択
   - 「Google Calendar API」のみを選択
   - 保存

### 5. カレンダーIDを取得
1. Googleカレンダーにアクセス: https://calendar.google.com/
2. 左側の「設定」→使用したいカレンダーを選択
3. 「カレンダーの統合」セクションの「カレンダーID」をコピー
4. 通常は`your-email@gmail.com`の形式です

## 💻 ローカル開発環境での設定

### 方法1: .dev.varsファイルを編集（推奨）

1. プロジェクトのルートディレクトリに移動
```bash
cd your-project-directory
```

2. `.dev.vars`ファイルを編集
```bash
nano .dev.vars
```

3. 以下のように実際の値を設定
```
GOOGLE_CALENDAR_API_KEY=AIzaSyD...（実際のAPIキー）
GOOGLE_CALENDAR_ID=your-email@gmail.com
```

4. 保存して終了（nano: Ctrl+X → Y → Enter）

5. アプリを再起動
```bash
cd your-project-directory
pm2 restart webapp
```

6. 動作確認
```bash
curl http://localhost:3000/api/calendar/today
```

### 方法2: エディタで編集

エディタ（VS Codeなど）で直接編集することもできます：
1. `./.dev.vars`を開く
2. APIキーとカレンダーIDを入力
3. 保存
4. PM2を再起動

## 🌍 本番環境（Cloudflare Pages）での設定

本番環境では`.dev.vars`は使用されません。
代わりに、Cloudflareの環境変数として設定します。

### 方法1: Wrangler CLIで設定（推奨）

```bash
# プロジェクトディレクトリに移動
cd your-project-directory

# 環境変数を設定
npx wrangler pages secret put GOOGLE_CALENDAR_API_KEY --project-name webapp
# プロンプトが表示されたらAPIキーを入力

npx wrangler pages secret put GOOGLE_CALENDAR_ID --project-name webapp
# プロンプトが表示されたらカレンダーIDを入力

# 設定を確認
npx wrangler pages secret list --project-name webapp
```

### 方法2: Cloudflare Dashboardで設定

1. https://dash.cloudflare.com/ にログイン
2. 「Workers & Pages」→ プロジェクト選択
3. 「Settings」→「Environment variables」
4. 「Add variable」をクリック
5. 変数名と値を入力：
   - `GOOGLE_CALENDAR_API_KEY`: （APIキー）
   - `GOOGLE_CALENDAR_ID`: （カレンダーID）
6. 「Save」をクリック
7. アプリを再デプロイ

## ✅ 動作確認

### ローカル環境
```bash
# カレンダーAPIのテスト
curl http://localhost:3000/api/calendar/today
```

正常な場合:
```json
[
  {
    "start": "14:00",
    "end": "15:30",
    "title": "顧客A社訪問"
  }
]
```

エラーの場合:
```json
{
  "error": "Google Calendar API not configured"
}
```

### ブラウザでテスト
1. アプリにアクセス
2. 「カレンダーから取得」ボタンをクリック
3. 今日の予定が表示されればOK

## 🔒 セキュリティチェックリスト

- [ ] `.dev.vars`が`.gitignore`に含まれている
- [ ] APIキーを制限している（Google Cloud Console）
- [ ] `.dev.vars`をGitにコミットしていない
- [ ] 本番環境ではWranglerまたはDashboardで設定
- [ ] APIキーをチャットやスクリーンショットで共有していない

## 🐛 トラブルシューティング

### エラー: "Google Calendar API not configured"

**原因**: 環境変数が設定されていない

**解決方法**:
1. `.dev.vars`ファイルが存在するか確認
```bash
ls -la ./.dev.vars
```

2. 内容を確認（APIキーが設定されているか）
```bash
cat ./.dev.vars
```

3. PM2を再起動
```bash
pm2 restart webapp
```

### エラー: "Failed to fetch calendar events"

**原因**: APIキーが無効、またはGoogle Calendar APIが有効化されていない

**解決方法**:
1. Google Cloud Consoleで「Google Calendar API」が有効か確認
2. APIキーが正しいか確認
3. APIキーの制限設定を確認

### カレンダーIDがわからない

**解決方法**:
- 通常、Gmailアドレスが使えます: `your-email@gmail.com`
- Googleカレンダーの設定から確認できます

## 📚 参考リンク

- Google Calendar API: https://developers.google.com/calendar/api/guides/overview
- Wrangler環境変数: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare Pages環境変数: https://developers.cloudflare.com/pages/configuration/build-configuration/#environment-variables

---

最終更新: 2026-02-03
