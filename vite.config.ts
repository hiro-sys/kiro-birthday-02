import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const serverTarget = process.env.SPARK_ROOM_SERVER_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: serverTarget,
        changeOrigin: true,
      },
    },
  },
});
