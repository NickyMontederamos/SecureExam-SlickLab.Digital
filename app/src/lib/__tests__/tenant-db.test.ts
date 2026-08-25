import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forPlatform, forTenant, CrossTenantAccessError } from "../tenant-db";

/**
 * Proves master prompt §8's mandatory requirement in code, not just in
 * prose: "TENANT A attempting to access TENANT B DATA" must always resolve
 * to ACCESS DENIED. This is the highest-priority test in the whole project
 * — every other feature (courses, questions, exams, grades) sits on top of
 * this guarantee holding.
 */
describe("tenant isolation (forTenant)", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  let institutionA: { id: string };
  let institutionB: { id: string };
  let courseA: { id: string };
  let courseB: { id: string };

  beforeAll(async () => {
    const platform = forPlatform();
    institutionA = await platform.institution.create({
      data: { name: `Tenant A ${runId}`, slug: `tenant-a-${runId}` },
    });
    institutionB = await platform.institution.create({
      data: { name: `Tenant B ${runId}`, slug: `tenant-b-${runId}` },
    });
    courseA = await platform.course.create({
      data: {
        institutionId: institutionA.id,
        code: "LAW101",
        name: "Legal Method",
        academicYear: "2026-2027",
      },
    });
    courseB = await platform.course.create({
      data: {
        institutionId: institutionB.id,
        code: "LAW101",
        name: "Legal Method (Tenant B)",
        academicYear: "2026-2027",
      },
    });
  });

  afterAll(async () => {
    const platform = forPlatform();
    await platform.course.deleteMany({ where: { institutionId: { in: [institutionA.id, institutionB.id] } } });
    await platform.institution.deleteMany({ where: { id: { in: [institutionA.id, institutionB.id] } } });
  });

  it("findFirst scoped to tenant A cannot see tenant B's course by id", async () => {
    const asTenantA = forTenant(institutionA.id);
    const result = await asTenantA.course.findFirst({ where: { id: courseB.id } });
    expect(result).toBeNull();
  });

  it("findFirst scoped to tenant A can see tenant A's own course", async () => {
    const asTenantA = forTenant(institutionA.id);
    const result = await asTenantA.course.findFirst({ where: { id: courseA.id } });
    expect(result?.id).toBe(courseA.id);
  });

  it("findMany scoped to tenant A never includes tenant B's rows", async () => {
    const asTenantA = forTenant(institutionA.id);
    const results = await asTenantA.course.findMany({});
    expect(results.some((c) => c.id === courseB.id)).toBe(false);
    expect(results.some((c) => c.id === courseA.id)).toBe(true);
  });

  it("findUnique on a tenant-scoped model is refused outright, not silently unscoped", async () => {
    const asTenantA = forTenant(institutionA.id);
    await expect(asTenantA.course.findUnique({ where: { id: courseB.id } })).rejects.toThrow(
      CrossTenantAccessError
    );
    // Also refused for the tenant's own row — findFirst must be used instead, deliberately, everywhere.
    await expect(asTenantA.course.findUnique({ where: { id: courseA.id } })).rejects.toThrow(
      CrossTenantAccessError
    );
  });

  it("update scoped to tenant A cannot modify tenant B's course", async () => {
    const asTenantA = forTenant(institutionA.id);
    await expect(
      asTenantA.course.update({ where: { id: courseB.id }, data: { name: "Hijacked" } })
    ).rejects.toThrow();

    const stillOriginal = await forPlatform().course.findUnique({ where: { id: courseB.id } });
    expect(stillOriginal?.name).toBe("Legal Method (Tenant B)");
  });

  it("delete scoped to tenant A cannot delete tenant B's course", async () => {
    const asTenantA = forTenant(institutionA.id);
    await expect(asTenantA.course.delete({ where: { id: courseB.id } })).rejects.toThrow();

    const stillExists = await forPlatform().course.findUnique({ where: { id: courseB.id } });
    expect(stillExists).not.toBeNull();
  });

  it("create refuses a mismatched institutionId instead of silently overriding it", async () => {
    const asTenantA = forTenant(institutionA.id);
    await expect(
      asTenantA.course.create({
        data: {
          institutionId: institutionB.id, // attacker-supplied wrong tenant
          code: "LAW999",
          name: "Should never be created",
          academicYear: "2026-2027",
        },
      })
    ).rejects.toThrow(CrossTenantAccessError);
  });

  it("create without an explicit institutionId is still forced into the caller's tenant", async () => {
    const asTenantA = forTenant(institutionA.id);
    const created = await asTenantA.course.create({
      data: {
        code: "LAW202",
        name: "Evidence",
        academicYear: "2026-2027",
      } as never, // institutionId intentionally omitted — the extension must inject it
    });
    expect(created.institutionId).toBe(institutionA.id);

    await forPlatform().course.delete({ where: { id: created.id } });
  });
});
