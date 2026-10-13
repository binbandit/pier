import { fileURLToPath } from "node:url";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, Vite serves the app one port above the daemon (4478 for the default 4477) and proxies
// the API to it. PIER_PORT moves the pair, so two dev setups can run side by side.
// In production the daemon serves the built files itself.
const daemonPort = Number(process.env.PIER_PORT ?? 4477);

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    host: "127.0.0.1",
    port: daemonPort + 1,
    strictPort: true,
    proxy: {
      "/api": { target: `http://127.0.0.1:${daemonPort}`, changeOrigin: false },
      // github.com-style .diff and .patch links are served by the daemon too.
      "^/[^/]+/[^/]+/pull/\\d+\\.(diff|patch)$": {
        target: `http://127.0.0.1:${daemonPort}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    target: "es2024",
    sourcemap: true,
  },
});
