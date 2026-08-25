import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "../rbac";
import { forPlatform } from "../tenant-db";
import { createUser, EmailTakenError, listUsers, setUserActive } from "../users";

describe("user management (INSTITUTION_ADMIN)", () => {
  const runId = Math.random().toString(36).slice(2, 10);
  let institutionA: { id: string };
  let institutionB: { id: string };

  beforeAll(async () => {
    const platform = forPlatform();
    institutionA = await platform.institution.create({
      data: { name: `Tenant A ${runId}`, slug: `user-tenant-a-${runId}` },
    });
    institutionB = await platform.institution.create({
      data: { name: `Tenant B ${runId}`, slug: `user-tenant-b-${runId}` },
    });
  });

  afterAll(async () => {
    const platform = forPlatform();
    await platform.user.deleteMany({ where: { institutionId: { in: [institutionA.id, institutionB.id] } } });
    await platform.institution.deleteMany({ where: { id: { in: [institutionA.id, institutionB.id] } } });
  });

  it("creates a faculty user in the caller's own institution", async () => {
    const faculty = await createUser(institutionA.id, { role: "INSTITUTION_ADMIN" }, {
      name: "New Faculty",
      email: `faculty-${runId}@test.local`,
      password: "SomeStrongPass!1",
      role: "FACULTY",
    });
    expect(faculty.institutionId).toBe(institutionA.id);
    expect(faculty.role).toBe("FACULTY");
  });

  it("refuses a duplicate email even across institutions", async () => {
    await expect(
      createUser(institutionB.id, { role: "INSTITUTION_ADMIN" }, {
        name: "Duplicate",
        email: `faculty-${runId}@test.local`, // same as above, different tenant
        password: "SomeStrongPass!1",
        role: "FACULTY",
      })
    ).rejects.toThrow(EmailTakenError);
  });

  it("refuses to create a platform-level role", async () => {
    await expect(
      createUser(institutionA.id, { role: "INSTITUTION_ADMIN" }, {
        name: "Sneaky",
        email: `sneaky-${runId}@test.local`,
        password: "SomeStrongPass!1",
        role: "SUPER_ADMIN",
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses user creation for roles without permission", async () => {
    for (const role of ["FACULTY", "STUDENT", "PROCTOR"] as const) {
      await expect(
        createUser(institutionA.id, { role }, {
          name: "Nope",
          email: `nope-${runId}-${role}@test.local`,
          password: "SomeStrongPass!1",
          role: "STUDENT",
        })
      ).rejects.toThrow(ForbiddenError);
    }
  });

  it("lists only the caller's own institution's users", async () => {
    const users = await listUsers(institutionA.id, { role: "INSTITUTION_ADMIN" });
    expect(users.every((u) => u.institutionId === institutionA.id)).toBe(true);
    expect(users.some((u) => u.email === `faculty-${runId}@test.local`)).toBe(true);
  });

  it("can deactivate a user", async () => {
    const users = await listUsers(institutionA.id, { role: "INSTITUTION_ADMIN" });
    const target = users.find((u) => u.email === `faculty-${runId}@test.local`)!;
    const updated = await setUserActive(institutionA.id, { role: "INSTITUTION_ADMIN" }, target.id, false);
    expect(updated.isActive).toBe(false);
  });
});
