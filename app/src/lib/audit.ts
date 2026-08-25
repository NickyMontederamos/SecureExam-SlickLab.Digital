import type { AuditResult, Prisma } from "@prisma/client";
import { forPlatform } from "./tenant-db";

interface AuditEvent {
  institutionId?: string | null;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string;
  result: AuditResult;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * WHO / WHAT / WHEN / WHERE / RESULT (master prompt §20). Always writes
 * through forPlatform() rather than a tenant-scoped client — audit writes
 * happen at moments (e.g. a failed login before we know the tenant, or
 * platform-level actions) where a tenant scope may not exist yet, and the
 * table itself has no route that lets a caller read another tenant's rows
 * (route handlers must filter by session.user.institutionId themselves).
 *
 * Deliberately never throws into the caller — a logging failure must not
 * block the underlying action (e.g. a successful login) from succeeding,
 * but it is surfaced to the server console so it isn't silently lost.
 */
export async function logAudit(event: AuditEvent): Promise<void> {
  try {
    await forPlatform().auditLog.create({
      data: {
        institutionId: event.institutionId ?? undefined,
        actorUserId: event.actorUserId ?? undefined,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        result: event.result,
        metadata: event.metadata as Prisma.InputJsonValue | undefined,
        ipAddress: event.ipAddress,
      },
    });
  } catch (error) {
    console.error("[audit] failed to write audit log entry", event.action, error);
  }
}
