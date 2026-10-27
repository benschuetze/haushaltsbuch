import { afterEach, describe, expect, it, vi } from "vitest";
import { clockNow } from "./clock";

afterEach(() => vi.unstubAllEnvs());

describe("clockNow", () => {
  it("is the system clock when nothing is pinned", () => {
    vi.stubEnv("FIXED_NOW", "");
    expect(Math.abs(clockNow().getTime() - Date.now())).toBeLessThan(1000);
  });

  it("is the pinned moment when FIXED_NOW is set, so demo data does not age in the browser tests", () => {
    vi.stubEnv("FIXED_NOW", "2026-10-20T09:00:00Z");
    expect(clockNow().toISOString()).toBe("2026-10-20T09:00:00.000Z");
  });

  it("refuses an unreadable FIXED_NOW instead of silently using the real clock", () => {
    vi.stubEnv("FIXED_NOW", "gestern");
    expect(() => clockNow()).toThrow(/FIXED_NOW/);
  });
});
