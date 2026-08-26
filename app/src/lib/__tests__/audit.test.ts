import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "../rbac";
import { forPlatform } from "../tenant-db";
import { listAuditLog, logAudit } from "../audit";

describe("listAuditLog", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  let institutionA: { id: string };
  let institutionB: { id: string };
  let adminA: { id: string };

  beforeAll(async () => {
    const platform = forPlatform();
    institutionA = await platform.institution.create({
      data: { name: `Tenant A ${runId}`, slug: `audit-tenant-a-${runId}` },
    });
    institutionB = await platform.institution.create({
      data: { name: `Tenant B ${runId}`, slug: `audit-tenant-b-${runId}` },
    });
    adminA = await platform.user.create({
      data: { institutionId: institutionA.id, email: `audit-admin-${runId}@test.local`, name: "Admin A", role: "INSTITUTION_ADMIN", passwordHash: "x" },
    });

    await logAudit({
      institutionId: institutionA.id,
      actorUserId: adminA.id,
      action: "auth.login",
      resourceType: "user",
      resourceId: adminA.id,
      result: "SUCCESS",
    });
    await logAudit({
      institutionId: institutionA.id,
      action: "auth.login",
      resourceType: "user",
      result: "DENIED",
      metadata: { email: "nobody@test.local", reason: "no_such_user" },
    });
    await logAudit({
      institutionId: institutionB.id,
      action: "auth.login",
      resourceType: "user",
      result: "SUCCESS",
    });
  });

  afterAll(async () => {
    const platform = forPlatform();
    await platform.auditLog.deleteMany({ where: { institutionId: { in: [institutionA.id, institutionB.id] } } });
    await platform.user.deleteMany({ where: { institutionId: institutionA.id } });
    await platform.institution.deleteMany({ where: { id: { in: [institutionA.id, institutionB.id] } } });
  });

  it("refuses roles without audit_log:read", async () => {
    await expect(listAuditLog(institutionA.id, { role: "FACULTY" }, {})).rejects.toThrow(ForbiddenError);
  });

  it("returns only this tenant's events, most recent first", async () => {
    const entries = await listAuditLog(institutionA.id, { role: "INSTITUTION_ADMIN" }, {});
    expect(entries.length).toBe(2);
    expect(entries.every((e) => e.institutionId === institutionA.id)).toBe(true);
  });

  it("filters by result", async () => {
    const denied = await listAuditLog(institutionA.id, { role: "INSTITUTION_ADMIN" }, { result: "DENIED" });
    expect(denied.length).toBe(1);
    expect(denied[0].result).toBe("DENIED");
  });

  it("filters by action prefix", async () => {
    const entries = await listAuditLog(institutionA.id, { role: "INSTITUTION_ADMIN" }, { actionPrefix: "auth." });
    expect(entries.length).toBe(2);
    const none = await listAuditLog(institutionA.id, { role: "INSTITUTION_ADMIN" }, { actionPrefix: "course." });
    expect(none.length).toBe(0);
  });
});
