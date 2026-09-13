import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(() => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@riftversus/contracts": source("../../packages/contracts/src/index.ts"),
      "@riftversus/domain": source("../../packages/domain/src/index.ts"),
      "@riftversus/api-runtime": source("./src/api/static-runtime.ts"),
    },
  },
  base: process.env.VITE_BASE_PATH ?? "/",
  build: {
    assetsInlineLimit: 0,
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test-setup.ts"],
  },
}));
