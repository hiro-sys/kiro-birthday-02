import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DataStoreError } from "./errors.js";
import type { Room, SparkRoomStore } from "../shared/types.js";

const createEmptyStore = (): SparkRoomStore => ({
  version: 1,
  rooms: [],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRoomCollection(value: unknown): value is Room[] {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((room) => isRecord(room)
    && typeof room.id === "string"
    && typeof room.name === "string"
    && Array.isArray(room.members)
    && Array.isArray(room.cards)
    && Array.isArray(room.messages)
    && Array.isArray(room.agentTasks)
    && Array.isArray(room.activities));
}

function parseStore(value: unknown): SparkRoomStore {
  if (!isRecord(value) || !isRoomCollection(value.rooms)) {
    throw new DataStoreError("保存済みのSpark Roomデータを読み込めませんでした。");
  }

  if (value.version !== undefined && value.version !== 1) {
    throw new DataStoreError("このSpark Roomデータの形式には対応していません。");
  }

  return {
    version: 1,
    rooms: structuredClone(value.rooms),
  };
}

export class RoomStore {
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      await access(this.filePath);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code !== "ENOENT") {
        throw error;
      }

      await this.writeStore(createEmptyStore());
      return;
    }

    const store = await this.readStore();
    await this.writeStore(store);
  }

  async read(): Promise<SparkRoomStore> {
    await this.operationQueue;
    return this.readStore();
  }

  async mutate<T>(operation: (store: SparkRoomStore) => T | Promise<T>): Promise<T> {
    const run = this.operationQueue.then(async () => {
      const store = await this.readStore();
      const result = await operation(store);
      await this.writeStore(store);
      return result;
    });

    this.operationQueue = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }

  private async readStore(): Promise<SparkRoomStore> {
    let rawText: string;

    try {
      rawText = await readFile(this.filePath, "utf8");
    } catch {
      throw new DataStoreError("保存済みのSpark Roomデータを読み込めませんでした。");
    }

    try {
      return parseStore(JSON.parse(rawText) as unknown);
    } catch (error: unknown) {
      if (error instanceof DataStoreError) {
        throw error;
      }

      throw new DataStoreError("保存済みのSpark Roomデータが壊れています。");
    }
  }

  private async writeStore(store: SparkRoomStore): Promise<void> {
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const serialized = `${JSON.stringify(store, null, 2)}\n`;

    try {
      await writeFile(temporaryPath, serialized, "utf8");
      await rename(temporaryPath, this.filePath);
    } catch {
      throw new DataStoreError("Spark Roomデータを保存できませんでした。");
    }
  }
}
