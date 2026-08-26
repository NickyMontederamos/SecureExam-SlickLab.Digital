import type { AuditResult, Prisma, Role } from "@prisma/client";
import { assertCan } from "./rbac";
import { forPlatform, forTenant } from "./tenant-db";

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

export interface AuditLogFilter {
  result?: AuditResult;
  actorUserId?: string;
  /** Matches the start of `action` (e.g. "auth." to see every login/logout event). */
  actionPrefix?: string;
  limit?: number;
}

/**
 * Institution-scoped audit trail read for the admin audit-log viewer
 * (docs/PITCH_ROADMAP.md Milestone 6.7). Gated by rbac.ts's audit_log:"read"
 * (SUPER_ADMIN/PLATFORM_ADMIN/INSTITUTION_ADMIN only). Rows with a null
 * institutionId (e.g. a failed login before the tenant was resolved) never
 * belonged to this tenant and are correctly excluded by forTenant's scoping.
 */
export async function listAuditLog(institutionId: string, actor: { role: Role }, filter: AuditLogFilter = {}) {
  assertCan(actor.role, "audit_log", "read");

  const db = forTenant(institutionId);
  return db.auditLog.findMany({
    where: {
      ...(filter.result ? { result: filter.result } : {}),
      ...(filter.actorUserId ? { actorUserId: filter.actorUserId } : {}),
      ...(filter.actionPrefix ? { action: { startsWith: filter.actionPrefix } } : {}),
    },
    include: { actor: true },
    orderBy: { createdAt: "desc" },
    take: filter.limit ?? 200,
  });
}
