/**
 * The decision half of session revocation (docs/WORLD_CLASS_AUDIT.md A-02),
 * kept as a pure function outside auth.ts so it can be unit-tested without
 * standing up NextAuth. auth.ts's `jwt` callback does the I/O (load the
 * user, write back refreshed claims) and delegates the actual judgement
 * here.
 *
 * Security-relevant default: every branch that cannot positively confirm
 * the session is still good returns "revoke". A deleted user, a missing
 * subject claim, a token with no recorded login time — all revoke rather
 * than fall through to "allow".
 */

export type SessionVerdict =
  | { valid: true }
  | { valid: false; reason: "no_subject" | "no_such_user" | "inactive" | "forcibly_revoked" };

export interface SessionUserSnapshot {
  isActive: boolean;
  sessionsValidAfter: Date | null;
}

export function evaluateSession(
  user: SessionUserSnapshot | null,
  token: { sub?: string | null; loginAt?: number | null }
): SessionVerdict {
  if (!token.sub) {
    return { valid: false, reason: "no_subject" };
  }
  if (!user) {
    // Account deleted (or otherwise unreadable) while a token was live.
    return { valid: false, reason: "no_such_user" };
  }
  if (!user.isActive) {
    return { valid: false, reason: "inactive" };
  }
  if (user.sessionsValidAfter) {
    // A token with no loginAt predates this claim being issued, so it
    // cannot prove it was established after the cutoff — treat it as
    // revoked rather than trusting it.
    const loginAt = typeof token.loginAt === "number" ? token.loginAt : 0;
    if (user.sessionsValidAfter.getTime() > loginAt) {
      return { valid: false, reason: "forcibly_revoked" };
    }
  }
  return { valid: true };
}

/**
 * Whether a token's cached claims are stale enough to warrant a database
 * round trip. Separated out so the interval policy is testable and stated
 * in one place rather than inlined as a comparison.
 */
export function needsRevalidation(
  token: { checkedAt?: number | null },
  intervalMs: number,
  now: number = Date.now()
): boolean {
  const checkedAt = typeof token.checkedAt === "number" ? token.checkedAt : 0;
  return now - checkedAt >= intervalMs;
}
