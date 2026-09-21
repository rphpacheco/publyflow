import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // All db tests share one real Postgres instance and clean up via
    // truncate (see src/test/helpers/db.ts). Vitest's default file
    // parallelism runs test files concurrently in separate workers, which
    // races those truncates against other files' inserts/selects against
    // the same tables -- e.g. one file's afterEach truncating `creators`
    // while src/db/rls-core.test.ts is mid-assertion. Running files
    // sequentially trades a bit of speed (the suite is still small) for
    // not having flaky, order-dependent DB test failures.
    fileParallelism: false,
  },
});
