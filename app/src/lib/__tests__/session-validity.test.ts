import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forPlatform } from "../tenant-db";
import { evaluateSession, needsRevalidation } from "../session-validity";
import { createUser, resetUserPassword, setUserActive } from "../users";

/**
 * Regression suite for docs/WORLD_CLASS_AUDIT.md finding A-02 — `isActive`
 * was checked only at login and never again, so deactivating an account
 * left every already-issued session fully usable until the token expired
 * (30-day default). Role demotions were equally stale.
 */

describe("evaluateSession (pure)", () => {
  const active = { isActive: true, sessionsValidAfter: null };
  const goodToken = { sub: "user-1", loginAt: 1_000_000 };

  it("allows an active user with no forced cutoff", () => {
    expect(evaluateSession(active, goodToken)).toEqual({ valid: true });
  });

  it("revokes a deactivated user — the core A-02 case", () => {
    const verdict = evaluateSession({ isActive: false, sessionsValidAfter: null }, goodToken);
    expect(verdict).toEqual({ valid: false, reason: "inactive" });
  });

  it("revokes when the account no longer exists", () => {
    expect(evaluateSession(null, goodToken)).toEqual({ valid: false, reason: "no_such_user" });
  });

  it("revokes a token with no subject claim", () => {
    expect(evaluateSession(active, { sub: null, loginAt: 1_000_000 })).toEqual({
      valid: false,
      reason: "no_subject",
    });
  });

  it("revokes a session established BEFORE a forced cutoff", () => {
    const user = { isActive: true, sessionsValidAfter: new Date(2_000_000) };
    const verdict = evaluateSession(user, { sub: "user-1", loginAt: 1_000_000 });
    expect(verdict).toEqual({ valid: false, reason: "forcibly_revoked" });
  });

  it("allows a session established AFTER a forced cutoff (the post-reset re-login)", () => {
    const user = { isActive: true, sessionsValidAfter: new Date(2_000_000) };
    expect(evaluateSession(user, { sub: "user-1", loginAt: 3_000_000 })).toEqual({ valid: true });
  });

  it("revokes a cutoff-bearing user whose token has no loginAt, rather than trusting it", () => {
    // Tokens issued before loginAt existed must not be able to outlive a
    // revocation just because they lack the claim to compare against.
    const user = { isActive: true, sessionsValidAfter: new Date(2_000_000) };
    expect(evaluateSession(user, { sub: "user-1" })).toEqual({ valid: false, reason: "forcibly_revoked" });
  });
});

describe("needsRevalidation (pure)", () => {
  it("revalidates a token that has never been checked", () => {
    expect(needsRevalidation({}, 30_000, 1_000_000)).toBe(true);
  });

  it("skips revalidation inside the interval", () => {
    expect(needsRevalidation({ checkedAt: 990_000 }, 30_000, 1_000_000)).toBe(false);
  });

  it("revalidates once the interval has elapsed", () => {
    expect(needsRevalidation({ checkedAt: 970_000 }, 30_000, 1_000_000)).toBe(true);
  });
});

describe("A-02 regression: revocation triggers are actually wired (DB)", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  let institutionA: { id: string };
  let target: { id: string };

  beforeAll(async () => {
    const platform = forPlatform();
    institutionA = await platform.institution.create({
      data: { name: `Session ${runId}`, slug: `session-${runId}` },
    });
    target = await createUser(institutionA.id, { role: "INSTITUTION_ADMIN" }, {
      name: "Target",
      email: `session-target-${runId}@test.local`,
      password: "InitialPass!2026",
      role: "STUDENT",
    });
  });

  afterAll(async () => {
    const platform = forPlatform();
    await platform.user.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.institution.deleteMany({ where: { id: institutionA.id } });
  });

  it("starts with no forced cutoff", async () => {
    const fresh = await forPlatform().user.findUnique({ where: { id: target.id } });
    expect(fresh?.sessionsValidAfter).toBeNull();
  });

  it("DEACTIVATION stamps a cutoff, so a live session is revoked on its next request", async () => {
    const before = Date.now();
    await setUserActive(institutionA.id, { role: "INSTITUTION_ADMIN" }, target.id, false);

    const updated = await forPlatform().user.findUnique({ where: { id: target.id } });
    expect(updated?.isActive).toBe(false);
    expect(updated?.sessionsValidAfter).not.toBeNull();
    expect(updated!.sessionsValidAfter!.getTime()).toBeGreaterThanOrEqual(before - 1000);

    // A session that logged in before the deactivation must now be refused.
    const verdict = evaluateSession(
      { isActive: updated!.isActive, sessionsValidAfter: updated!.sessionsValidAfter },
      { sub: target.id, loginAt: before - 60_000 }
    );
    expect(verdict.valid).toBe(false);
  });

  it("REACTIVATION clears the cutoff so the account works normally again", async () => {
    await setUserActive(institutionA.id, { role: "INSTITUTION_ADMIN" }, target.id, true);

    const updated = await forPlatform().user.findUnique({ where: { id: target.id } });
    expect(updated?.isActive).toBe(true);
    expect(updated?.sessionsValidAfter).toBeNull();

    const verdict = evaluateSession(
      { isActive: updated!.isActive, sessionsValidAfter: updated!.sessionsValidAfter },
      { sub: target.id, loginAt: Date.now() - 60_000 }
    );
    expect(verdict.valid).toBe(true);
  });

  it("PASSWORD RESET revokes existing sessions — otherwise resetting a compromised account is pointless", async () => {
    const loggedInAt = Date.now() - 60_000;

    await resetUserPassword(institutionA.id, { role: "INSTITUTION_ADMIN" }, target.id, "BrandNewPass!2026");

    const updated = await forPlatform().user.findUnique({ where: { id: target.id } });
    expect(updated?.sessionsValidAfter).not.toBeNull();

    const attackerSession = evaluateSession(
      { isActive: updated!.isActive, sessionsValidAfter: updated!.sessionsValidAfter },
      { sub: target.id, loginAt: loggedInAt }
    );
    expect(attackerSession).toEqual({ valid: false, reason: "forcibly_revoked" });

    // ...while a fresh login after the reset is fine.
    const freshSession = evaluateSession(
      { isActive: updated!.isActive, sessionsValidAfter: updated!.sessionsValidAfter },
      { sub: target.id, loginAt: Date.now() + 1000 }
    );
    expect(freshSession.valid).toBe(true);
  });
});
