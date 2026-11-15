import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Only the "@/..." path alias of tsconfig.json, so tests can import server modules (DB mocked with vi.mock).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
