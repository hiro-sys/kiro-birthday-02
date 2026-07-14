type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(value: unknown): string {
  if (isRecord(value) && typeof value.error === "string") {
    return value.error;
  }

  return "共有サーバーとの通信に失敗しました。";
}

export class SparkRoomApiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SparkRoomApiClientError";
  }
}

export class SparkRoomApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async createAgentMember(
    roomId: string,
    input: { displayName: string; role: string },
  ): Promise<unknown> {
    return this.request(`/api/rooms/${encodeURIComponent(roomId)}/members`, {
      method: "POST",
      body: {
        displayName: input.displayName,
        memberType: "agent",
        role: input.role,
      },
    });
  }

  async leaveWorkspace(roomId: string, agentId: string): Promise<unknown> {
    return this.request(`/api/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      body: {
        actorId: agentId,
        status: "left",
      },
    });
  }

  async readWorkspace(roomId: string): Promise<unknown> {
    return this.request(`/api/rooms/${encodeURIComponent(roomId)}`, { method: "GET" });
  }

  async listAgentTasks(roomId: string, status?: string): Promise<unknown> {
    const query = status === undefined ? "" : `?status=${encodeURIComponent(status)}`;
    return this.request(`/api/rooms/${encodeURIComponent(roomId)}/agent-tasks${query}`, { method: "GET" });
  }

  async updateAgentTask(
    roomId: string,
    taskId: string,
    input: { actorId: string; status: string; resultSummary: string | null },
  ): Promise<unknown> {
    return this.request(
      `/api/rooms/${encodeURIComponent(roomId)}/agent-tasks/${encodeURIComponent(taskId)}`,
      {
        method: "PATCH",
        body: input,
      },
    );
  }

  async postAgentMessage(roomId: string, agentId: string, content: string): Promise<unknown> {
    return this.request(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
      method: "POST",
      body: {
        authorId: agentId,
        content,
      },
    });
  }

  async proposeCard(
    roomId: string,
    input: {
      authorId: string;
      taskId: string;
      column: string;
      content: string;
      rationale: string;
    },
  ): Promise<unknown> {
    return this.request(`/api/rooms/${encodeURIComponent(roomId)}/cards`, {
      method: "POST",
      body: {
        mode: "agent_proposal",
        ...input,
      },
    });
  }

  async savePrdDraft(
    roomId: string,
    input: { actorId: string; taskId: string; content: string },
  ): Promise<unknown> {
    return this.request(`/api/rooms/${encodeURIComponent(roomId)}/prd`, {
      method: "PUT",
      body: {
        mode: "agent_draft",
        ...input,
      },
    });
  }

  private async request(
    path: string,
    options: { method: "GET" | "POST" | "PATCH" | "PUT"; body?: JsonRecord },
  ): Promise<unknown> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new SparkRoomApiClientError("Spark Room Serverへ接続できません。共有サーバーを起動してください。");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SparkRoomApiClientError("Spark Room Serverの応答形式が正しくありません。");
    }

    if (!response.ok) {
      throw new SparkRoomApiClientError(errorMessage(payload));
    }

    return payload;
  }
}
