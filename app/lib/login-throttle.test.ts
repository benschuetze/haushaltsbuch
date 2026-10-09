import { describe, expect, it } from "vitest";
import { createTestDb } from "../../tests/helpers/db";
import {
  clearFailedLogins,
  isLoginBlocked,
  MAX_GLOBAL,
  MAX_PER_IP,
  recordFailedLogin,
  WINDOW_MS,
} from "./login-throttle.server";

const t0 = new Date("2026-10-09T10:00:00Z");

describe("Login-Bremse", () => {
  it("sperrt eine IP nach fünf Fehlversuchen, nach 15 Minuten wieder frei", async () => {
    const { db } = await createTestDb({ seeded: false });
    for (let i = 0; i < MAX_PER_IP - 1; i++) await recordFailedLogin(db, "ip-a", t0);
    expect(await isLoginBlocked(db, "ip-a", t0)).toBe(false);
    await recordFailedLogin(db, "ip-a", t0);
    expect(await isLoginBlocked(db, "ip-a", t0)).toBe(true);
    expect(await isLoginBlocked(db, "ip-b", t0)).toBe(false);
    expect(await isLoginBlocked(db, "ip-a", new Date(t0.getTime() + WINDOW_MS + 1000))).toBe(false);
  });

  it("sperrt global bei vielen Versuchen von vielen Adressen", async () => {
    const { db } = await createTestDb({ seeded: false });
    for (let i = 0; i < MAX_GLOBAL; i++) await recordFailedLogin(db, `ip-${i}`, t0);
    expect(await isLoginBlocked(db, "ganz-neue-ip", t0)).toBe(true);
  });

  it("erfolgreicher Login setzt die eigene IP zurück", async () => {
    const { db } = await createTestDb({ seeded: false });
    for (let i = 0; i < MAX_PER_IP; i++) await recordFailedLogin(db, "ip-a", t0);
    await clearFailedLogins(db, "ip-a");
    expect(await isLoginBlocked(db, "ip-a", t0)).toBe(false);
  });
});
