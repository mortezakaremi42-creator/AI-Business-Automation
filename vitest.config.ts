import { defineConfig } from "vitest/config";
// Other subprojects use node:test and have their own package/test commands.
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
