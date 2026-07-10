import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client", "src"),
    },
  },
  test: {
    environment: "node",
    // Date-only columns used to render a day early for anyone west of UTC.
    // Pin a non-UTC zone so client/src/lib/dates.test.ts actually catches it;
    // in UTC those assertions would pass without testing anything.
    env: { TZ: "America/Chicago" },
    // client/src/lib holds pure, DOM-free helpers, so they run in the node env
    // alongside the server tests. Component tests would need jsdom; none yet.
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "client/src/lib/**/*.test.ts"],
  },
});
