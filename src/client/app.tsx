import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { RoomWorkspace } from "./components/workspace.js";
import { ApiClientError, sparkRoomApi } from "./lib/api-client.js";
import { subscribeToRoomEvents } from "./lib/room-events.js";
import type { Member, Room } from "../shared/types.js";

type ServerStatus = "checking" | "online" | "offline";
type RealtimeStatus = "connecting" | "live" | "reconnecting";

function roomIdFromLocation(): string | null {
  const match = window.location.pathname.match(/^\/rooms\/([^/]+)$/);
  return match === null ? null : decodeURIComponent(match[1]);
}

function memberStorageKey(roomId: string): string {
  return `spark-room:member:${roomId}`;
}

function toMessage(error: unknown): string {
  return error instanceof ApiClientError
    ? error.message
    : "処理中に問題が発生しました。共有サーバーを確認して再試行してください。";
}

function isServerConnectionFailure(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) {
    return false;
  }

  return error.message === "共有サーバーへ接続できません。サーバーを起動してから再試行してください。"
    || error.message === "共有サーバーの応答を読み取れませんでした。";
}

const serverStatusMessage: Record<ServerStatus, string> = {
  checking: "共有サーバーへ接続を確認しています。",
  online: "共有サーバーに接続できました。",
  offline: "共有サーバーに接続できません。ターミナルで npm run dev を実行してから再試行してください。",
};

export function App() {
  const [routeRoomId, setRouteRoomId] = useState<string | null>(() => roomIdFromLocation());
  const [serverStatus, setServerStatus] = useState<ServerStatus>("checking");
  const [room, setRoom] = useState<Room | null>(null);
  const [currentMemberId, setCurrentMemberId] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [isLoadingRoom, setIsLoadingRoom] = useState(false);

  const currentMember = useMemo(() => room?.members.find((member) => member.id === currentMemberId) ?? null, [room, currentMemberId]);

  const checkServer = useCallback(async (): Promise<void> => {
    setServerStatus("checking");

    try {
      const isHealthy = await sparkRoomApi.checkHealth();
      setServerStatus(isHealthy ? "online" : "offline");
    } catch {
      setServerStatus("offline");
    }
  }, []);

  const refreshRoom = useCallback(async (): Promise<void> => {
    if (routeRoomId === null) {
      return;
    }

    const latestRoom = await sparkRoomApi.getRoom(routeRoomId);
    setRoom(latestRoom);
    setServerStatus("online");

    const savedMemberId = window.sessionStorage.getItem(memberStorageKey(routeRoomId));
    const savedMember = latestRoom.members.find((member) => member.id === savedMemberId && member.status === "active");

    if (savedMember === undefined) {
      setCurrentMemberId(null);
      if (savedMemberId !== null) {
        window.sessionStorage.removeItem(memberStorageKey(routeRoomId));
      }
    } else {
      setCurrentMemberId(savedMember.id);
    }
  }, [routeRoomId]);

  useEffect(() => {
    void checkServer();
  }, [checkServer]);

  useEffect(() => {
    if (routeRoomId === null) {
      setRoom(null);
      setCurrentMemberId(null);
      setErrorMessage(null);
      return;
    }

    let active = true;
    setIsLoadingRoom(true);
    setRoom(null);
    setCurrentMemberId(null);
    setRealtimeStatus("connecting");

    void refreshRoom()
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setErrorMessage(toMessage(error));
        setServerStatus("offline");
      })
      .finally(() => {
        if (active) {
          setIsLoadingRoom(false);
        }
      });

    return () => {
      active = false;
    };
  }, [refreshRoom, routeRoomId]);

  useEffect(() => {
    if (routeRoomId === null || currentMemberId === null) {
      return undefined;
    }

    let refreshTimer: number | undefined;
    return subscribeToRoomEvents(routeRoomId, {
      onConnected: () => {
        setRealtimeStatus("live");
      },
      onUpdated: () => {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => {
          void refreshRoom().catch((error: unknown) => setErrorMessage(toMessage(error)));
        }, 120);
      },
      onDisconnected: () => {
        setRealtimeStatus("reconnecting");
      },
    });
  }, [currentMemberId, refreshRoom, routeRoomId]);

  function navigateToRoom(roomId: string): void {
    window.history.pushState({}, "", `/rooms/${encodeURIComponent(roomId)}`);
    setRouteRoomId(roomId);
    setErrorMessage(null);
    setNoticeMessage(null);
  }

  function navigateHome(): void {
    window.history.pushState({}, "", "/");
    setRouteRoomId(null);
    setNoticeMessage(null);
  }

  useEffect(() => {
    const onPopState = (): void => {
      setRouteRoomId(roomIdFromLocation());
      setErrorMessage(null);
      setNoticeMessage(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  async function createRoom(input: { name: string; creatorName: string }): Promise<void> {
    try {
      const result = await sparkRoomApi.createRoom(input);
      window.sessionStorage.setItem(memberStorageKey(result.room.id), result.member.id);
      setRoom(result.room);
      setCurrentMemberId(result.member.id);
      setServerStatus("online");
      navigateToRoom(result.room.id);
    } catch (error: unknown) {
      setErrorMessage(toMessage(error));
      setServerStatus(isServerConnectionFailure(error) ? "offline" : "online");
    }
  }

  async function joinRoom(input: { displayName: string; role: string }): Promise<void> {
    if (routeRoomId === null) {
      return;
    }

    try {
      const result = await sparkRoomApi.joinRoom({ roomId: routeRoomId, ...input });
      window.sessionStorage.setItem(memberStorageKey(routeRoomId), result.member.id);
      setRoom(result.room);
      setCurrentMemberId(result.member.id);
      setServerStatus("online");
      setNoticeMessage("ルームへ参加しました。人間としてカード、依頼、承認を操作できます。");
    } catch (error: unknown) {
      setErrorMessage(toMessage(error));
      setServerStatus(isServerConnectionFailure(error) ? "offline" : "online");
    }
  }

  return (
    <>
      {errorMessage !== null ? (
        <div className="app-notice notice-error" role="alert">
          <span>{errorMessage}</span>
          <button type="button" onClick={() => setErrorMessage(null)} aria-label="エラーを閉じる">閉じる</button>
        </div>
      ) : null}
      {noticeMessage !== null ? (
        <div className="app-notice notice-success" role="status">
          <span>{noticeMessage}</span>
          <button type="button" onClick={() => setNoticeMessage(null)} aria-label="お知らせを閉じる">閉じる</button>
        </div>
      ) : null}

      {routeRoomId === null ? (
        <HomePage
          serverStatus={serverStatus}
          onCheckServer={checkServer}
          onCreateRoom={createRoom}
        />
      ) : isLoadingRoom || room === null ? (
        <LoadingRoom
          roomId={routeRoomId}
          serverStatus={serverStatus}
          onRetry={() => void refreshRoom().catch((error: unknown) => setErrorMessage(toMessage(error)))}
          onHome={navigateHome}
        />
      ) : currentMember === null ? (
        <JoinRoomPage room={room} onJoin={joinRoom} onHome={navigateHome} />
      ) : (
        <RoomWorkspace
          room={room}
          currentMember={currentMember}
          realtimeStatus={realtimeStatus}
          onRoomChanged={(updatedRoom) => { setRoom(updatedRoom); setServerStatus("online"); }}
          onError={setErrorMessage}
          onNotice={setNoticeMessage}
          onRefresh={async () => {
            try {
              await refreshRoom();
              setNoticeMessage("最新状態へ更新しました。");
            } catch (error: unknown) {
              setErrorMessage(toMessage(error));
            }
          }}
          onLeave={navigateHome}
        />
      )}
    </>
  );
}

function HomePage({
  serverStatus,
  onCheckServer,
  onCreateRoom,
}: {
  serverStatus: ServerStatus;
  onCheckServer: () => Promise<void>;
  onCreateRoom: (input: { name: string; creatorName: string }) => Promise<void>;
}) {
  const [roomName, setRoomName] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (roomName.trim().length === 0 || creatorName.trim().length === 0) {
      return;
    }

    setSubmitting(true);
    try {
      await onCreateRoom({ name: roomName.trim(), creatorName: creatorName.trim() });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="landing-shell">
      <section className="landing-hero" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">DAY 2 · AGENTS × HUMANS</p>
          <h1 id="page-title">Spark Room</h1>
          <p className="lead">
            人間とKiroエージェントが、同じ共有ルームで考え、判断し、使えるPRDまで完成させるワークスペースです。
          </p>
        </div>
        <div className="hero-orbit" aria-hidden="true"><span /><span /><span /></div>
      </section>

      <section className={`server-card server-${serverStatus}`} aria-live="polite">
        <div>
          <p className="section-kicker">SHARED SERVER</p>
          <p className="server-status-copy">{serverStatusMessage[serverStatus]}</p>
          {serverStatus === "offline" ? <p className="muted-copy">復旧手順: ターミナルを2つ開き、<code>npm run dev:server</code> と <code>npm run dev:client</code> を実行します。</p> : null}
        </div>
        <button className="secondary-button" type="button" onClick={() => void onCheckServer()}>接続を再確認</button>
      </section>

      <section className="landing-grid">
        <article className="create-room-card" aria-labelledby="create-room-title">
          <p className="section-kicker">START A ROOM</p>
          <h2 id="create-room-title">チームの作業部屋をつくる</h2>
          <p className="muted-copy">ルームを作成すると、共有URLとPurinへの参加依頼文が用意されます。</p>
          <form className="create-room-form" onSubmit={(event) => void submit(event)}>
            <label>
              ルーム名
              <input value={roomName} onChange={(event) => setRoomName(event.target.value)} maxLength={80} placeholder="例: 学生の食材ロスを減らすアプリ" autoComplete="off" />
            </label>
            <label>
              あなたの表示名
              <input value={creatorName} onChange={(event) => setCreatorName(event.target.value)} maxLength={40} placeholder="例: ひろ" autoComplete="name" />
            </label>
            <button className="primary-button wide-button" type="submit" disabled={submitting || serverStatus !== "online" || roomName.trim().length === 0 || creatorName.trim().length === 0}>
              {submitting ? "ルームを作成中…" : "Spark Roomを作成"}
            </button>
          </form>
        </article>

        <div className="how-it-works">
          <p className="section-kicker">HOW IT WORKS</p>
          <ol>
            <li><span>01</span><div><strong>人間が課題を書く</strong><p>ボードに課題、利用者、アイデア、決定を集めます。</p></div></li>
            <li><span>02</span><div><strong>Purinを招待する</strong><p>MCP経由で同じルームへ参加し、仕事を引き受けます。</p></div></li>
            <li><span>03</span><div><strong>人間が成果物を決める</strong><p>提案を承認し、PRDを確認して最終出力へ進みます。</p></div></li>
          </ol>
        </div>
      </section>
    </main>
  );
}

function LoadingRoom({
  roomId,
  serverStatus,
  onRetry,
  onHome,
}: {
  roomId: string;
  serverStatus: ServerStatus;
  onRetry: () => void;
  onHome: () => void;
}) {
  return (
    <main className="loading-shell">
      <p className="eyebrow">SPARK ROOM</p>
      <h1>ルームを準備しています</h1>
      <p>ルームID: <code>{roomId}</code></p>
      <p className={serverStatus === "offline" ? "offline-copy" : "muted-copy"}>{serverStatusMessage[serverStatus]}</p>
      <div className="loading-actions">
        <button className="primary-button" type="button" onClick={onRetry}>もう一度読み込む</button>
        <button className="text-button" type="button" onClick={onHome}>トップへ戻る</button>
      </div>
    </main>
  );
}

function JoinRoomPage({
  room,
  onJoin,
  onHome,
}: {
  room: Room;
  onJoin: (input: { displayName: string; role: string }) => Promise<void>;
  onHome: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("企画メンバー");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (displayName.trim().length === 0 || role.trim().length === 0) {
      return;
    }

    setSubmitting(true);
    try {
      await onJoin({ displayName: displayName.trim(), role: role.trim() });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="join-shell">
      <section className="join-card" aria-labelledby="join-title">
        <p className="eyebrow">JOIN SHARED WORKSPACE</p>
        <h1 id="join-title">{room.name}</h1>
        <p className="lead">この共有ルームへ人間メンバーとして参加します。AIエージェントの招待は、ルーム内のPurinパネルから行えます。</p>
        <form className="create-room-form" onSubmit={(event) => void submit(event)}>
          <label>
            表示名
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} placeholder="例: あかり" autoComplete="name" />
          </label>
          <label>
            チームでの役割
            <input value={role} onChange={(event) => setRole(event.target.value)} maxLength={60} placeholder="例: リサーチ担当" />
          </label>
          <button className="primary-button wide-button" type="submit" disabled={submitting || displayName.trim().length === 0 || role.trim().length === 0}>
            {submitting ? "参加中…" : "このルームへ参加"}
          </button>
        </form>
        <button className="text-button" type="button" onClick={onHome}>トップへ戻る</button>
      </section>
    </main>
  );
}
