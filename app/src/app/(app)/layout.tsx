import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";

/**
 * Shared chrome for every authenticated route (dashboard, courses, exams,
 * attempts, admin, users). /login sits outside this route group deliberately
 * — it has its own centered branding treatment and shouldn't get a second
 * header above it.
 */
export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppHeader />
      {children}
    </>
  );
}
