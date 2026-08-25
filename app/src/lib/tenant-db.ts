import { prisma } from "./prisma";

/**
 * Models that carry institutionId and must always be scoped to the caller's
 * tenant. Anything not listed here is either global (Institution itself) or
 * intentionally cross-tenant, and must go through forPlatform() instead —
 * never add a model here casually; every addition changes what's enforced.
 */
const TENANT_SCOPED_MODELS = new Set([
  "User",
  "Course",
  "CourseFaculty",
  "Enrollment",
  "Question",
  "Exam",
  "ExamAttempt",
  "AuditLog",
  "DeviceRegistration",
]);

// Operations where a tenant filter can be safely merged into `where`.
const WHERE_FILTERABLE_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "updateMany",
  "deleteMany",
]);

// Prisma's "extended where unique input" allows extra non-unique filters
// alongside the unique key on singular update/delete, so institutionId can
// be merged into these too without breaking the unique lookup.
const UNIQUE_WHERE_OPERATIONS = new Set(["update", "delete"]);

export class CrossTenantAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossTenantAccessError";
  }
}

/**
 * Returns a Prisma client scoped to a single institution. Every query
 * against a tenant-scoped model is forced to include institutionId in its
 * `where`, and every create is forced to carry the same institutionId — so
 * a bug in a route handler (a forgotten `where` clause, a copy-pasted
 * query) cannot leak another tenant's data. This is the enforcement layer
 * for master prompt §8: "tenant isolation ... backend and database access
 * layer" / "never rely solely on frontend filtering".
 *
 * findUnique/findUniqueOrThrow are intentionally refused here — Prisma only
 * allows unique-field filters on those, so an institutionId filter can't be
 * merged in without also touching the unique key. Callers must use
 * findFirst with an explicit id filter instead, which IS scoped.
 */
export function forTenant(institutionId: string) {
  if (!institutionId) {
    throw new Error("forTenant() called without an institutionId");
  }

  return prisma.$extends({
    name: `tenant-scoped:${institutionId}`,
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma's $allOperations args are intentionally untyped across models.
        async $allOperations({ model, operation, args, query }: any) {
          if (!TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          if (operation === "findUnique" || operation === "findUniqueOrThrow") {
            throw new CrossTenantAccessError(
              `${model}.${operation} bypasses tenant scoping — use findFirst with an explicit id filter instead`
            );
          }

          if (WHERE_FILTERABLE_OPERATIONS.has(operation) || UNIQUE_WHERE_OPERATIONS.has(operation)) {
            args.where = { ...(args.where ?? {}), institutionId };
            return query(args);
          }

          if (operation === "create") {
            const dataInstitutionId = args.data?.institutionId;
            if (dataInstitutionId !== undefined && dataInstitutionId !== institutionId) {
              throw new CrossTenantAccessError(`${model}.create with mismatched institutionId`);
            }
            args.data = { ...(args.data ?? {}), institutionId };
            return query(args);
          }

          // Any operation not explicitly handled above (aggregate, groupBy,
          // upsert, createMany, ...) is refused rather than silently
          // unscoped. Add explicit handling above before using it.
          throw new CrossTenantAccessError(`${model}.${operation} is not tenant-scoping-aware yet`);
        },
      },
    },
  });
}

/**
 * Unscoped client for SUPER_ADMIN / PLATFORM_ADMIN cross-tenant operations
 * only (e.g. onboarding a new institution). Every call site must be guarded
 * by an explicit role check for one of those two roles — grep for
 * `forPlatform()` before adding a new call site.
 */
export function forPlatform() {
  return prisma;
}
