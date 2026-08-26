import type { AuditResult } from "@prisma/client";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/rbac";
import { listAuditLog } from "@/lib/audit";
import { Badge, Button, Card, EmptyState, PageHeader, Section, inputClassName, labelClassName } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";

const RESULT_TONE: Record<AuditResult, BadgeTone> = {
  SUCCESS: "green",
  DENIED: "amber",
  ERROR: "red",
};

const RESULT_OPTIONS: AuditResult[] = ["SUCCESS", "DENIED", "ERROR"];

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string; action?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id || !session.user.institutionId) {
    redirect("/login");
  }
  if (!can(session.user.role, "audit_log", "read")) {
    redirect("/dashboard");
  }

  const { result, action } = await searchParams;
  const resultFilter = RESULT_OPTIONS.includes(result as AuditResult) ? (result as AuditResult) : undefined;
  const institutionId = session.user.institutionId;

  const entries = await listAuditLog(institutionId, session.user, {
    result: resultFilter,
    actionPrefix: action?.trim() || undefined,
  });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-6">
      <PageHeader backHref="/dashboard" title="Audit Log" subtitle="Every recorded login and admin action for this institution, most recent first." />

      <Section title="Filters">
        <Card>
          <form className="flex flex-wrap items-end gap-3">
            <label className={labelClassName}>
              Result
              <select name="result" defaultValue={resultFilter ?? ""} className={inputClassName}>
                <option value="">All</option>
                {RESULT_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClassName}>
              Action starts with
              <input name="action" defaultValue={action ?? ""} placeholder="auth.login" className={inputClassName} />
            </label>
            <Button type="submit" variant="secondary">
              Apply
            </Button>
          </form>
        </Card>
      </Section>

      <Section title={`Events (${entries.length}${entries.length === 200 ? "+" : ""})`}>
        {entries.length === 0 ? (
          <EmptyState>No audit events match these filters.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Actor</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Resource</th>
                  <th className="px-4 py-2 font-medium">Result</th>
                  <th className="px-4 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                      {e.createdAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </td>
                    <td className="px-4 py-2 text-slate-700">
                      {e.actor?.name ?? (e.metadata as { email?: string } | null)?.email ?? "—"}
                    </td>
                    <td className="px-4 py-2 font-medium text-slate-900">{e.action}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {e.resourceType}
                      {e.resourceId ? ` · ${e.resourceId.slice(0, 8)}…` : ""}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={RESULT_TONE[e.result]}>{e.result}</Badge>
                    </td>
                    <td className="max-w-xs truncate px-4 py-2 text-xs text-slate-500">
                      {e.metadata ? JSON.stringify(e.metadata) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </main>
  );
}
