import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: "https://192.168.100.25:8443", changeOrigin: true, secure: false },
      "/photos": { target: "https://192.168.100.25:8443", changeOrigin: true, secure: false },
      "/thumbs": { target: "https://192.168.100.25:8443", changeOrigin: true, secure: false },
    },
  },
  build: { outDir: "dist", target: "es2022" },
});
