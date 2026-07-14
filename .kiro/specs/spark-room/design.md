# Spark Room 設計

## 設計方針

Spark Roomは、人間のブラウザー参加者とKiroのAIエージェント参加者が、同じ共有サーバー上のルーム状態を読み書きするマルチプレイヤー・ワークスペースとして実装する。

人間はブラウザーでボード、エージェントタスク、活動ログ、PRDを操作する。

KiroはMCPサーバーのツールを使い、Purinという役割を持つAIエージェントとして同じルームへ参加する。

AIエージェントはブラウザーの会話ボットではない。

割り当てられたタスクを読み、根拠を説明し、提案と草案を共有状態へ書き込むチームメイトである。

MVPの共有サーバーはローカルで起動する。

このため、追加のクラウドサービスやアプリケーション用AI APIキーを使わずに、人間とKiroエージェントの共同作業をデモできる。

## アーキテクチャ

```text
[人間Aのブラウザー] ─┐
[人間Bのブラウザー] ─┼─ HTTP / Server-Sent Events ─┐
                      │                              │
                      │                       [Spark Room Server]
                      │                              │
                      │                      RoomService / JSON Store
                      │                              │
[Kiroエージェント] ── MCP stdio ─ [Spark Room MCP Server] ─ HTTP ┘
```

Spark Room Serverがルーム状態の唯一の更新窓口となる。

ブラウザーとMCPサーバーは、どちらもこの共有サーバーのAPIを使う。

そのため、人間とAIエージェントの操作は同じ保存、検証、活動ログ、リアルタイム通知の経路を通る。

MCPサーバーはKiroから標準入出力で呼び出されるローカルプロセスであり、HTTP経由でSpark Room Serverへ要求を送る。

## 技術構成

| 領域 | 採用技術 | 役割 |
| --- | --- | --- |
| 人間用クライアント | Vite、React、TypeScript | ルーム画面、ボード、タスク、PRDの操作 |
| 共有サーバー | Node.js、TypeScript、HTTP、Server-Sent Events | 状態管理、REST API、ブラウザーへの更新通知 |
| 永続化 | ローカルJSONストア | ルーム、メンバー、提案、タスク、PRD、活動ログの保存 |
| Kiro連携 | MCPサーバー、MCP TypeScript SDK | KiroがPurinとして共有ルームを操作するためのツール |
| 検証 | TypeScriptの型、入力値検証関数 | API入力、保存データ、MCPツール引数の検証 |
| Kiroの振る舞い | Steeringファイル | Purinの役割、人間による承認、提案の上限を規定 |

共有サーバーを単一の状態更新窓口とするため、ブラウザーとAIエージェントが別々の保存領域を持たない。

## 実行プロセス

| プロセス | 起動者 | 役割 |
| --- | --- | --- |
| Spark Room Server | 開発者 | ルーム状態、REST API、SSE配信を提供する |
| Vite開発サーバー | 開発者 | 人間用ブラウザー画面を提供する |
| Spark Room MCP Server | Kiro | MCPツールを公開し、共有サーバーへ要求を送る |
| Kiroセッション | 人間メンバー | PurinとしてMCPツールを実行する |

開発中はViteが `/api` とイベントストリームへの要求をSpark Room Serverへ転送する。

本番相当のビルドでは、Spark Room Serverが静的クライアントを配信できる構成へ拡張できる。

## 画面構成

### ルーム作成画面

ルートパス `/` に表示する。

- ルーム名と人間メンバーの表示名の入力欄
- 「ルームを作成」ボタン
- 共有URLとルームIDを表示する領域
- ローカル共有サーバーとKiro MCP連携の説明
- 食材ロス削減アプリを題材にした開始例

### ルーム画面

`/rooms/[roomId]` に表示する。

デスクトップでは、次の4領域を同時に見せる。

| 領域 | 内容 |
| --- | --- |
| 左列 | 共有URL、ルームID、参加者一覧、Kiro招待手順 |
| 中央 | 課題、対象ユーザー、アイデア、決定事項のボード |
| 右上 | エージェントタスク、提案の承認または却下 |
| 右下 | 活動ログ、PRD草案の作成、編集、承認、出力 |

### Kiro招待パネル

人間メンバーがAIエージェントを招待するための専用パネルを表示する。

パネルは、ルームID、未完了のエージェントタスク、Kiroへ貼り付ける参加依頼文を表示する。

人間メンバーは依頼文をコピーし、KiroのチャットでPurinへ送る。

ブラウザーからKiroを自動的に起動する機能は実装しない。

Kiroが `join_workspace` を実行すると、参加者一覧へPurinが表示される。

## データ設計

すべてのルーム状態はSpark Room Serverだけが更新し、ローカルJSONファイルへ保存する。

```ts
type Room = {
  id: string;
  name: string;
  createdAt: string;
  members: Member[];
  cards: Card[];
  messages: Message[];
  agentTasks: AgentTask[];
  activities: Activity[];
  prd: PrdDocument | null;
};

type Member = {
  id: string;
  displayName: string;
  memberType: "human" | "agent";
  role: string;
  status: "active" | "away" | "left";
  joinedAt: string;
};
```

### Card

| 項目 | 型 | 説明 |
| --- | --- | --- |
| id | string | カードID |
| column | `problem`、`user`、`idea`、`decision` | ボードの列 |
| content | string | カード本文 |
| authorId | string | 作成者のメンバーID |
| proposalStatus | `approved`、`pending`、`rejected` | 提案の状態 |
| rationale | string | AIエージェントが提案した理由 |
| updatedAt | string | 更新日時 |

人間が作成したカードは `approved` とする。

AIエージェントが作成したカードは `pending` とし、人間が承認した後に通常のボードへ表示する。

### Message

| 項目 | 型 | 説明 |
| --- | --- | --- |
| id | string | メッセージID |
| authorId | string | 発言者のメンバーID |
| content | string | 分析、提案、次の判断の説明 |
| createdAt | string | 発言日時 |

### AgentTask

| 項目 | 型 | 説明 |
| --- | --- | --- |
| id | string | タスクID |
| kind | `question`、`proposal`、`review`、`prd_draft` | タスク種別 |
| instruction | string | 人間メンバーによる依頼内容 |
| assigneeId | string または `null` | 担当AIエージェント |
| status | `todo`、`in_progress`、`done` | 実行状態 |
| createdBy | string | 作成した人間メンバーのID |
| resultSummary | string または `null` | AIエージェントによる完了結果 |
| createdAt | string | 作成日時 |
| updatedAt | string | 更新日時 |

### Activity

| 項目 | 型 | 説明 |
| --- | --- | --- |
| id | string | 活動ID |
| actorId | string | 操作したメンバーID |
| activityType | 文字列 | 操作種別 |
| summary | string | 人間が読める操作概要 |
| createdAt | string | 発生日時 |

### PrdDocument

| 項目 | 型 | 説明 |
| --- | --- | --- |
| content | string | Markdown形式のPRD |
| status | `draft`、`approved`、`returned` | 草案の状態 |
| createdBy | string | 作成者のメンバーID |
| updatedBy | string | 最終更新者のメンバーID |
| updatedAt | string | 更新日時 |

## API設計

ブラウザー用のAPIとMCPサーバー用の内部APIは、同じRoomServiceを利用する。

| メソッド | パス | 用途 |
| --- | --- | --- |
| `POST` | `/api/rooms` | ルームと作成者を作成する |
| `GET` | `/api/rooms/:roomId` | 最新のルーム状態を取得する |
| `POST` | `/api/rooms/:roomId/members` | 人間またはエージェントを参加させる |
| `PATCH` | `/api/rooms/:roomId/members/:memberId` | メンバー状態を更新する |
| `POST` | `/api/rooms/:roomId/cards` | 人間カードまたはAI提案を追加する |
| `PATCH` | `/api/rooms/:roomId/cards/:cardId` | カードを編集、承認、却下する |
| `POST` | `/api/rooms/:roomId/messages` | 分析または会話を追加する |
| `POST` | `/api/rooms/:roomId/agent-tasks` | エージェントタスクを作成する |
| `PATCH` | `/api/rooms/:roomId/agent-tasks/:taskId` | 担当と状態を更新する |
| `PUT` | `/api/rooms/:roomId/prd` | PRD草案を保存、編集、承認、差し戻す |
| `GET` | `/api/rooms/:roomId/events` | ルーム更新をSSEで購読する |

各書き込みAPIは入力を検証し、更新、JSON保存、活動ログ記録、SSE配信を1つのRoomService操作として実行する。

## リアルタイム同期

ブラウザーはルームを開くと、`GET /api/rooms/:roomId/events` へ `EventSource` 接続する。

RoomServiceで状態が更新されるたびに、サーバーは `room-updated` イベントを購読中のブラウザーへ配信する。

ブラウザーはイベントを受けたら最新のルーム状態を取得し、画面を更新する。

MCPツールによる更新もRoomServiceを通るため、Kiroの操作は人間メンバーの画面へ同じ経路で即時に反映される。

接続が切れたとき、ブラウザーは最後の状態を表示し、`EventSource` の再接続後に最新状態を再取得する。

## MCPサーバー設計

Spark Room MCP Serverは、Kiroのプロセスから標準入出力で起動される。

MCPサーバーはアプリケーションのデータファイルを直接編集しない。

各ツールは、ローカルのSpark Room ServerへHTTP要求を送り、サーバー側の入力検証と活動ログを必ず経由する。

### MCPツール

| ツール | 主な引数 | 用途 |
| --- | --- | --- |
| `join_workspace` | `roomId`、`displayName`、`role` | PurinなどのAIエージェントとしてルームへ参加する |
| `leave_workspace` | `roomId`、`memberId` | AIエージェントを退出状態にする |
| `read_workspace` | `roomId` | メンバー、カード、タスク、PRD、活動ログを読む |
| `list_agent_tasks` | `roomId`、`status` | 未完了または担当タスクを読む |
| `update_agent_task` | `roomId`、`taskId`、`status`、`resultSummary` | 担当、開始、完了結果を記録する |
| `post_agent_message` | `roomId`、`memberId`、`content` | 分析、根拠、次の判断をチームへ伝える |
| `propose_card` | `roomId`、`memberId`、`column`、`content`、`rationale` | 人間承認待ちの提案カードを追加する |
| `save_prd_draft` | `roomId`、`memberId`、`content` | AIエージェントが作ったPRD草案を保存する |

`propose_card` は常に `pending` 状態のカードを作る。

`save_prd_draft` は常に `draft` 状態のPRDを作る。

人間のブラウザー操作だけが、提案の承認、却下、PRDの承認を実行できる。

## Purinの作業フロー

1. 人間メンバーがブラウザーでエージェントタスクを作成する。
2. 人間メンバーがKiro招待パネルの依頼文をコピーし、KiroのチャットでPurinへ依頼する。
3. Purinが `join_workspace` を実行し、役割を持つAIエージェントとして参加する。
4. Purinが `read_workspace` と `list_agent_tasks` を使い、チームの状況と担当を読む。
5. Purinが `update_agent_task` でタスクを進行中へ更新する。
6. Purinが分析を `post_agent_message` へ、提案を `propose_card` へ、PRD草案を `save_prd_draft` へ記録する。
7. Purinが `update_agent_task` で完了結果と次の判断を記録する。
8. 人間メンバーが提案またはPRD草案を確認し、承認、却下、差し戻し、編集を行う。

## Kiro Steering

`.kiro/steering/spark-room-agent.md` を作成し、KiroがPurinとして行動するときの規約を定義する。

Steeringには、少なくとも次を含める。

- 書き込み前に共有ルームを読むこと
- 人間の決定を上書きしないこと
- 提案は最大3件にし、理由を添えること
- 提案とPRDを草案として扱い、人間の承認を待つこと
- タスクの完了結果と次に必要な判断を記録すること
- 日本語で明確にチームへ報告すること

## ローカルMVPの制約と安全性

共有サーバーは開発用のローカルプロセスとして起動する。

MVPでは認証を実装しないため、ルームIDを知る利用者はそのローカルサーバー上のルームへ参加できる。

機密情報を入力しないよう画面上で注意を表示する。

Kiroは明示的に人間メンバーから依頼されたときだけMCPツールを使う。

AIエージェントが人間の判断を代行して確定操作を行わない設計にする。

## ファイル構成

```text
src/
  client/
    main.tsx
    app.tsx
    styles.css
    components/
      room-creator.tsx
      room-shell.tsx
      participant-panel.tsx
      idea-board.tsx
      agent-task-panel.tsx
      kiro-invite-panel.tsx
      activity-log.tsx
      prd-editor.tsx
    lib/
      api-client.ts
      room-events.ts
      types.ts
  server/
    index.ts
    room-service.ts
    room-store.ts
    routes.ts
    validation.ts
  mcp/
    index.ts
    tools.ts
    server-client.ts
  shared/
    types.ts
    schemas.ts
data/
  spark-room.json
.kiro/
  settings/
    mcp.json
  specs/
    spark-room/
      requirements.md
      design.md
      tasks.md
  steering/
    spark-room-agent.md
```

## 将来の拡張

共有サーバーをネットワーク上のホストへ配置すれば、ブラウザーの人間メンバーを別端末から参加させられる。

MCPサーバーのツールはHTTP経由で共有サーバーを操作するため、ローカル実装からホスト済み実装へ移行しても、Kiro側の作業フローは維持できる。

外部の生成AIをアプリケーションへ追加する場合も、Kiroを使うMCP経由のエージェント参加を残し、AIエージェントの行動履歴を共有ルームへ記録する。
