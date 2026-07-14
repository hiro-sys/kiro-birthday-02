import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SparkRoomApi } from "./routes.js";
import { RoomService } from "./room-service.js";
import { RoomStore } from "./room-store.js";

const defaultPort = 8787;
const configuredPort = Number.parseInt(process.env.SPARK_ROOM_PORT ?? String(defaultPort), 10);
const port = Number.isSafeInteger(configuredPort) ? configuredPort : defaultPort;
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDirectory, "../..");
const dataFilePath = resolve(projectRoot, "data", "spark-room.json");

async function startServer(): Promise<void> {
  const roomStore = new RoomStore(dataFilePath);
  await roomStore.initialize();

  const roomService = new RoomService(roomStore);
  const api = new SparkRoomApi(roomService);
  const server = createServer((request, response) => {
    void api.handle(request, response);
  });

  await new Promise<void>((resolveServer, rejectServer) => {
    server.once("error", rejectServer);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", rejectServer);
      resolveServer();
    });
  });

  console.log(`Spark Room Server is listening on http://127.0.0.1:${port}`);
}

void startServer().catch(() => {
  console.error("Spark Room Serverを起動できませんでした。ポート番号と保存領域を確認してください。");
  process.exitCode = 1;
});
