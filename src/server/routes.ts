import type { IncomingMessage, ServerResponse } from "node:http";
import {
  InputValidationError,
  parseAgentTaskId,
  parseAgentTaskStatus,
  parseCardId,
  parseCreateAgentProposalInput,
  parseCreateAgentTaskInput,
  parseCreateHumanCardInput,
  parseCreateMemberInput,
  parseCreateMessageInput,
  parseCreateRoomInput,
  parseDecideProposalInput,
  parseDeleteHumanCardInput,
  parseMemberId,
  parseRoomId,
  parseSavePrdDraftInput,
  parseUpdateAgentTaskInput,
  parseUpdateHumanCardInput,
  parseUpdateMemberStatusInput,
  parseUpdatePrdInput,
} from "../shared/validation.js";
import { DataStoreError, RoomServiceError } from "./errors.js";
import { RoomService, type RoomChangedEvent } from "./room-service.js";

const maximumBodySize = 256 * 1024;

type SseSubscriber = {
  request: IncomingMessage;
  response: ServerResponse;
  heartbeat: NodeJS.Timeout;
};

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, statusCode: number, message: string): void {
  sendJson(response, statusCode, { error: message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMode(value: unknown): string {
  if (!isRecord(value) || typeof value.mode !== "string") {
    throw new InputValidationError("mode", "操作種別を指定してください。");
  }

  return value.mode;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > maximumBodySize) {
      throw new InputValidationError("リクエスト本文", "リクエスト本文が大きすぎます。");
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new InputValidationError("リクエスト本文", "JSON形式が正しくありません。");
  }
}

function writeSse(response: ServerResponse, event: string, payload: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export class SparkRoomApi {
  private readonly subscribers = new Map<string, Set<SseSubscriber>>();

  constructor(private readonly roomService: RoomService) {
    this.roomService.subscribe((event) => this.broadcastRoomChange(event));
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;
    const method = request.method ?? "GET";

    try {
      if (method === "GET" && pathname === "/api/health") {
        sendJson(response, 200, {
          service: "spark-room-server",
          status: "ok",
          now: new Date().toISOString(),
        });
        return;
      }

      if (method === "POST" && pathname === "/api/rooms") {
        const result = await this.roomService.createRoom(parseCreateRoomInput(await readJsonBody(request)));
        sendJson(response, 201, {
          room: result.room,
          member: result.creator,
        });
        return;
      }

      const roomMatch = pathname.match(/^\/api\/rooms\/([^/]+)$/);
      if (method === "GET" && roomMatch !== null) {
        const room = await this.roomService.getRoom(parseRoomId(decodeURIComponent(roomMatch[1])));
        sendJson(response, 200, { room });
        return;
      }

      const eventMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/events$/);
      if (method === "GET" && eventMatch !== null) {
        await this.roomService.getRoom(parseRoomId(decodeURIComponent(eventMatch[1])));
        this.subscribeToRoom(parseRoomId(decodeURIComponent(eventMatch[1])), request, response);
        return;
      }

      const memberMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/members$/);
      if (method === "POST" && memberMatch !== null) {
        const result = await this.roomService.joinMember(
          parseRoomId(decodeURIComponent(memberMatch[1])),
          parseCreateMemberInput(await readJsonBody(request)),
        );
        sendJson(response, 201, result);
        return;
      }

      const memberStatusMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/members\/([^/]+)$/);
      if (method === "PATCH" && memberStatusMatch !== null) {
        const room = await this.roomService.updateMemberStatus(
          parseRoomId(decodeURIComponent(memberStatusMatch[1])),
          parseMemberId(decodeURIComponent(memberStatusMatch[2])),
          parseUpdateMemberStatusInput(await readJsonBody(request)),
        );
        sendJson(response, 200, { room });
        return;
      }

      const cardMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/cards$/);
      if (method === "POST" && cardMatch !== null) {
        const roomId = parseRoomId(decodeURIComponent(cardMatch[1]));
        const body = await readJsonBody(request);
        const mode = readMode(body);

        if (mode === "human") {
          const result = await this.roomService.createHumanCard(roomId, parseCreateHumanCardInput(body));
          sendJson(response, 201, result);
          return;
        }

        if (mode === "agent_proposal") {
          const result = await this.roomService.createAgentProposal(roomId, parseCreateAgentProposalInput(body));
          sendJson(response, 201, result);
          return;
        }

        throw new InputValidationError("mode", "カードの操作種別が正しくありません。");
      }

      const cardUpdateMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/cards\/([^/]+)$/);
      if (cardUpdateMatch !== null) {
        const roomId = parseRoomId(decodeURIComponent(cardUpdateMatch[1]));
        const cardId = parseCardId(decodeURIComponent(cardUpdateMatch[2]));

        if (method === "PATCH") {
          const body = await readJsonBody(request);
          const mode = readMode(body);

          if (mode === "human_edit") {
            const room = await this.roomService.updateHumanCard(roomId, cardId, parseUpdateHumanCardInput(body));
            sendJson(response, 200, { room });
            return;
          }

          if (mode === "proposal_decision") {
            const room = await this.roomService.decideProposal(roomId, cardId, parseDecideProposalInput(body));
            sendJson(response, 200, { room });
            return;
          }

          throw new InputValidationError("mode", "カード更新の操作種別が正しくありません。");
        }

        if (method === "DELETE") {
          const room = await this.roomService.deleteHumanCard(roomId, cardId, parseDeleteHumanCardInput(await readJsonBody(request)));
          sendJson(response, 200, { room });
          return;
        }
      }

      const messageMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/messages$/);
      if (method === "POST" && messageMatch !== null) {
        const result = await this.roomService.createMessage(
          parseRoomId(decodeURIComponent(messageMatch[1])),
          parseCreateMessageInput(await readJsonBody(request)),
        );
        sendJson(response, 201, result);
        return;
      }

      const taskMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/agent-tasks$/);
      if (method === "POST" && taskMatch !== null) {
        const result = await this.roomService.createAgentTask(
          parseRoomId(decodeURIComponent(taskMatch[1])),
          parseCreateAgentTaskInput(await readJsonBody(request)),
        );
        sendJson(response, 201, result);
        return;
      }

      const taskUpdateMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/agent-tasks\/([^/]+)$/);
      if (method === "PATCH" && taskUpdateMatch !== null) {
        const result = await this.roomService.updateAgentTask(
          parseRoomId(decodeURIComponent(taskUpdateMatch[1])),
          parseAgentTaskId(decodeURIComponent(taskUpdateMatch[2])),
          parseUpdateAgentTaskInput(await readJsonBody(request)),
        );
        sendJson(response, 200, result);
        return;
      }

      const taskListMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/agent-tasks$/);
      if (method === "GET" && taskListMatch !== null) {
        const status = requestUrl.searchParams.has("status")
          ? parseAgentTaskStatus(requestUrl.searchParams.get("status"))
          : undefined;
        const tasks = await this.roomService.listAgentTasks(
          parseRoomId(decodeURIComponent(taskListMatch[1])),
          status,
        );
        sendJson(response, 200, { tasks });
        return;
      }

      const prdMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/prd$/);
      if (method === "PUT" && prdMatch !== null) {
        const roomId = parseRoomId(decodeURIComponent(prdMatch[1]));
        const body = await readJsonBody(request);
        const mode = readMode(body);

        if (mode === "agent_draft") {
          const result = await this.roomService.savePrdDraft(roomId, parseSavePrdDraftInput(body));
          sendJson(response, 200, result);
          return;
        }

        if (mode === "human_update") {
          const result = await this.roomService.updatePrd(roomId, parseUpdatePrdInput(body));
          sendJson(response, 200, result);
          return;
        }

        throw new InputValidationError("mode", "PRD更新の操作種別が正しくありません。");
      }

      sendError(response, 404, "指定されたAPIが見つかりません。");
    } catch (error: unknown) {
      this.handleError(response, error);
    }
  }

  private subscribeToRoom(roomId: string, request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    response.flushHeaders();
    writeSse(response, "connected", { roomId });

    const heartbeat = setInterval(() => {
      if (!response.writableEnded) {
        response.write(": heartbeat\n\n");
      }
    }, 25_000);
    const subscriber: SseSubscriber = { request, response, heartbeat };
    const subscribers = this.subscribers.get(roomId) ?? new Set<SseSubscriber>();
    subscribers.add(subscriber);
    this.subscribers.set(roomId, subscribers);

    const removeSubscriber = (): void => {
      clearInterval(heartbeat);
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        this.subscribers.delete(roomId);
      }
    };

    request.once("close", removeSubscriber);
    response.once("close", removeSubscriber);
  }

  private broadcastRoomChange(event: RoomChangedEvent): void {
    const subscribers = this.subscribers.get(event.roomId);

    if (subscribers === undefined) {
      return;
    }

    for (const subscriber of subscribers) {
      if (subscriber.response.writableEnded) {
        clearInterval(subscriber.heartbeat);
        subscribers.delete(subscriber);
        continue;
      }

      writeSse(subscriber.response, "room-updated", {
        roomId: event.roomId,
        activityId: event.activity.id,
      });
    }
  }

  private handleError(response: ServerResponse, error: unknown): void {
    if (response.writableEnded) {
      return;
    }

    if (error instanceof InputValidationError || error instanceof RoomServiceError) {
      sendError(response, error instanceof RoomServiceError ? error.statusCode : 400, error.message);
      return;
    }

    if (error instanceof DataStoreError) {
      sendError(response, 500, error.message);
      return;
    }

    sendError(response, 500, "共有サーバーで予期しない問題が発生しました。再試行してください。");
  }
}
