import {
  agentTaskKinds,
  agentTaskStatuses,
  boardColumns,
  memberStatuses,
  memberTypes,
  prdStatuses,
  proposalStatuses,
  type AgentTaskKind,
  type AgentTaskStatus,
  type BoardColumn,
  type CreateAgentProposalInput,
  type CreateAgentTaskInput,
  type CreateHumanCardInput,
  type CreateMemberInput,
  type CreateMessageInput,
  type CreateRoomInput,
  type DecideProposalInput,
  type DeleteHumanCardInput,
  type MemberStatus,
  type MemberType,
  type PrdStatus,
  type ProposalStatus,
  type SavePrdDraftInput,
  type UpdateAgentTaskInput,
  type UpdateHumanCardInput,
  type UpdateMemberStatusInput,
  type UpdatePrdInput,
} from "./types.js";

const identifierPattern = /^[A-Za-z0-9_-]+$/;

const taskStatusTransitions: Record<AgentTaskStatus, readonly AgentTaskStatus[]> = {
  todo: ["in_progress"],
  in_progress: ["todo", "done"],
  done: [],
};

const prdStatusTransitions: Record<PrdStatus, readonly PrdStatus[]> = {
  draft: ["approved", "returned"],
  approved: ["returned"],
  returned: ["draft"],
};

export class InputValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "InputValidationError";
    this.field = field;
  }
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InputValidationError(field, `${field}はオブジェクト形式で指定してください。`);
  }

  return value as Record<string, unknown>;
}

function readText(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== "string") {
    throw new InputValidationError(field, `${field}は文字列で指定してください。`);
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new InputValidationError(field, `${field}を入力してください。`);
  }

  if (normalized.length > maximumLength) {
    throw new InputValidationError(field, `${field}は${maximumLength}文字以内で入力してください。`);
  }

  return normalized;
}

function readOptionalText(value: unknown, field: string, maximumLength: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return readText(value, field, maximumLength);
}

function readIdentifier(value: unknown, field: string): string {
  const identifier = readText(value, field, 128);

  if (!identifierPattern.test(identifier)) {
    throw new InputValidationError(field, `${field}には英数字、ハイフン、アンダースコアだけを使用してください。`);
  }

  return identifier;
}

function readEnum<T extends string>(
  value: unknown,
  field: string,
  allowedValues: readonly T[],
): T {
  if (typeof value !== "string" || !allowedValues.includes(value as T)) {
    throw new InputValidationError(field, `${field}の値が正しくありません。`);
  }

  return value as T;
}

export function parseRoomId(value: unknown): string {
  return readIdentifier(value, "roomId");
}

export function parseMemberId(value: unknown): string {
  return readIdentifier(value, "memberId");
}

export function parseCardId(value: unknown): string {
  return readIdentifier(value, "cardId");
}

export function parseAgentTaskId(value: unknown): string {
  return readIdentifier(value, "taskId");
}

export function parseAgentTaskStatus(value: unknown): AgentTaskStatus {
  return readEnum<AgentTaskStatus>(value, "タスク状態", agentTaskStatuses);
}

export function parseCreateRoomInput(value: unknown): CreateRoomInput {
  const record = asRecord(value, "ルーム作成内容");

  return {
    name: readText(record.name, "ルーム名", 80),
    creatorName: readText(record.creatorName, "表示名", 40),
  };
}

export function parseCreateMemberInput(value: unknown): CreateMemberInput {
  const record = asRecord(value, "参加者情報");

  return {
    displayName: readText(record.displayName, "表示名", 40),
    memberType: readEnum<MemberType>(record.memberType, "参加者種別", memberTypes),
    role: readText(record.role, "役割", 60),
  };
}

export function parseUpdateMemberStatusInput(value: unknown): UpdateMemberStatusInput {
  const record = asRecord(value, "参加者状態の更新内容");

  return {
    actorId: parseMemberId(record.actorId),
    status: readEnum<MemberStatus>(record.status, "参加者状態", memberStatuses),
  };
}

export function parseCreateHumanCardInput(value: unknown): CreateHumanCardInput {
  const record = asRecord(value, "カード作成内容");

  return {
    authorId: parseMemberId(record.authorId),
    column: readEnum<BoardColumn>(record.column, "ボード列", boardColumns),
    content: readText(record.content, "カード本文", 500),
  };
}

export function parseCreateAgentProposalInput(value: unknown): CreateAgentProposalInput {
  const record = asRecord(value, "AI提案内容");

  return {
    authorId: parseMemberId(record.authorId),
    taskId: parseAgentTaskId(record.taskId),
    column: readEnum<BoardColumn>(record.column, "ボード列", boardColumns),
    content: readText(record.content, "カード本文", 500),
    rationale: readText(record.rationale, "提案理由", 600),
  };
}

export function parseUpdateHumanCardInput(value: unknown): UpdateHumanCardInput {
  const record = asRecord(value, "カード更新内容");

  return {
    actorId: parseMemberId(record.actorId),
    content: readText(record.content, "カード本文", 500),
  };
}

export function parseDeleteHumanCardInput(value: unknown): DeleteHumanCardInput {
  const record = asRecord(value, "カード削除内容");

  return {
    actorId: parseMemberId(record.actorId),
  };
}

export function parseDecideProposalInput(value: unknown): DecideProposalInput {
  const record = asRecord(value, "提案の判断内容");
  const proposalStatus = readEnum<ProposalStatus>(record.proposalStatus, "提案状態", proposalStatuses);

  if (proposalStatus === "pending") {
    throw new InputValidationError("提案状態", "提案は承認または却下してください。");
  }

  return {
    actorId: parseMemberId(record.actorId),
    proposalStatus,
  };
}

export function parseCreateMessageInput(value: unknown): CreateMessageInput {
  const record = asRecord(value, "メッセージ内容");

  return {
    authorId: parseMemberId(record.authorId),
    content: readText(record.content, "メッセージ", 1_000),
  };
}

export function parseCreateAgentTaskInput(value: unknown): CreateAgentTaskInput {
  const record = asRecord(value, "エージェントタスク内容");
  const assigneeId = record.assigneeId === undefined || record.assigneeId === null
    ? null
    : parseMemberId(record.assigneeId);

  return {
    createdBy: parseMemberId(record.createdBy),
    kind: readEnum<AgentTaskKind>(record.kind, "タスク種別", agentTaskKinds),
    instruction: readText(record.instruction, "依頼内容", 1_000),
    assigneeId,
  };
}

export function parseUpdateAgentTaskInput(value: unknown): UpdateAgentTaskInput {
  const record = asRecord(value, "エージェントタスク更新内容");

  return {
    actorId: parseMemberId(record.actorId),
    status: readEnum<AgentTaskStatus>(record.status, "タスク状態", agentTaskStatuses),
    resultSummary: readOptionalText(record.resultSummary, "結果概要", 1_000),
  };
}

export function parseSavePrdDraftInput(value: unknown): SavePrdDraftInput {
  const record = asRecord(value, "PRD草案内容");

  return {
    actorId: parseMemberId(record.actorId),
    taskId: parseAgentTaskId(record.taskId),
    content: readText(record.content, "PRD本文", 20_000),
  };
}

export function parseUpdatePrdInput(value: unknown): UpdatePrdInput {
  const record = asRecord(value, "PRD更新内容");

  return {
    actorId: parseMemberId(record.actorId),
    content: readText(record.content, "PRD本文", 20_000),
    status: readEnum<PrdStatus>(record.status, "PRD状態", prdStatuses),
  };
}

export function assertAgentTaskStatusTransition(
  currentStatus: AgentTaskStatus,
  nextStatus: AgentTaskStatus,
): void {
  if (currentStatus === nextStatus) {
    return;
  }

  if (!taskStatusTransitions[currentStatus].includes(nextStatus)) {
    throw new InputValidationError(
      "タスク状態",
      `タスク状態を${currentStatus}から${nextStatus}へ変更できません。`,
    );
  }
}

export function assertProposalStatusTransition(
  currentStatus: ProposalStatus,
  nextStatus: ProposalStatus,
): void {
  if (currentStatus !== "pending" || nextStatus === "pending") {
    throw new InputValidationError("提案状態", "保留中の提案だけを承認または却下できます。");
  }
}

export function assertPrdStatusTransition(currentStatus: PrdStatus, nextStatus: PrdStatus): void {
  if (currentStatus === nextStatus) {
    return;
  }

  if (!prdStatusTransitions[currentStatus].includes(nextStatus)) {
    throw new InputValidationError(
      "PRD状態",
      `PRD状態を${currentStatus}から${nextStatus}へ変更できません。`,
    );
  }
}
