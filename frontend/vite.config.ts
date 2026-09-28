import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `vite build --mode offline` produces one self-contained HTML file that plays
// against bots in the browser, with no server needed.
export default defineConfig(({ mode }) => {
  const offline = mode === "offline";
  return {
    plugins: offline ? [react(), viteSingleFile()] : [react()],
    // Compile the shared package from its TypeScript source.
    resolve: { conditions: ["source", ...defaultClientConditions] },
    build: {
      outDir: offline ? "dist-offline" : "dist",
      copyPublicDir: !offline,
    },
    server: {
      proxy: {
        "/api": "http://localhost:5000",
        "/socket.io": { target: "ws://localhost:5000", ws: true },
      },
    },
  };
});
