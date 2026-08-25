import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "../rbac";
import { forPlatform } from "../tenant-db";
import { createInstitution, EmailTakenError, listInstitutions, SlugTakenError } from "../institutions";

describe("institution onboarding (SUPER_ADMIN/PLATFORM_ADMIN only)", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  const createdInstitutionIds: string[] = [];

  afterAll(async () => {
    const platform = forPlatform();
    await platform.user.deleteMany({ where: { institutionId: { in: createdInstitutionIds } } });
    await platform.institution.deleteMany({ where: { id: { in: createdInstitutionIds } } });
  });

  it("creates an institution and its first INSTITUTION_ADMIN atomically", async () => {
    const { institution, admin } = await createInstitution(
      { role: "SUPER_ADMIN" },
      {
        name: `New Law School ${runId}`,
        slug: `new-law-school-${runId}`,
        adminName: "First Admin",
        adminEmail: `admin-${runId}@newlawschool.demo`,
        adminPassword: "SomeStrongPass!1",
      }
    );
    createdInstitutionIds.push(institution.id);

    expect(institution.slug).toBe(`new-law-school-${runId}`);
    expect(admin.role).toBe("INSTITUTION_ADMIN");
    expect(admin.institutionId).toBe(institution.id);
  });

  it("PLATFORM_ADMIN can also create institutions", async () => {
    const { institution } = await createInstitution(
      { role: "PLATFORM_ADMIN" },
      {
        name: `Platform Admin School ${runId}`,
        slug: `platform-admin-school-${runId}`,
        adminName: "PA Admin",
        adminEmail: `pa-admin-${runId}@newlawschool.demo`,
        adminPassword: "SomeStrongPass!1",
      }
    );
    createdInstitutionIds.push(institution.id);
    expect(institution.id).toBeTruthy();
  });

  it("refuses a duplicate slug", async () => {
    await expect(
      createInstitution(
        { role: "SUPER_ADMIN" },
        {
          name: "Duplicate Slug School",
          slug: `new-law-school-${runId}`, // same as the first test
          adminName: "Admin",
          adminEmail: `unique-${runId}@newlawschool.demo`,
          adminPassword: "SomeStrongPass!1",
        }
      )
    ).rejects.toThrow(SlugTakenError);
  });

  it("refuses a duplicate admin email", async () => {
    await expect(
      createInstitution(
        { role: "SUPER_ADMIN" },
        {
          name: "Another School",
          slug: `another-school-${runId}`,
          adminName: "Admin",
          adminEmail: `admin-${runId}@newlawschool.demo`, // same as the first test
          adminPassword: "SomeStrongPass!1",
        }
      )
    ).rejects.toThrow(EmailTakenError);
  });

  it("refuses institution creation for every non-platform role", async () => {
    for (const role of ["INSTITUTION_ADMIN", "FACULTY", "PROCTOR", "STUDENT"] as const) {
      await expect(
        createInstitution(
          { role },
          {
            name: "Should never be created",
            slug: `should-not-exist-${runId}-${role}`,
            adminName: "Nobody",
            adminEmail: `nobody-${runId}-${role}@test.local`,
            adminPassword: "SomeStrongPass!1",
          }
        )
      ).rejects.toThrow(ForbiddenError);
    }
  });

  it("only platform roles can list institutions", async () => {
    const institutions = await listInstitutions({ role: "SUPER_ADMIN" });
    expect(institutions.length).toBeGreaterThan(0);

    await expect(listInstitutions({ role: "INSTITUTION_ADMIN" })).rejects.toThrow(ForbiddenError);
    await expect(listInstitutions({ role: "STUDENT" })).rejects.toThrow(ForbiddenError);
  });
});
