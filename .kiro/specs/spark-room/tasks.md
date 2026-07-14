# Spark Room 実装タスク

## 実装結果

共有サーバー、ブラウザー画面、MCPサーバーは実装済みである。

人間とPurinは、同じHTTP APIとRoomServiceを通じてルームを操作する。

人間だけがAI提案とPRDを承認できる。

- [x] 1. Vite、React、TypeScript、Node.jsの開発基盤を作成する
  - 人間用クライアント、共有サーバー、MCPサーバーを別エントリーポイントとして起動できる構成を作成した。
  - Viteから共有サーバーへAPIとイベントストリームを転送できるようにした。
  - ローカルJSONデータ用の初期化処理を実装した。

- [x] 2. 共有データ型と入力検証を実装する
  - `Room`、`Member`、`Card`、`Message`、`AgentTask`、`Activity`、`PrdDocument` の共有型を定義した。
  - すべての書き込み入力を検証した。
  - AI提案を `pending`、AIのPRDを `draft` から開始する制約を実装した。

- [x] 3. RoomServiceとローカルJSONストアを実装する
  - RoomServiceがルーム、メンバー、カード、メッセージ、タスク、PRDを一元管理する。
  - JSONストアは操作を直列化し、一時ファイルからの原子的な保存を行う。
  - 状態変更ごとに活動ログを保存する。

- [x] 4. 共有サーバーのREST APIとServer-Sent Eventsを実装する
  - ルーム、メンバー、カード、メッセージ、エージェントタスク、PRDのAPIを実装した。
  - `GET /api/rooms/:roomId/events` で `room-updated` を通知する。
  - 書き込みは入力検証、RoomService更新、永続化、活動ログ、通知の順に処理する。

- [x] 5. 人間メンバーのルーム作成と参加画面を実装する
  - ルーム作成、共有URLからの人間参加、接続状態、復旧案内を実装した。
  - 同一タブの参加者IDはセッションストレージに保持する。

- [x] 6. 共有アイデアボードと人間による提案承認を実装する
  - 課題、利用者、アイデア、決定の4列ボードを実装した。
  - 人間カードの追加、編集、削除を実装した。
  - AIの保留中提案を区別して表示し、人間だけが承認または却下できる。
  - Server-Sent Eventsを受信すると、ルーム状態を再取得して画面へ反映する。

- [x] 7. 参加者、エージェントタスク、Kiro招待パネルを実装する
  - 人間とAIエージェントを役割と在室状態付きで表示する。
  - 人間が質問、提案、レビュー、PRD草案のタスクを作成できる。
  - ルームIDと未完了タスクを含むPurinへの参加依頼文をコピーできる。

- [x] 8. PRD草案の編集、承認、出力を実装する
  - Markdown形式のPRD草案を表示する。
  - 人間による草案の編集、承認、差し戻しを実装した。
  - 承認済みPRDをコピーまたはMarkdownファイルとして出力できる。

- [ ] 9. Spark Room MCPサーバーとKiro接続設定を有効化する
  - MCPサーバー本体と、`join_workspace`、`leave_workspace`、`read_workspace`、`list_agent_tasks`、`update_agent_task`、`post_agent_message`、`propose_card`、`save_prd_draft` は実装済みである。
  - MCPツールは共有サーバーのHTTP APIだけを使い、JSONデータファイルを直接更新しない。
  - `.kiro/settings/mcp.json` への登録だけは、現在の環境で設定ファイルへの書き込みが保護されているため手動設定が必要である。

- [ ] 10. Kiroを含むデモを最終確認する
  - API、Server-Sent Events、MCPの自動スモーク検証は完了した。
  - 実ブラウザーの別タブと、KiroのMCP接続後の画面反映は、ローカルでサーバーを起動し、設定を有効化して確認する。

## 検証結果

- `npm run check && npm run build` は成功した。
- 共有サーバーを起動し、ルーム作成、AI参加、提案の作成と人間承認、PRD草案の保存と人間承認、活動ログを確認した。
- Server-Sent Eventsの `connected` と `room-updated` を確認した。
- MCPクライアントから8個のツールを列挙し、Purinの参加、状態読取、保留中提案、PRD草案の保存を確認した。

## デモ手順

1. ターミナルAで `npm run dev:server` を実行する。
2. ターミナルBで `npm run dev:client` を実行する。
3. ブラウザーで `http://127.0.0.1:5173` を開き、食材ロス削減アプリのルームを作成する。
4. 課題、利用者、アイデア、決定のカードを追加する。
5. 「Purinを招待」から参加依頼文をコピーし、Kiroのチャットへ貼り付ける。
6. KiroでPurinを参加させ、提案タスクを開始させる。
7. Purinが追加した保留中提案を人間メンバーが承認する。
8. PRD草案タスクをPurinへ依頼し、草案を確認して承認する。
9. 承認済みPRDをMarkdownで出力する。

## MCP設定

KiroのMCP設定へ次の内容を追加する。

```json
{
  "mcpServers": {
    "spark-room": {
      "command": "npm",
      "args": ["run", "mcp"],
      "env": {
        "SPARK_ROOM_SERVER_URL": "http://127.0.0.1:8787"
      },
      "disabled": false
    }
  }
}
```

設定後にMCP ServerビューからSpark Roomを再接続する。

## 実装時の確認事項

- Purinの振る舞いは `.kiro/steering/spark-room-agent.md` に従わせる。
- AIエージェントの提案とPRDは、必ず人間による承認前の状態で保存する。
- 共有サーバーを単一の状態更新窓口とし、クライアントやMCPサーバーがデータファイルを直接更新しない。
- 外部AI APIやクラウドサービスなしで、KiroがMCP経由で参加するデモを完成させる。
