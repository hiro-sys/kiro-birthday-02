import {
  activityTypes,
  agentTaskKinds,
  agentTaskStatuses,
  boardColumns,
  memberStatuses,
  memberTypes,
  prdStatuses,
  proposalStatuses,
  type AgentTask,
  type AgentTaskKind,
  type AgentTaskStatus,
  type BoardColumn,
  type Card,
  type Member,
  type MemberType,
  type Message,
  type PrdDocument,
  type PrdStatus,
  type Room,
} from "../../shared/types.js";

type JsonRecord = Record<string, unknown>;

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: JsonRecord;
};

export class ApiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiClientError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnumValue<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isMember(value: unknown): value is Member {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.displayName === "string"
    && isEnumValue(value.memberType, memberTypes)
    && typeof value.role === "string"
    && isEnumValue(value.status, memberStatuses)
    && typeof value.joinedAt === "string";
}

function isCard(value: unknown): value is Card {
  return isRecord(value)
    && typeof value.id === "string"
    && isEnumValue(value.column, boardColumns)
    && typeof value.content === "string"
    && typeof value.authorId === "string"
    && isEnumValue(value.proposalStatus, proposalStatuses)
    && (typeof value.rationale === "string" || value.rationale === null)
    && (typeof value.agentTaskId === "string" || value.agentTaskId === null)
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string";
}

function isMessage(value: unknown): value is Message {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.authorId === "string"
    && typeof value.content === "string"
    && typeof value.createdAt === "string";
}

function isAgentTask(value: unknown): value is AgentTask {
  return isRecord(value)
    && typeof value.id === "string"
    && isEnumValue(value.kind, agentTaskKinds)
    && typeof value.instruction === "string"
    && (typeof value.assigneeId === "string" || value.assigneeId === null)
    && isEnumValue(value.status, agentTaskStatuses)
    && typeof value.createdBy === "string"
    && (typeof value.resultSummary === "string" || value.resultSummary === null)
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string";
}

function isPrd(value: unknown): value is PrdDocument {
  return isRecord(value)
    && typeof value.content === "string"
    && isEnumValue(value.status, prdStatuses)
    && typeof value.createdBy === "string"
    && typeof value.updatedBy === "string"
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string";
}

function isRoom(value: unknown): value is Room {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.createdAt === "string"
    && Array.isArray(value.members)
    && value.members.every(isMember)
    && Array.isArray(value.cards)
    && value.cards.every(isCard)
    && Array.isArray(value.messages)
    && value.messages.every(isMessage)
    && Array.isArray(value.agentTasks)
    && value.agentTasks.every(isAgentTask)
    && Array.isArray(value.activities)
    && value.activities.every((activity) => isRecord(activity)
      && typeof activity.id === "string"
      && typeof activity.actorId === "string"
      && isEnumValue(activity.activityType, activityTypes)
      && typeof activity.summary === "string"
      && typeof activity.createdAt === "string")
    && (value.prd === null || isPrd(value.prd));
}

function readErrorMessage(payload: unknown): string {
  if (isRecord(payload) && typeof payload.error === "string") {
    return payload.error;
  }

  return "共有サーバーとの通信に失敗しました。";
}

function requireRecord(payload: unknown): JsonRecord {
  if (!isRecord(payload)) {
    throw new ApiClientError("共有サーバーの応答形式が正しくありません。");
  }

  return payload;
}

function requireRoom(payload: unknown): Room {
  const record = requireRecord(payload);

  if (!isRoom(record.room)) {
    throw new ApiClientError("共有ルームのデータ形式が正しくありません。");
  }

  return record.room;
}

function requireRoomAndMember(payload: unknown): { room: Room; member: Member } {
  const record = requireRecord(payload);

  if (!isRoom(record.room) || !isMember(record.member)) {
    throw new ApiClientError("参加処理の応答形式が正しくありません。");
  }

  return { room: record.room, member: record.member };
}

async function request<T>(
  path: string,
  options: RequestOptions,
  parser: (payload: unknown) => T,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiClientError("共有サーバーへ接続できません。サーバーを起動してから再試行してください。");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError("共有サーバーの応答を読み取れませんでした。");
  }

  if (!response.ok) {
    throw new ApiClientError(readErrorMessage(payload));
  }

  return parser(payload);
}

function roomPath(roomId: string): string {
  return `/api/rooms/${encodeURIComponent(roomId)}`;
}

export const sparkRoomApi = {
  async checkHealth(): Promise<boolean> {
    return request("/api/health", {}, (payload) => {
      const record = requireRecord(payload);
      return record.status === "ok";
    });
  },

  createRoom(input: { name: string; creatorName: string }): Promise<{ room: Room; member: Member }> {
    return request("/api/rooms", { method: "POST", body: input }, requireRoomAndMember);
  },

  getRoom(roomId: string): Promise<Room> {
    return request(roomPath(roomId), {}, requireRoom);
  },

  joinRoom(input: { roomId: string; displayName: string; role: string }): Promise<{ room: Room; member: Member }> {
    return request(`${roomPath(input.roomId)}/members`, {
      method: "POST",
      body: {
        displayName: input.displayName,
        memberType: "human",
        role: input.role,
      },
    }, requireRoomAndMember);
  },

  createHumanCard(input: { roomId: string; authorId: string; column: BoardColumn; content: string }): Promise<Room> {
    return request(`${roomPath(input.roomId)}/cards`, {
      method: "POST",
      body: {
        mode: "human",
        authorId: input.authorId,
        column: input.column,
        content: input.content,
      },
    }, requireRoom);
  },

  updateHumanCard(input: { roomId: string; cardId: string; actorId: string; content: string }): Promise<Room> {
    return request(`${roomPath(input.roomId)}/cards/${encodeURIComponent(input.cardId)}`, {
      method: "PATCH",
      body: {
        mode: "human_edit",
        actorId: input.actorId,
        content: input.content,
      },
    }, requireRoom);
  },

  deleteHumanCard(input: { roomId: string; cardId: string; actorId: string }): Promise<Room> {
    return request(`${roomPath(input.roomId)}/cards/${encodeURIComponent(input.cardId)}`, {
      method: "DELETE",
      body: { actorId: input.actorId },
    }, requireRoom);
  },

  decideProposal(input: { roomId: string; cardId: string; actorId: string; proposalStatus: "approved" | "rejected" }): Promise<Room> {
    return request(`${roomPath(input.roomId)}/cards/${encodeURIComponent(input.cardId)}`, {
      method: "PATCH",
      body: {
        mode: "proposal_decision",
        actorId: input.actorId,
        proposalStatus: input.proposalStatus,
      },
    }, requireRoom);
  },

  createMessage(input: { roomId: string; authorId: string; content: string }): Promise<Room> {
    return request(`${roomPath(input.roomId)}/messages`, {
      method: "POST",
      body: input,
    }, requireRoom);
  },

  createAgentTask(input: {
    roomId: string;
    createdBy: string;
    kind: AgentTaskKind;
    instruction: string;
    assigneeId: string | null;
  }): Promise<Room> {
    return request(`${roomPath(input.roomId)}/agent-tasks`, {
      method: "POST",
      body: input,
    }, requireRoom);
  },

  updatePrd(input: { roomId: string; actorId: string; content: string; status: PrdStatus }): Promise<Room> {
    return request(`${roomPath(input.roomId)}/prd`, {
      method: "PUT",
      body: {
        mode: "human_update",
        actorId: input.actorId,
        content: input.content,
        status: input.status,
      },
    }, requireRoom);
  },
};

export type { MemberType };
