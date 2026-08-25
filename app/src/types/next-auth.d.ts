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
    user: {
      role: Role;
      institutionId: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
    institutionId?: string | null;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: Role;
    institutionId?: string | null;
  }
}
