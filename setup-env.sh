#!/bin/bash
# 環境変数設定スクリプト - インタラクティブ版

echo "🔐 Google Calendar API 環境変数設定"
echo "======================================"
echo ""

# .dev.varsファイルのパスを確認
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEV_VARS_FILE="${PROJECT_DIR}/.dev.vars"

echo "現在の設定を確認します..."
echo ""

if [ -f "$DEV_VARS_FILE" ]; then
    echo "✅ .dev.vars ファイルが存在します"
    echo ""
    echo "現在の設定:"
    cat "$DEV_VARS_FILE" | grep -v "^#" | grep -v "^$"
    echo ""
else
    echo "⚠️  .dev.vars ファイルが見つかりません"
    echo "新規作成します"
    cat > "$DEV_VARS_FILE" << EOF
# ローカル開発用の環境変数
# このファイルは .gitignore に含まれているため、Gitにコミットされません

GOOGLE_CALENDAR_API_KEY=
GOOGLE_CALENDAR_ID=
EOF
fi

echo ""
echo "環境変数を設定しますか？ (y/N)"
read -r response

if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    echo ""
    echo "Google Calendar APIキーを入力してください:"
    read -r api_key
    
    echo ""
    echo "カレンダーID（通常はGmailアドレス）を入力してください:"
    read -r calendar_id
    
    # .dev.varsファイルを更新
    cat > "$DEV_VARS_FILE" << EOF
# ローカル開発用の環境変数
# このファイルは .gitignore に含まれているため、Gitにコミットされません

GOOGLE_CALENDAR_API_KEY=${api_key}
GOOGLE_CALENDAR_ID=${calendar_id}
EOF
    
    echo ""
    echo "✅ 環境変数を設定しました！"
    echo ""
    echo "PM2を再起動します..."
    cd "$PROJECT_DIR"
    pm2 restart webapp
    
    echo ""
    echo "✅ 設定完了！"
    echo ""
    echo "動作確認:"
    echo "curl http://localhost:3000/api/calendar/today"
else
    echo ""
    echo "キャンセルしました"
fi
