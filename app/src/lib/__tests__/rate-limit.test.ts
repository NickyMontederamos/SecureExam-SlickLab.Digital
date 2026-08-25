import { describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimit } from "../rate-limit";

describe("rate limiter", () => {
  it("allows up to the configured max attempts, then blocks", () => {
    const key = `test-key-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key).allowed).toBe(true);
    }
    const blocked = checkRateLimit(key);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks separate keys independently", () => {
    const keyA = `test-key-a-${Math.random()}`;
    const keyB = `test-key-b-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      checkRateLimit(keyA);
    }
    expect(checkRateLimit(keyA).allowed).toBe(false);
    expect(checkRateLimit(keyB).allowed).toBe(true);
  });

  it("resetRateLimit clears the counter for a key", () => {
    const key = `test-key-reset-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key);
    }
    expect(checkRateLimit(key).allowed).toBe(false);
    resetRateLimit(key);
    expect(checkRateLimit(key).allowed).toBe(true);
  });
});
