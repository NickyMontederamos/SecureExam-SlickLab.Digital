import "dotenv/config";
import { forPlatform } from "../src/lib/tenant-db";
import { hashPassword } from "../src/lib/password";

/**
 * Demo data for local development and for a pitch demo: one institution
 * modeled on the College of Maasin — College of Law, with one user per
 * role so the whole admin -> faculty -> student flow can be clicked
 * through. Every seeded password is DEMO-ONLY and printed below — never
 * reuse this script's output as real credentials.
 */
async function main() {
  const db = forPlatform();

  const institution = await db.institution.upsert({
    where: { slug: "college-of-maasin-law" },
    update: {},
    create: {
      name: "College of Maasin — College of Law",
      slug: "college-of-maasin-law",
    },
  });

  const demoPassword = "DemoPass!2026";
  const passwordHash = await hashPassword(demoPassword);

  const admin = await db.user.upsert({
    where: { email: "admin@cmlaw.demo" },
    update: {},
    create: {
      institutionId: institution.id,
      email: "admin@cmlaw.demo",
      name: "Institution Admin",
      role: "INSTITUTION_ADMIN",
      passwordHash,
    },
  });

  const faculty = await db.user.upsert({
    where: { email: "faculty@cmlaw.demo" },
    update: {},
    create: {
      institutionId: institution.id,
      email: "faculty@cmlaw.demo",
      name: "Prof. Faculty",
      role: "FACULTY",
      passwordHash,
    },
  });

  const student = await db.user.upsert({
    where: { email: "student@cmlaw.demo" },
    update: {},
    create: {
      institutionId: institution.id,
      email: "student@cmlaw.demo",
      name: "Demo Student",
      role: "STUDENT",
      passwordHash,
    },
  });

  const course = await db.course.upsert({
    where: {
      institutionId_code_academicYear: {
        institutionId: institution.id,
        code: "LAW101",
        academicYear: "2026-2027",
      },
    },
    update: {},
    create: {
      institutionId: institution.id,
      code: "LAW101",
      name: "Legal Method and Legal Writing",
      academicYear: "2026-2027",
    },
  });

  await db.courseFaculty.upsert({
    where: { courseId_userId: { courseId: course.id, userId: faculty.id } },
    update: {},
    create: { institutionId: institution.id, courseId: course.id, userId: faculty.id },
  });

  await db.enrollment.upsert({
    where: { courseId_userId: { courseId: course.id, userId: student.id } },
    update: {},
    create: { institutionId: institution.id, courseId: course.id, userId: student.id },
  });

  console.log("Seed complete.");
  console.log(`Institution: ${institution.name} (${institution.slug})`);
  console.log(`Demo password for all seeded users: ${demoPassword}`);
  console.log(`  admin@cmlaw.demo   (INSTITUTION_ADMIN)`);
  console.log(`  faculty@cmlaw.demo (FACULTY)`);
  console.log(`  student@cmlaw.demo (STUDENT)`);
  console.log(`Admin id: ${admin.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await forPlatform().$disconnect();
  });
