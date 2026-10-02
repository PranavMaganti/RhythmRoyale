import { defineConfig } from "vitest/config";

export default defineConfig({
  // Use the shared package's TypeScript source rather than its build output.
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
});
