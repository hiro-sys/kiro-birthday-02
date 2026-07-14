import { randomUUID } from "node:crypto";
import {
  assertAgentTaskStatusTransition,
  assertPrdStatusTransition,
  assertProposalStatusTransition,
  InputValidationError,
} from "../shared/validation.js";
import type {
  Activity,
  ActivityType,
  AgentTask,
  AgentTaskStatus,
  Card,
  CreateAgentProposalInput,
  CreateAgentTaskInput,
  CreateHumanCardInput,
  CreateMemberInput,
  CreateMessageInput,
  CreateRoomInput,
  DecideProposalInput,
  DeleteHumanCardInput,
  Member,
  MemberStatus,
  Message,
  PrdDocument,
  Room,
  SavePrdDraftInput,
  UpdateAgentTaskInput,
  UpdateHumanCardInput,
  UpdateMemberStatusInput,
  UpdatePrdInput,
} from "../shared/types.js";
import { RoomServiceError } from "./errors.js";
import { RoomStore } from "./room-store.js";

export type RoomChangedEvent = {
  roomId: string;
  activity: Activity;
};

type RoomChangeListener = (event: RoomChangedEvent) => void;

type RoomMutation<T> = {
  value: T;
  activity: Activity;
};

function now(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function copyRoom(room: Room): Room {
  return structuredClone(room);
}

export class RoomService {
  private readonly listeners = new Set<RoomChangeListener>();

  constructor(private readonly roomStore: RoomStore) {}

  subscribe(listener: RoomChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async createRoom(input: CreateRoomInput): Promise<{ room: Room; creator: Member }> {
    const result = await this.roomStore.mutate((store) => {
      const createdAt = now();
      const creator: Member = {
        id: createId("member"),
        displayName: input.creatorName,
        memberType: "human",
        role: "企画メンバー",
        status: "active",
        joinedAt: createdAt,
      };
      const room: Room = {
        id: createId("room"),
        name: input.name,
        createdAt,
        members: [creator],
        cards: [],
        messages: [],
        agentTasks: [],
        activities: [],
        prd: null,
      };
      store.rooms.push(room);
      const activity = this.recordActivity(room, creator.id, "room_created", `${creator.displayName}がルームを作成しました。`);

      return {
        room,
        creator,
        activity,
      };
    });

    this.emit({ roomId: result.room.id, activity: result.activity });
    return {
      room: copyRoom(result.room),
      creator: structuredClone(result.creator),
    };
  }

  async getRoom(roomId: string): Promise<Room> {
    const store = await this.roomStore.read();
    const room = store.rooms.find((candidate) => candidate.id === roomId);

    if (room === undefined) {
      throw new RoomServiceError(404, "指定されたルームが見つかりません。新しいルームを作成してください。");
    }

    return copyRoom(room);
  }

  async listAgentTasks(roomId: string, status?: AgentTaskStatus): Promise<AgentTask[]> {
    const room = await this.getRoom(roomId);
    const tasks = status === undefined
      ? room.agentTasks
      : room.agentTasks.filter((task) => task.status === status);

    return structuredClone(tasks);
  }

  async joinMember(roomId: string, input: CreateMemberInput): Promise<{ room: Room; member: Member }> {
    const mutation = await this.mutateRoom(roomId, (room) => {
      const existingAgent = input.memberType === "agent"
        ? room.members.find((member) => member.memberType === "agent"
          && member.displayName === input.displayName
          && member.role === input.role)
        : undefined;

      if (existingAgent !== undefined) {
        existingAgent.status = "active";
        const activity = this.recordActivity(room, existingAgent.id, "member_joined", `${existingAgent.displayName}が再び参加しました。`);
        return {
          value: structuredClone(existingAgent),
          activity,
        };
      }

      const member: Member = {
        id: createId("member"),
        displayName: input.displayName,
        memberType: input.memberType,
        role: input.role,
        status: "active",
        joinedAt: now(),
      };
      room.members.push(member);
      const activity = this.recordActivity(room, member.id, "member_joined", `${member.displayName}が${member.role}として参加しました。`);

      return {
        value: structuredClone(member),
        activity,
      };
    });

    return {
      room: mutation.room,
      member: mutation.value,
    };
  }

  async updateMemberStatus(
    roomId: string,
    memberId: string,
    input: UpdateMemberStatusInput,
  ): Promise<Room> {
    const mutation = await this.mutateRoom(roomId, (room) => {
      const actor = this.requireActiveMember(room, input.actorId);
      const member = this.requireMember(room, memberId);

      if (actor.id !== member.id && actor.memberType !== "human") {
        throw new RoomServiceError(403, "ほかの参加者の状態を変更できるのは人間メンバーだけです。");
      }

      member.status = input.status;
      const activityType: ActivityType = input.status === "left" ? "member_left" : "member_joined";
      const summary = input.status === "left"
        ? `${member.displayName}が退出しました。`
        : `${member.displayName}の状態を${input.status}へ更新しました。`;
      const activity = this.recordActivity(room, actor.id, activityType, summary);

      return {
        value: undefined,
        activity,
      };
    });

    return mutation.room;
  }

  async createHumanCard(roomId: string, input: CreateHumanCardInput): Promise<{ room: Room; card: Card }> {
    const mutation = await this.mutateRoom(roomId, (room) => {
      const actor = this.requireActiveMember(room, input.authorId, "human");
      const createdAt = now();
      const card: Card = {
        id: createId("card"),
        column: input.column,
        content: input.content,
        authorId: actor.id,
        proposalStatus: "approved",
        rationale: null,
        agentTaskId: null,
        createdAt,
        updatedAt: createdAt,
      };
      room.cards.push(card);
      const activity = this.recordActivity(room, actor.id, "card_created", `${actor.displayName}がカードを追加しました。`);

      return {
        value: structuredClone(card),
        activity,
      };
    });

    return {
      room: mutation.room,
      card: mutation.value,
    };
  }

  async createAgentProposal(roomId: string, input: CreateAgentProposalInput): Promise<{ room: Room; card: Card }> {
    const mutation = await this.mutateRoom(roomId, (room) => {
      const actor = this.requireActiveMember(room, input.authorId, "agent");
      const task = this.requireAgentTask(room, input.taskId);

      if (task.kind !== "proposal") {
        throw new RoomServiceError(409, "アイデア提案は提案タスクに対してだけ追加できます。");
      }

      if (task.assigneeId !== actor.id || task.status !== "in_progress") {
        throw new RoomServiceError(403, "進行中で自分に割り当てられたタスクにだけ提案を追加できます。");
      }

      const proposalCount = room.cards.filter((card) => card.agentTaskId === task.id && card.authorId === actor.id).length;

      if (proposalCount >= 3) {
        throw new RoomServiceError(409, "1つの提案タスクで追加できる提案は3件までです。");
      }

      const createdAt = now();
      const card: Card = {
        id: createId("card"),
        column: input.column,
        content: input.content,
        authorId: actor.id,
        proposalStatus: "pending",
        rationale: input.rationale,
        agentTaskId: task.id,
        createdAt,
        updatedAt: createdAt,
      };
      room.cards.push(card);
      const activity = this.recordActivity(room, actor.id, "card_proposed", `${actor.displayName}が承認待ちの提案を追加しました。`);

      return {
        value: structuredClone(card),
        activity,
      };
    });

    return {
      room: mutation.room,
      card: mutation.value,
    };
  }

  async updateHumanCard(roomId: string, cardId: string, input: UpdateHumanCardInput): Promise<Room> {
    const mutation = await this.mutateRoom(roomId, (room) => {
      const actor = this.requireActiveMember(room, input.actorId, "human");
      const card = this.requireCard(room, cardId);
      const author = this.requireMember(room, card.authorId);

      if (author.memberType !== "human" || card.proposalStatus !== "approved") {
        throw new RoomServiceError(403, "人間メンバーが作成した確定カードだけを編集できます。");
      }

      card.content = input.content;
      card.updatedAt = now();
      const activity = this.recordActivity(room, actor.id, "card_updated", `${actor.displayName}がカードを編集しました。`);

      return {
        value: undefined,
        activity,
      };
    });

    return mutation.room;
  }

  async deleteHumanCard(roomId: string, cardId: string, input: DeleteHumanCardInput): Promise<Room> {
    const mutation = await this.mutateRoom(roomId, (room) => {
      const actor = this.requireActiveMember(room, input.actorId, "human");
      const card = this.requireCard(room, cardId);
      const author = this.requireMember(room, card.authorId);

      if (author.memberType !== "human" || card.proposalStatus !== "approved") {
        throw new RoomServiceError(403, "人間メンバーが作成した確定カードだけを削除できます。");
      }

      room.cards = room.cards.filter((candidate) => candidate.id !== card.id);
      const activity = this.recordActivity(room, actor.id, "card_deleted", `${actor.displayName}がカードを削除しました。`);

      return {
        value: undefined,
        activity,
      };
    });

    return mutation.room;
  }

  async decideProposal(roomId: string, cardId: string, input: DecideProposalInput): Promise<Room> {
    const mutation = await this.mutateRoom(roomId, (room) => {
      const actor = this.requireActiveMember(room, input.actorId, "human");
      const card = this.requireCard(room, cardId);
      const author = this.requireMember(room, card.authorId);

      if (author.memberType !== "agent") {
        throw new RoomServiceError(403, "AIエージェントの提案だけを判断できます。");
      }

      try {
        assertProposalStatusTransition(card.proposalStatus, input.proposalStatus);
      } catch (error: unknown) {
        throw this.toRoomServiceError(error);
      }

      card.proposalStatus = input.proposalStatus;
      card.updatedAt = now();
      const activityType: ActivityType = input.proposalStatus === "approved" ? "card_approved" : "card_rejected";
      const summary = input.proposalStatus === "approved"
        ? `${actor.displayName}がAIの提案を承認しました。`
        : `${actor.displayName}がAIの提案を却下しました。`;
      const activity = this.recordActivity(room, actor.id, activityType, summary);

      return {
        value: undefined,
        activity,
      };
    });

    return mutation.room;
  }

  async createMessage(roomId: string, input: CreateMessageInput): Promise<{ room: Room; message: Message }> {
    const mutation = await this.mutateRoom(roomId, (room) => {
      const actor = this.requireActiveMember(room, input.authorId);
      const message: Message = {
        id: createId("message"),
        authorId: actor.id,
        content: input.content,
        createdAt: now(),
      };
      room.messages.push(message);
      const activity = this.recordActivity(room, actor.id, "message_posted", `${actor.displayName}がチームへメッセージを送りました。`);

      return {
        value: structuredClone(message),
        activity,
      };
    });

    return {
      room: mutation.room,
      message: mutation.value,
    };
  }

  async createAgentTask(roomId: string, input: CreateAgentTaskInput): Promise<{ room: Room; task: AgentTask }> {
    const mutation = await this.mutateRoom(roomId, (room) => {
      const actor = this.requireActiveMember(room, input.createdBy, "human");

      if (input.assigneeId !== null) {
        this.requireActiveMember(room, input.assigneeId, "agent");
      }

      const createdAt = now();
      const task: AgentTask = {
        id: createId("task"),
        kind: input.kind,
        instruction: input.instruction,
        assigneeId: input.assigneeId,
        status: "todo",
        createdBy: actor.id,
        resultSummary: null,
        createdAt,
        updatedAt: createdAt,
      };
      room.agentTasks.push(task);
      const activity = this.recordActivity(room, actor.id, "agent_task_created", `${actor.displayName}がPurinへのタスクを作成しました。`);

      return {
        value: structuredClone(task),
        activity,
      };
    });

    return {
      room: mutation.room,
      task: mutation.value,
    };
  }

  async updateAgentTask(
    roomId: string,
    taskId: string,
    input: UpdateAgentTaskInput,
  ): Promise<{ room: Room; task: AgentTask }> {
    const mutation = await this.mutateRoom(roomId, (room) => {
      const actor = this.requireActiveMember(room, input.actorId, "agent");
      const task = this.requireAgentTask(room, taskId);

      if (task.assigneeId === null) {
        if (input.status !== "in_progress") {
          throw new RoomServiceError(409, "未担当のタスクは、開始時にだけ担当できます。");
        }
        task.assigneeId = actor.id;
      }

      if (task.assigneeId !== actor.id) {
        throw new RoomServiceError(403, "ほかのAIエージェントに割り当てられたタスクは更新できません。");
      }

      try {
        assertAgentTaskStatusTransition(task.status, input.status);
      } catch (error: unknown) {
        throw this.toRoomServiceError(error);
      }

      if (input.status === "done" && input.resultSummary === null) {
        throw new RoomServiceError(400, "タスク完了時は結果概要を記録してください。");
      }

      task.status = input.status;
      task.resultSummary = input.resultSummary ?? task.resultSummary;
      task.updatedAt = now();
      const activity = this.recordActivity(room, actor.id, "agent_task_updated", `${actor.displayName}がエージェントタスクを${input.status}に更新しました。`);

      return {
        value: structuredClone(task),
        activity,
      };
    });

    return {
      room: mutation.room,
      task: mutation.value,
    };
  }

  async savePrdDraft(roomId: string, input: SavePrdDraftInput): Promise<{ room: Room; prd: PrdDocument }> {
    const mutation = await this.mutateRoom(roomId, (room) => {
      const actor = this.requireActiveMember(room, input.actorId, "agent");
      const task = this.requireAgentTask(room, input.taskId);

      if (task.kind !== "prd_draft" || task.assigneeId !== actor.id || task.status !== "in_progress") {
        throw new RoomServiceError(403, "進行中で自分に割り当てられたPRD草案タスクだけを保存できます。");
      }

      if (room.prd?.status === "approved") {
        throw new RoomServiceError(409, "承認済みのPRDは人間メンバーが差し戻すまで更新できません。");
      }

      const timestamp = now();
      const prd: PrdDocument = {
        content: input.content,
        status: "draft",
        createdBy: room.prd?.createdBy ?? actor.id,
        updatedBy: actor.id,
        createdAt: room.prd?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      room.prd = prd;
      const activity = this.recordActivity(room, actor.id, "prd_saved", `${actor.displayName}がPRD草案を保存しました。`);

      return {
        value: structuredClone(prd),
        activity,
      };
    });

    return {
      room: mutation.room,
      prd: mutation.value,
    };
  }

  async updatePrd(roomId: string, input: UpdatePrdInput): Promise<{ room: Room; prd: PrdDocument }> {
    const mutation = await this.mutateRoom(roomId, (room) => {
      const actor = this.requireActiveMember(room, input.actorId, "human");

      if (room.prd === null) {
        throw new RoomServiceError(404, "更新するPRD草案がありません。先にPurinへ草案作成を依頼してください。");
      }

      try {
        assertPrdStatusTransition(room.prd.status, input.status);
      } catch (error: unknown) {
        throw this.toRoomServiceError(error);
      }

      room.prd.content = input.content;
      room.prd.status = input.status;
      room.prd.updatedBy = actor.id;
      room.prd.updatedAt = now();
      const activityType: ActivityType = input.status === "approved"
        ? "prd_approved"
        : input.status === "returned"
          ? "prd_returned"
          : "prd_saved";
      const summary = input.status === "approved"
        ? `${actor.displayName}がPRDを承認しました。`
        : input.status === "returned"
          ? `${actor.displayName}がPRDを差し戻しました。`
          : `${actor.displayName}がPRD草案を編集しました。`;
      const activity = this.recordActivity(room, actor.id, activityType, summary);

      return {
        value: structuredClone(room.prd),
        activity,
      };
    });

    return {
      room: mutation.room,
      prd: mutation.value,
    };
  }

  private async mutateRoom<T>(
    roomId: string,
    operation: (room: Room) => RoomMutation<T>,
  ): Promise<{ room: Room; value: T }> {
    const result = await this.roomStore.mutate((store) => {
      const room = store.rooms.find((candidate) => candidate.id === roomId);

      if (room === undefined) {
        throw new RoomServiceError(404, "指定されたルームが見つかりません。新しいルームを作成してください。");
      }

      const mutation = operation(room);
      return {
        room: copyRoom(room),
        value: mutation.value,
        activity: mutation.activity,
      };
    });

    this.emit({ roomId, activity: result.activity });
    return {
      room: result.room,
      value: result.value,
    };
  }

  private requireMember(room: Room, memberId: string): Member {
    const member = room.members.find((candidate) => candidate.id === memberId);

    if (member === undefined) {
      throw new RoomServiceError(404, "指定された参加者が見つかりません。");
    }

    return member;
  }

  private requireActiveMember(room: Room, memberId: string, requiredType?: "human" | "agent"): Member {
    const member = this.requireMember(room, memberId);

    if (member.status !== "active") {
      throw new RoomServiceError(403, "現在参加していないメンバーは操作できません。");
    }

    if (requiredType !== undefined && member.memberType !== requiredType) {
      throw new RoomServiceError(
        403,
        requiredType === "human" ? "この操作は人間メンバーだけが実行できます。" : "この操作はAIエージェントだけが実行できます。",
      );
    }

    return member;
  }

  private requireCard(room: Room, cardId: string): Card {
    const card = room.cards.find((candidate) => candidate.id === cardId);

    if (card === undefined) {
      throw new RoomServiceError(404, "指定されたカードが見つかりません。");
    }

    return card;
  }

  private requireAgentTask(room: Room, taskId: string): AgentTask {
    const task = room.agentTasks.find((candidate) => candidate.id === taskId);

    if (task === undefined) {
      throw new RoomServiceError(404, "指定されたエージェントタスクが見つかりません。");
    }

    return task;
  }

  private recordActivity(room: Room, actorId: string, activityType: ActivityType, summary: string): Activity {
    const activity: Activity = {
      id: createId("activity"),
      actorId,
      activityType,
      summary,
      createdAt: now(),
    };
    room.activities.push(activity);
    return activity;
  }

  private emit(event: RoomChangedEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private toRoomServiceError(error: unknown): RoomServiceError {
    if (error instanceof InputValidationError) {
      return new RoomServiceError(409, error.message);
    }

    if (error instanceof RoomServiceError) {
      return error;
    }

    return new RoomServiceError(400, "状態を更新できませんでした。");
  }
}
