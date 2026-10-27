import { generateKeyPairSync, randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { E2E_CAPTURE_TOKEN, E2E_NOW, E2E_PASSWORD } from "./tests/e2e/helpers";

const CI = !!process.env.CI;
const PORT = 5199;
const DEMO_PORT = 5198;
const LOCAL_DB_PORT = 5434;

// CI brings a real Postgres service; locally PGlite stands in so nobody needs Postgres installed.
const DATABASE_URL = process.env.DATABASE_URL ?? `postgres://postgres@127.0.0.1:${LOCAL_DB_PORT}/postgres`;
process.env.DATABASE_URL = DATABASE_URL;

// Fresh keys per run: the app signs with the private key, the fake bank verifies with the public one.
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const FAKE_BANK_PORT = 5437;
const BANK_APP_ID = "e2e00000-0000-0000-0000-000000000001";
const bankEnv = {
  ENABLE_BANKING_APP_ID: BANK_APP_ID,
  ENABLE_BANKING_PRIVATE_KEY: Buffer.from(keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString()).toString(
    "base64",
  ),
  ENABLE_BANKING_API_URL: `http://127.0.0.1:${FAKE_BANK_PORT}`,
  DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  CRON_SECRET: process.env.E2E_CRON_SECRET ?? "e2e-cron-secret-nur-fuer-tests-0000000000",
};
process.env.E2E_CRON_SECRET = bankEnv.CRON_SECRET;

const appEnv = {
  DATABASE_URL,
  AI_MOCK: "1",
  APP_PASSWORD: E2E_PASSWORD,
  CAPTURE_TOKEN: E2E_CAPTURE_TOKEN,
  SESSION_SECRET: "e2e-session-secret-nur-fuer-tests",
  NODE_ENV: "production",
  INSECURE_COOKIES: "1",
  // Pinned server clock, see E2E_NOW. The browser keeps its real clock.
  FIXED_NOW: E2E_NOW,
};

export default defineConfig({
  testDir: "tests/e2e",
  // One shared database: files run one after another, each starts by resetting it.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Only on the retry: recording every test filled the CI runner's disk (ENOSPC) once the suite passed 170 tests.
    trace: CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "playwright/.auth/state.json",
      },
      dependencies: ["setup"],
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], storageState: "playwright/.auth/state.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    ...(CI
      ? []
      : [
          {
            command: `pnpm exec tsx scripts/local-db.ts --memory --port ${LOCAL_DB_PORT}`,
            port: LOCAL_DB_PORT,
            reuseExistingServer: false,
            timeout: 60_000,
          },
        ]),
    {
      command: "pnpm exec tsx tests/e2e/fake-bank-server.ts",
      port: FAKE_BANK_PORT,
      env: {
        FAKE_BANK_PORT: String(FAKE_BANK_PORT),
        ENABLE_BANKING_APP_ID: BANK_APP_ID,
        FAKE_BANK_PUBLIC_KEY: Buffer.from(keys.publicKey.export({ type: "spki", format: "pem" }).toString()).toString(
          "base64",
        ),
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm build && pnpm exec react-router-serve ./build/server/index.js`,
      url: `http://127.0.0.1:${PORT}/login`,
      env: { ...appEnv, ...bankEnv, PORT: String(PORT) },
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
    {
      command: "pnpm exec react-router-serve ./build/server/index.js",
      url: `http://127.0.0.1:${DEMO_PORT}/`,
      env: { ...appEnv, PORT: String(DEMO_PORT), DEMO_MODE: "true", DEMO_NIGHTLY_RESET: "0" },
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
