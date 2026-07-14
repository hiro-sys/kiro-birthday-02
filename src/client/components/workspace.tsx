import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ApiClientError, sparkRoomApi } from "../lib/api-client.js";
import type {
  AgentTaskKind,
  BoardColumn,
  Card,
  Member,
  PrdStatus,
  Room,
} from "../../shared/types.js";

type RoomOperation = () => Promise<Room>;

type WorkspaceProps = {
  room: Room;
  currentMember: Member;
  realtimeStatus: "connecting" | "live" | "reconnecting";
  onRoomChanged: (room: Room) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onRefresh: () => Promise<void>;
  onLeave: () => void;
};

type BoardColumnMeta = {
  id: BoardColumn;
  title: string;
  description: string;
};

const boardColumnMetadata: BoardColumnMeta[] = [
  { id: "problem", title: "課題", description: "いま困っていること・解くべき課題" },
  { id: "user", title: "利用者", description: "誰の、どんな状況を助けるか" },
  { id: "idea", title: "アイデア", description: "試す価値のある解決案" },
  { id: "decision", title: "決定", description: "チームが合意した次の一手" },
];

const taskKindLabels: Record<AgentTaskKind, string> = {
  question: "確認質問",
  proposal: "アイデア提案",
  review: "レビュー",
  prd_draft: "PRD草案",
};

const taskStatusLabels = {
  todo: "未着手",
  in_progress: "進行中",
  done: "完了",
} as const;

const prdStatusLabels: Record<PrdStatus, string> = {
  draft: "草案",
  approved: "承認済み",
  returned: "差し戻し",
};

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "日時不明";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function memberName(room: Room, memberId: string): string {
  return room.members.find((member) => member.id === memberId)?.displayName ?? "不明な参加者";
}

function apiErrorMessage(error: unknown): string {
  return error instanceof ApiClientError
    ? error.message
    : "保存中に問題が発生しました。内容を確認してからもう一度試してください。";
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard !== undefined) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function downloadMarkdown(roomName: string, content: string): void {
  const fileName = roomName.replace(/[^A-Za-z0-9_-]+/g, "-") || "spark-room-prd";
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${fileName}-prd.md`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function RoomWorkspace({
  room,
  currentMember,
  realtimeStatus,
  onRoomChanged,
  onError,
  onNotice,
  onRefresh,
  onLeave,
}: WorkspaceProps) {
  const [isSaving, setIsSaving] = useState(false);

  async function runRoomAction(operation: RoomOperation): Promise<void> {
    setIsSaving(true);

    try {
      onRoomChanged(await operation());
    } catch (error: unknown) {
      onError(apiErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCopyShareUrl(): Promise<void> {
    try {
      await copyText(window.location.href);
      onNotice("共有URLをコピーしました。別タブやチームメンバーへ渡せます。");
    } catch {
      onError("共有URLをコピーできませんでした。ブラウザーのURL欄からコピーしてください。");
    }
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">SPARK ROOM · SHARED WORKSPACE</p>
          <h1>{room.name}</h1>
          <p className="workspace-subtitle">
            ルームID: <code>{room.id}</code>
          </p>
        </div>
        <div className="workspace-header-actions">
          <span className={`realtime-status realtime-${realtimeStatus}`}>
            {realtimeStatus === "live" ? "リアルタイム同期中" : realtimeStatus === "connecting" ? "同期を接続中" : "再接続中"}
          </span>
          <button className="secondary-button" type="button" onClick={() => void onRefresh()}>
            最新状態を取得
          </button>
          <button className="primary-button" type="button" onClick={() => void handleCopyShareUrl()}>
            共有URLをコピー
          </button>
          <button className="text-button" type="button" onClick={onLeave}>
            ルーム一覧へ
          </button>
        </div>
      </header>

      <section className="workspace-intro" aria-label="現在の参加者">
        <div>
          <p className="section-kicker">あなた</p>
          <p className="member-intro-name">{currentMember.displayName}</p>
          <p className="muted-copy">{currentMember.role} · 人間メンバー</p>
        </div>
        <p className="workspace-intro-copy">
          人間が最終判断を持ちます。Purinの提案は、カードとPRDの承認操作でチームの成果物へ反映してください。
        </p>
      </section>

      <div className="workspace-layout">
        <aside className="workspace-sidebar">
          <MemberPanel room={room} />
          <KiroInvitePanel room={room} onNotice={onNotice} onError={onError} />
        </aside>

        <section className="workspace-main-column">
          <IdeaBoard
            room={room}
            currentMember={currentMember}
            disabled={isSaving}
            onChange={runRoomAction}
          />
          <PrdPanel
            room={room}
            currentMember={currentMember}
            disabled={isSaving}
            onChange={runRoomAction}
            onNotice={onNotice}
            onError={onError}
          />
        </section>

        <aside className="workspace-sidebar workspace-sidebar-right">
          <AgentTaskPanel
            room={room}
            currentMember={currentMember}
            disabled={isSaving}
            onChange={runRoomAction}
          />
          <MessagePanel
            room={room}
            currentMember={currentMember}
            disabled={isSaving}
            onChange={runRoomAction}
          />
          <ActivityLog room={room} />
        </aside>
      </div>
    </main>
  );
}

function MemberPanel({ room }: { room: Room }) {
  return (
    <section className="panel-card" aria-labelledby="members-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">TEAM</p>
          <h2 id="members-title">参加者</h2>
        </div>
        <span className="count-badge">{room.members.filter((member) => member.status === "active").length}</span>
      </div>
      <ul className="member-list">
        {room.members.map((member) => (
          <li key={member.id} className={`member-row member-${member.memberType} member-status-${member.status}`}>
            <span className="member-avatar" aria-hidden="true">{member.memberType === "agent" ? "P" : member.displayName.slice(0, 1)}</span>
            <span>
              <strong>{member.displayName}</strong>
              <small>{member.memberType === "agent" ? "AIエージェント" : "人間"} · {member.role}</small>
            </span>
            <span className="member-presence">{member.status === "active" ? "参加中" : member.status === "away" ? "離席中" : "退出"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function KiroInvitePanel({
  room,
  onNotice,
  onError,
}: {
  room: Room;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const openTasks = room.agentTasks.filter((task) => task.status !== "done");
  const inviteText = useMemo(() => {
    const taskSummary = openTasks.length === 0
      ? "まだ未完了タスクはありません。まずルームを読み、必要な確認事項を提案してください。"
      : openTasks.map((task) => `- ${taskKindLabels[task.kind]}: ${task.instruction}`).join("\n");

    return [
      "Spark RoomのPurin（プロダクト戦略担当）として、チームに参加してください。",
      `ルームID: ${room.id}`,
      "",
      "最初に次の順で進めてください。",
      "1. join_workspaceで displayName: Purin、role: プロダクト戦略担当 として参加する。",
      "2. read_workspace と list_agent_tasks で状況を確認する。",
      "3. 担当タスクを in_progress に更新し、根拠をチームへメッセージで伝える。",
      "4. 提案は最大3件、pendingの提案カードとして保存する。PRDはdraftとして保存する。",
      "5. 承認・却下・PRD承認は人間へ任せる。",
      "",
      "未完了タスク:",
      taskSummary,
    ].join("\n");
  }, [openTasks, room.id]);

  async function handleCopyInvite(): Promise<void> {
    try {
      await copyText(inviteText);
      onNotice("Purinへの参加依頼文をコピーしました。Kiroのチャットへ貼り付けてください。");
    } catch {
      onError("参加依頼文をコピーできませんでした。テキストを選択してコピーしてください。");
    }
  }

  return (
    <section className="panel-card invite-panel" aria-labelledby="invite-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">KIRO TEAMMATE</p>
          <h2 id="invite-title">Purinを招待</h2>
        </div>
      </div>
      <p className="muted-copy">
        ブラウザーからKiroを自動起動することはできません。参加依頼をコピーしてKiroへ渡すと、MCP経由で同じルームへ参加できます。
      </p>
      <p className="room-id-display"><code>{room.id}</code></p>
      <p className="invite-task-count">未完了タスク: <strong>{openTasks.length}件</strong></p>
      <textarea className="invite-text" value={inviteText} readOnly aria-label="Purinへの参加依頼文" rows={10} />
      <button className="primary-button wide-button" type="button" onClick={() => void handleCopyInvite()}>
        参加依頼をコピー
      </button>
    </section>
  );
}

function IdeaBoard({
  room,
  currentMember,
  disabled,
  onChange,
}: {
  room: Room;
  currentMember: Member;
  disabled: boolean;
  onChange: (operation: RoomOperation) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<BoardColumn, string>>({
    problem: "",
    user: "",
    idea: "",
    decision: "",
  });

  async function handleCreateCard(event: FormEvent<HTMLFormElement>, column: BoardColumn): Promise<void> {
    event.preventDefault();
    const content = drafts[column].trim();

    if (content.length === 0) {
      return;
    }

    await onChange(() => sparkRoomApi.createHumanCard({
      roomId: room.id,
      authorId: currentMember.id,
      column,
      content,
    }));
    setDrafts((current) => ({ ...current, [column]: "" }));
  }

  return (
    <section className="board-section" aria-labelledby="board-title">
      <div className="section-heading board-heading">
        <div>
          <p className="section-kicker">COLLABORATION BOARD</p>
          <h2 id="board-title">アイデアを、決められる形にする</h2>
        </div>
        <p className="muted-copy">白いカードはチームの確定情報、紫のカードはPurinの承認待ち提案です。</p>
      </div>
      <div className="idea-board">
        {boardColumnMetadata.map((column) => {
          const cards = room.cards.filter((card) => card.column === column.id);
          return (
            <section className="board-column" key={column.id} aria-labelledby={`column-${column.id}`}>
              <div className="column-heading">
                <span className="column-index">{String(boardColumnMetadata.indexOf(column) + 1).padStart(2, "0")}</span>
                <div>
                  <h3 id={`column-${column.id}`}>{column.title}</h3>
                  <p>{column.description}</p>
                </div>
              </div>
              <div className="card-stack">
                {cards.length === 0 ? <p className="empty-board-copy">まだカードはありません。</p> : null}
                {cards.map((card) => (
                  <BoardCard
                    key={card.id}
                    card={card}
                    room={room}
                    currentMember={currentMember}
                    disabled={disabled}
                    onChange={onChange}
                  />
                ))}
              </div>
              {currentMember.memberType === "human" ? (
                <form className="card-composer" onSubmit={(event) => void handleCreateCard(event, column.id)}>
                  <label className="sr-only" htmlFor={`new-card-${column.id}`}>{column.title}の新しいカード</label>
                  <textarea
                    id={`new-card-${column.id}`}
                    value={drafts[column.id]}
                    onChange={(event) => setDrafts((current) => ({ ...current, [column.id]: event.target.value }))}
                    placeholder={`${column.title}を追加`}
                    maxLength={500}
                    rows={3}
                  />
                  <button className="add-card-button" type="submit" disabled={disabled || drafts[column.id].trim().length === 0}>
                    カードを追加
                  </button>
                </form>
              ) : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function BoardCard({
  card,
  room,
  currentMember,
  disabled,
  onChange,
}: {
  card: Card;
  room: Room;
  currentMember: Member;
  disabled: boolean;
  onChange: (operation: RoomOperation) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(card.content);
  const author = room.members.find((member) => member.id === card.authorId);
  const isAgentCard = author?.memberType === "agent";
  const canDecide = currentMember.memberType === "human" && card.proposalStatus === "pending" && isAgentCard;
  const canEdit = currentMember.memberType === "human" && card.proposalStatus === "approved" && author?.memberType === "human";

  useEffect(() => {
    setContent(card.content);
  }, [card.content, card.id]);

  async function saveEdit(): Promise<void> {
    const nextContent = content.trim();
    if (nextContent.length === 0) {
      return;
    }

    await onChange(() => sparkRoomApi.updateHumanCard({
      roomId: room.id,
      cardId: card.id,
      actorId: currentMember.id,
      content: nextContent,
    }));
    setEditing(false);
  }

  return (
    <article className={`idea-card card-status-${card.proposalStatus} ${isAgentCard ? "agent-card" : "human-card"}`}>
      <div className="card-meta">
        <span>{isAgentCard ? "Purin" : "チーム"}</span>
        <span className={`proposal-badge proposal-${card.proposalStatus}`}>
          {card.proposalStatus === "pending" ? "承認待ち" : card.proposalStatus === "approved" ? "確定" : "却下済み"}
        </span>
      </div>
      {editing ? (
        <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={500} rows={4} />
      ) : (
        <p className="card-content">{card.content}</p>
      )}
      {card.rationale !== null ? <p className="card-rationale"><strong>根拠:</strong> {card.rationale}</p> : null}
      <p className="card-author">{author?.displayName ?? "不明な参加者"} · {formatDate(card.updatedAt)}</p>
      {canDecide ? (
        <div className="card-actions">
          <button
            className="approve-button"
            type="button"
            disabled={disabled}
            onClick={() => void onChange(() => sparkRoomApi.decideProposal({
              roomId: room.id,
              cardId: card.id,
              actorId: currentMember.id,
              proposalStatus: "approved",
            }))}
          >
            承認する
          </button>
          <button
            className="reject-button"
            type="button"
            disabled={disabled}
            onClick={() => void onChange(() => sparkRoomApi.decideProposal({
              roomId: room.id,
              cardId: card.id,
              actorId: currentMember.id,
              proposalStatus: "rejected",
            }))}
          >
            却下する
          </button>
        </div>
      ) : null}
      {canEdit ? (
        editing ? (
          <div className="card-actions">
            <button className="approve-button" type="button" disabled={disabled || content.trim().length === 0} onClick={() => void saveEdit()}>
              保存
            </button>
            <button className="text-button" type="button" onClick={() => { setContent(card.content); setEditing(false); }}>
              キャンセル
            </button>
          </div>
        ) : (
          <div className="card-actions card-actions-muted">
            <button className="text-button" type="button" onClick={() => setEditing(true)}>編集</button>
            <button
              className="danger-text-button"
              type="button"
              disabled={disabled}
              onClick={() => void onChange(() => sparkRoomApi.deleteHumanCard({
                roomId: room.id,
                cardId: card.id,
                actorId: currentMember.id,
              }))}
            >
              削除
            </button>
          </div>
        )
      ) : null}
    </article>
  );
}

function AgentTaskPanel({
  room,
  currentMember,
  disabled,
  onChange,
}: {
  room: Room;
  currentMember: Member;
  disabled: boolean;
  onChange: (operation: RoomOperation) => Promise<void>;
}) {
  const [kind, setKind] = useState<AgentTaskKind>("proposal");
  const [instruction, setInstruction] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const agents = room.members.filter((member) => member.memberType === "agent" && member.status === "active");

  async function createTask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const taskInstruction = instruction.trim();
    if (taskInstruction.length === 0) {
      return;
    }

    await onChange(() => sparkRoomApi.createAgentTask({
      roomId: room.id,
      createdBy: currentMember.id,
      kind,
      instruction: taskInstruction,
      assigneeId: assigneeId || null,
    }));
    setInstruction("");
  }

  return (
    <section className="panel-card" aria-labelledby="tasks-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">AGENT WORK</p>
          <h2 id="tasks-title">Purinへの依頼</h2>
        </div>
        <span className="count-badge">{room.agentTasks.filter((task) => task.status !== "done").length}</span>
      </div>
      {currentMember.memberType === "human" ? (
        <form className="task-form" onSubmit={(event) => void createTask(event)}>
          <label>
            依頼の種類
            <select value={kind} onChange={(event) => setKind(event.target.value as AgentTaskKind)}>
              {(Object.keys(taskKindLabels) as AgentTaskKind[]).map((taskKind) => (
                <option key={taskKind} value={taskKind}>{taskKindLabels[taskKind]}</option>
              ))}
            </select>
          </label>
          <label>
            担当エージェント
            <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
              <option value="">未割り当て（Purinが引き受ける）</option>
              {agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.displayName}</option>)}
            </select>
          </label>
          <label>
            依頼内容
            <textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              maxLength={1000}
              rows={4}
              placeholder="例: 学生向けの食材ロス削減アプリについて、実現可能なアイデアを3件まで提案して"
            />
          </label>
          <button className="primary-button wide-button" type="submit" disabled={disabled || instruction.trim().length === 0}>
            Purinへ依頼を追加
          </button>
        </form>
      ) : null}
      <ul className="task-list">
        {room.agentTasks.length === 0 ? <li className="empty-copy">まだ依頼はありません。Purinに最初の仕事を渡しましょう。</li> : null}
        {room.agentTasks.slice().reverse().map((task) => (
          <li className={`task-item task-${task.status}`} key={task.id}>
            <div className="task-row">
              <span className="task-kind">{taskKindLabels[task.kind]}</span>
              <span className="task-status">{taskStatusLabels[task.status]}</span>
            </div>
            <p>{task.instruction}</p>
            <small>担当: {task.assigneeId === null ? "未割り当て" : memberName(room, task.assigneeId)}</small>
            {task.resultSummary !== null ? <p className="task-result"><strong>結果:</strong> {task.resultSummary}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MessagePanel({
  room,
  currentMember,
  disabled,
  onChange,
}: {
  room: Room;
  currentMember: Member;
  disabled: boolean;
  onChange: (operation: RoomOperation) => Promise<void>;
}) {
  const [message, setMessage] = useState("");

  async function submitMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const content = message.trim();
    if (content.length === 0) {
      return;
    }

    await onChange(() => sparkRoomApi.createMessage({
      roomId: room.id,
      authorId: currentMember.id,
      content,
    }));
    setMessage("");
  }

  return (
    <section className="panel-card" aria-labelledby="messages-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">TEAM NOTES</p>
          <h2 id="messages-title">チームメッセージ</h2>
        </div>
      </div>
      <ul className="message-list">
        {room.messages.length === 0 ? <li className="empty-copy">メッセージはまだありません。</li> : null}
        {room.messages.slice(-6).map((message) => (
          <li key={message.id}>
            <p><strong>{memberName(room, message.authorId)}</strong><small>{formatDate(message.createdAt)}</small></p>
            <span>{message.content}</span>
          </li>
        ))}
      </ul>
      <form className="message-form" onSubmit={(event) => void submitMessage(event)}>
        <label className="sr-only" htmlFor="team-message">チームへのメッセージ</label>
        <textarea
          id="team-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Purinに補足したいこと、チームへ残す判断材料を入力"
        />
        <button className="secondary-button wide-button" type="submit" disabled={disabled || message.trim().length === 0}>送信</button>
      </form>
    </section>
  );
}

function ActivityLog({ room }: { room: Room }) {
  return (
    <section className="panel-card activity-panel" aria-labelledby="activity-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">SHARED HISTORY</p>
          <h2 id="activity-title">活動ログ</h2>
        </div>
      </div>
      <ol className="activity-list">
        {room.activities.length === 0 ? <li className="empty-copy">活動はまだありません。</li> : null}
        {room.activities.slice().reverse().slice(0, 12).map((activity) => (
          <li key={activity.id}>
            <span className="activity-dot" aria-hidden="true" />
            <div>
              <p>{activity.summary}</p>
              <small>{formatDate(activity.createdAt)}</small>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PrdPanel({
  room,
  currentMember,
  disabled,
  onChange,
  onNotice,
  onError,
}: {
  room: Room;
  currentMember: Member;
  disabled: boolean;
  onChange: (operation: RoomOperation) => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [content, setContent] = useState(room.prd?.content ?? "");
  const prd = room.prd;

  useEffect(() => {
    setContent(room.prd?.content ?? "");
  }, [room.prd?.content, room.prd?.updatedAt]);

  async function savePrd(status: PrdStatus): Promise<void> {
    if (prd === null || content.trim().length === 0) {
      return;
    }

    await onChange(() => sparkRoomApi.updatePrd({
      roomId: room.id,
      actorId: currentMember.id,
      content: content.trim(),
      status,
    }));
  }

  async function copyPrd(): Promise<void> {
    if (prd === null) {
      return;
    }

    try {
      await copyText(prd.content);
      onNotice("承認済みPRDをコピーしました。提案書やIssueへ貼り付けられます。");
    } catch {
      onError("PRDをコピーできませんでした。本文を選択してコピーしてください。");
    }
  }

  return (
    <section className="prd-panel" aria-labelledby="prd-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">FINAL OUTPUT</p>
          <h2 id="prd-title">PRD（プロダクト要件定義）</h2>
        </div>
        {prd === null ? <span className="proposal-badge proposal-pending">草案待ち</span> : <span className={`prd-status prd-${prd.status}`}>{prdStatusLabels[prd.status]}</span>}
      </div>
      {prd === null ? (
        <div className="prd-empty-state">
          <h3>まだPRD草案はありません</h3>
          <p>右の「Purinへの依頼」で<strong>PRD草案</strong>タスクを作成し、承認済みのカードを基に草案を作るよう依頼してください。</p>
        </div>
      ) : (
        <>
          <p className="muted-copy">作成: {memberName(room, prd.createdBy)} · 最終更新: {memberName(room, prd.updatedBy)} · {formatDate(prd.updatedAt)}</p>
          <label className="sr-only" htmlFor="prd-content">PRD本文</label>
          <textarea
            id="prd-content"
            className="prd-editor"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            readOnly={prd.status === "approved" || currentMember.memberType !== "human"}
            maxLength={20_000}
            rows={18}
          />
          {currentMember.memberType === "human" ? (
            <div className="prd-actions">
              {prd.status === "draft" ? (
                <>
                  <button className="secondary-button" type="button" disabled={disabled || content.trim().length === 0} onClick={() => void savePrd("draft")}>草案を保存</button>
                  <button className="approve-button" type="button" disabled={disabled || content.trim().length === 0} onClick={() => void savePrd("approved")}>人間として承認</button>
                  <button className="reject-button" type="button" disabled={disabled || content.trim().length === 0} onClick={() => void savePrd("returned")}>差し戻す</button>
                </>
              ) : null}
              {prd.status === "returned" ? <p className="returned-copy">差し戻し済みです。Purinが内容を見直して新しい草案を保存するのを待ってください。</p> : null}
              {prd.status === "approved" ? (
                <>
                  <button className="secondary-button" type="button" onClick={() => void copyPrd()}>Markdownをコピー</button>
                  <button className="primary-button" type="button" onClick={() => downloadMarkdown(room.name, prd.content)}>Markdownを出力</button>
                  <button className="text-button" type="button" disabled={disabled} onClick={() => void savePrd("returned")}>差し戻して再検討</button>
                </>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
