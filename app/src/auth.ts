import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { forPlatform } from "@/lib/tenant-db";
import { verifyPassword } from "@/lib/password";
import { logAudit } from "@/lib/audit";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";

/**
 * Credentials-only auth for Phase 1 (email + password against our own
 * `User` table). JWT session strategy — no Account/Session tables needed,
 * so no Prisma adapter (see docs/ARCHITECTURE_DECISIONS.md).
 *
 * authorize() intentionally looks up the user via forPlatform() (unscoped):
 * at login time we don't yet know which tenant the caller belongs to — the
 * user's own institutionId IS the answer, and it becomes the tenant scope
 * for every request afterward via the JWT.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        // Per-account brute-force throttle (5 attempts / 15 min). Keyed on
        // the submitted email specifically so a locked-out attacker can't
        // just try a different email from the same IP to bypass it, and a
        // legitimate user isn't blocked by attempts against a different
        // account. IP-based throttling would add defense against
        // spraying many accounts from one source — worth adding later,
        // not done here (see docs/PROJECT_STATUS.md).
        const rateLimitKey = `login:${email.toLowerCase()}`;
        const rateLimit = checkRateLimit(rateLimitKey);
        if (!rateLimit.allowed) {
          await logAudit({
            action: "auth.login",
            resourceType: "user",
            result: "DENIED",
            metadata: { email, reason: "rate_limited", retryAfterSeconds: rateLimit.retryAfterSeconds },
          });
          return null;
        }

        const user = await forPlatform().user.findUnique({ where: { email } });

        if (!user || !user.isActive) {
          await logAudit({
            action: "auth.login",
            resourceType: "user",
            result: "DENIED",
            metadata: { email, reason: !user ? "no_such_user" : "inactive" },
          });
          return null;
        }

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) {
          await logAudit({
            institutionId: user.institutionId,
            actorUserId: user.id,
            action: "auth.login",
            resourceType: "user",
            resourceId: user.id,
            result: "DENIED",
            metadata: { reason: "bad_password" },
          });
          return null;
        }

        resetRateLimit(rateLimitKey);

        await logAudit({
          institutionId: user.institutionId,
          actorUserId: user.id,
          action: "auth.login",
          resourceType: "user",
          resourceId: user.id,
          result: "SUCCESS",
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          institutionId: user.institutionId,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.institutionId = user.institutionId;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.role) {
        // token.sub is the JWT subject, set to authorize()'s returned
        // user.id — the default Auth.js session shape doesn't carry it
        // through automatically once this callback is overridden.
        if (token.sub) {
          session.user.id = token.sub;
        }
        session.user.role = token.role;
        session.user.institutionId = token.institutionId ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
