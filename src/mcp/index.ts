import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SparkRoomApiClient, SparkRoomApiClientError } from "./server-client.js";

const identifierSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "英数字、ハイフン、アンダースコアだけを使用してください。");
const shortTextSchema = z.string().trim().min(1).max(1_000);
const cardTextSchema = z.string().trim().min(1).max(500);
const prdTextSchema = z.string().trim().min(1).max(20_000);
const baseUrl = process.env.SPARK_ROOM_SERVER_URL ?? "http://127.0.0.1:8787";
const apiClient = new SparkRoomApiClient(baseUrl);

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function success(value: unknown) {
  return {
    content: [{ type: "text" as const, text: serialize(value) }],
  };
}

function failure(error: unknown) {
  const message = error instanceof SparkRoomApiClientError
    ? error.message
    : "MCPツールの実行中に問題が発生しました。入力と共有サーバーの状態を確認してください。";

  return {
    content: [{ type: "text" as const, text: `エラー: ${message}` }],
    isError: true,
  };
}

const server = new McpServer({
  name: "spark-room",
  version: "0.1.0",
});

server.registerTool(
  "join_workspace",
  {
    title: "Spark Roomへ参加",
    description: "PurinなどのAIエージェントとして共有ルームへ参加し、以後の操作で使うmemberIdを返します。",
    inputSchema: {
      roomId: identifierSchema,
      displayName: z.string().trim().min(1).max(40),
      role: z.string().trim().min(1).max(60),
    },
  },
  async ({ roomId, displayName, role }) => {
    try {
      return success(await apiClient.createAgentMember(roomId, { displayName, role }));
    } catch (error: unknown) {
      return failure(error);
    }
  },
);

server.registerTool(
  "leave_workspace",
  {
    title: "Spark Roomから退出",
    description: "AIエージェント自身を共有ルームから退出状態にします。",
    inputSchema: {
      roomId: identifierSchema,
      agentId: identifierSchema,
    },
  },
  async ({ roomId, agentId }) => {
    try {
      return success(await apiClient.leaveWorkspace(roomId, agentId));
    } catch (error: unknown) {
      return failure(error);
    }
  },
);

server.registerTool(
  "read_workspace",
  {
    title: "共有ルームを読む",
    description: "参加者、カード、決定、メッセージ、PRDを読み、作業前に現在の文脈を確認します。",
    inputSchema: {
      roomId: identifierSchema,
    },
  },
  async ({ roomId }) => {
    try {
      return success(await apiClient.readWorkspace(roomId));
    } catch (error: unknown) {
      return failure(error);
    }
  },
);

server.registerTool(
  "list_agent_tasks",
  {
    title: "エージェントタスク一覧",
    description: "Spark Roomのエージェントタスクを状態で絞り込んで取得します。作業開始前に必ず確認してください。",
    inputSchema: {
      roomId: identifierSchema,
      status: z.enum(["todo", "in_progress", "done"]).optional(),
    },
  },
  async ({ roomId, status }) => {
    try {
      return success(await apiClient.listAgentTasks(roomId, status));
    } catch (error: unknown) {
      return failure(error);
    }
  },
);

server.registerTool(
  "update_agent_task",
  {
    title: "エージェントタスクを更新",
    description: "自分に割り当てられたタスクを開始または完了します。完了時は人間が次に判断すべき内容を結果概要に記録してください。",
    inputSchema: {
      roomId: identifierSchema,
      taskId: identifierSchema,
      agentId: identifierSchema,
      status: z.enum(["todo", "in_progress", "done"]),
      resultSummary: z.string().trim().min(1).max(1_000).nullable().optional(),
    },
  },
  async ({ roomId, taskId, agentId, status, resultSummary }) => {
    try {
      return success(await apiClient.updateAgentTask(roomId, taskId, {
        actorId: agentId,
        status,
        resultSummary: resultSummary ?? null,
      }));
    } catch (error: unknown) {
      return failure(error);
    }
  },
);

server.registerTool(
  "post_agent_message",
  {
    title: "チームへメッセージを送る",
    description: "分析の目的、根拠、不足情報、または人間へ確認したい質問をチームに記録します。",
    inputSchema: {
      roomId: identifierSchema,
      agentId: identifierSchema,
      content: shortTextSchema,
    },
  },
  async ({ roomId, agentId, content }) => {
    try {
      return success(await apiClient.postAgentMessage(roomId, agentId, content));
    } catch (error: unknown) {
      return failure(error);
    }
  },
);

server.registerTool(
  "propose_card",
  {
    title: "AI提案カードを追加",
    description: "進行中の提案タスクに対し、根拠付きの承認待ちカードを追加します。1タスクにつき最大3件です。",
    inputSchema: {
      roomId: identifierSchema,
      agentId: identifierSchema,
      taskId: identifierSchema,
      column: z.enum(["problem", "user", "idea", "decision"]),
      content: cardTextSchema,
      rationale: z.string().trim().min(1).max(600),
    },
  },
  async ({ roomId, agentId, taskId, column, content, rationale }) => {
    try {
      return success(await apiClient.proposeCard(roomId, {
        authorId: agentId,
        taskId,
        column,
        content,
        rationale,
      }));
    } catch (error: unknown) {
      return failure(error);
    }
  },
);

server.registerTool(
  "save_prd_draft",
  {
    title: "PRD草案を保存",
    description: "進行中のPRD草案タスクに対し、承認待ちのPRD草案を保存します。承認済み情報だけを根拠にしてください。",
    inputSchema: {
      roomId: identifierSchema,
      agentId: identifierSchema,
      taskId: identifierSchema,
      content: prdTextSchema,
    },
  },
  async ({ roomId, agentId, taskId, content }) => {
    try {
      return success(await apiClient.savePrdDraft(roomId, {
        actorId: agentId,
        taskId,
        content,
      }));
    } catch (error: unknown) {
      return failure(error);
    }
  },
);

async function startMcpServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Spark Room MCP Serverが接続待機中です。");
}

void startMcpServer().catch(() => {
  console.error("Spark Room MCP Serverを起動できませんでした。共有サーバーの設定を確認してください。");
  process.exitCode = 1;
});
