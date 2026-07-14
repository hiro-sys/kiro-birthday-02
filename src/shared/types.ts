export const boardColumns = ["problem", "user", "idea", "decision"] as const;
export type BoardColumn = (typeof boardColumns)[number];

export const memberTypes = ["human", "agent"] as const;
export type MemberType = (typeof memberTypes)[number];

export const memberStatuses = ["active", "away", "left"] as const;
export type MemberStatus = (typeof memberStatuses)[number];

export const proposalStatuses = ["approved", "pending", "rejected"] as const;
export type ProposalStatus = (typeof proposalStatuses)[number];

export const agentTaskKinds = ["question", "proposal", "review", "prd_draft"] as const;
export type AgentTaskKind = (typeof agentTaskKinds)[number];

export const agentTaskStatuses = ["todo", "in_progress", "done"] as const;
export type AgentTaskStatus = (typeof agentTaskStatuses)[number];

export const prdStatuses = ["draft", "approved", "returned"] as const;
export type PrdStatus = (typeof prdStatuses)[number];

export const activityTypes = [
  "room_created",
  "member_joined",
  "member_left",
  "card_created",
  "card_updated",
  "card_deleted",
  "card_proposed",
  "card_approved",
  "card_rejected",
  "message_posted",
  "agent_task_created",
  "agent_task_updated",
  "prd_saved",
  "prd_approved",
  "prd_returned",
] as const;
export type ActivityType = (typeof activityTypes)[number];

export type Member = {
  id: string;
  displayName: string;
  memberType: MemberType;
  role: string;
  status: MemberStatus;
  joinedAt: string;
};

export type Card = {
  id: string;
  column: BoardColumn;
  content: string;
  authorId: string;
  proposalStatus: ProposalStatus;
  rationale: string | null;
  agentTaskId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  authorId: string;
  content: string;
  createdAt: string;
};

export type AgentTask = {
  id: string;
  kind: AgentTaskKind;
  instruction: string;
  assigneeId: string | null;
  status: AgentTaskStatus;
  createdBy: string;
  resultSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Activity = {
  id: string;
  actorId: string;
  activityType: ActivityType;
  summary: string;
  createdAt: string;
};

export type PrdDocument = {
  content: string;
  status: PrdStatus;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type Room = {
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

export type SparkRoomStore = {
  version: 1;
  rooms: Room[];
};

export type CreateRoomInput = {
  name: string;
  creatorName: string;
};

export type CreateMemberInput = {
  displayName: string;
  memberType: MemberType;
  role: string;
};

export type UpdateMemberStatusInput = {
  actorId: string;
  status: MemberStatus;
};

export type CreateHumanCardInput = {
  authorId: string;
  column: BoardColumn;
  content: string;
};

export type CreateAgentProposalInput = {
  authorId: string;
  taskId: string;
  column: BoardColumn;
  content: string;
  rationale: string;
};

export type UpdateHumanCardInput = {
  actorId: string;
  content: string;
};

export type DeleteHumanCardInput = {
  actorId: string;
};

export type DecideProposalInput = {
  actorId: string;
  proposalStatus: Extract<ProposalStatus, "approved" | "rejected">;
};

export type CreateMessageInput = {
  authorId: string;
  content: string;
};

export type CreateAgentTaskInput = {
  createdBy: string;
  kind: AgentTaskKind;
  instruction: string;
  assigneeId: string | null;
};

export type UpdateAgentTaskInput = {
  actorId: string;
  status: AgentTaskStatus;
  resultSummary: string | null;
};

export type SavePrdDraftInput = {
  actorId: string;
  taskId: string;
  content: string;
};

export type UpdatePrdInput = {
  actorId: string;
  content: string;
  status: PrdStatus;
};
