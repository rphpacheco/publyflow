import { config } from "dotenv";

// Load .env.test first (test-specific overrides), then fall back to .env
// for any variables not already set (e.g. shell-exported values). Vars
// already present in process.env (e.g. from CI) are never overwritten.
config({ path: ".env.test" });
config({ path: ".env" });
