import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

// Extend Auth.js's built-in types with the fields our JWT/session actually
// carry, so `session.user.role` etc. are typed instead of `any`.
declare module "next-auth" {
  interface User {
    role: Role;
    institutionId: string | null;
  }

  interface Session {
    // id is required here (not the optional string it is on DefaultSession["user"]) —
    // our session() callback always sets it from token.sub for every authenticated
    // session, so every route that checks session?.user can rely on .id being present.
    user: {
      id: string;
      role: Role;
      institutionId: string | null;
    } & Omit<NonNullable<DefaultSession["user"]>, "id">;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
    institutionId?: string | null;
    /** Epoch ms of the original sign-in. Never rewritten — it's what User.sessionsValidAfter is compared against (see auth.ts). */
    loginAt?: number;
    /** Epoch ms of the last database revalidation of this token's claims (see auth.ts). */
    checkedAt?: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: Role;
    institutionId?: string | null;
    /** Epoch ms of the original sign-in. Never rewritten — it's what User.sessionsValidAfter is compared against (see auth.ts). */
    loginAt?: number;
    /** Epoch ms of the last database revalidation of this token's claims (see auth.ts). */
    checkedAt?: number;
  }
}
