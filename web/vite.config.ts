import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// サーバーのポートはリポジトリ直下の config.json（既定 8443）に追随する。
// dev プロキシだけに関係。編集後は vite dev の再起動で反映。
let serverPort = 8443;
try {
  const cfg = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf-8"));
  if (Number.isInteger(cfg.port) && cfg.port >= 1 && cfg.port <= 65535) serverPort = cfg.port;
} catch {
  // config.json が読めない場合は既定値
}
const target = `https://192.168.100.25:${serverPort}`;

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target, changeOrigin: true, secure: false },
      "/photos": { target, changeOrigin: true, secure: false },
      "/thumbs": { target, changeOrigin: true, secure: false },
    },
  },
  build: { outDir: "dist", target: "es2022" },
});
