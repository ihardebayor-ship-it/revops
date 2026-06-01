import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { can } from "@revops/auth/policy";
import { withTenant, schema } from "@revops/db/client";
import { sales as salesDomain, reconciliation as reconDomain } from "@revops/domain";
import { Money, PageHeader, Pill, Time } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";
import { LinkerCard } from "./linker-card";
import { RecomputeCommissionButton } from "./recompute-commission-button";
import { RefundCard } from "./refund-card";

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; saleId: string }>;
}) {
  const { workspace: slug, saleId } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);

  const detail = await withTenant(ctx.authCtx, async (db) => {
    const sale = await salesDomain.getSale(db, { saleId, workspaceId: ctx.workspace.id });
    if (!sale) return null;
    const [recipients, installments] = await Promise.all([
      salesDomain.getSaleRecipients(db, { saleId }),
      salesDomain.getSaleInstallments(db, { saleId }),
    ]);
    const customer = sale.customerId
      ? ((
          await db
            .select({
              id: schema.customers.id,
              email: schema.customers.primaryEmail,
              name: schema.customers.name,
            })
            .from(schema.customers)
            .where(eq(schema.customers.id, sale.customerId))
            .limit(1)
        )[0] ?? null)
      : null;

    const suggestions = sale.linkedCallId
      ? []
      : await reconDomain.suggestLinksForSale(db, {
          saleId,
          workspaceId: ctx.workspace.id,
          limit: 5,
        });

    const linkedCall = sale.linkedCallId
      ? ((
          await db
            .select({
              id: schema.calls.id,
              contactName: schema.calls.contactName,
              contactEmail: schema.calls.contactEmail,
              appointmentAt: schema.calls.appointmentAt,
            })
            .from(schema.calls)
            .where(eq(schema.calls.id, sale.linkedCallId))
            .limit(1)
        )[0] ?? null)
      : null;

    const [entries, recomputeRuns] = await Promise.all([
      db
        .select({
          id: schema.commissionEntries.id,
          installmentId: schema.commissionEntries.installmentId,
          recipientUserId: schema.commissionEntries.recipientUserId,
          salesRoleId: schema.commissionEntries.salesRoleId,
          salesRoleVersionId: schema.commissionEntries.salesRoleVersionId,
          ruleId: schema.commissionEntries.ruleId,
          ruleVersionId: schema.commissionEntries.ruleVersionId,
          amount: schema.commissionEntries.amount,
          currency: schema.commissionEntries.currency,
          status: schema.commissionEntries.status,
          pendingUntil: schema.commissionEntries.pendingUntil,
          availableAt: schema.commissionEntries.availableAt,
          paidAt: schema.commissionEntries.paidAt,
          clawedBackAt: schema.commissionEntries.clawedBackAt,
          canceledAt: schema.commissionEntries.canceledAt,
          canceledReason: schema.commissionEntries.canceledReason,
          computedFrom: schema.commissionEntries.computedFrom,
        })
        .from(schema.commissionEntries)
        .where(eq(schema.commissionEntries.saleId, saleId))
        .orderBy(asc(schema.commissionEntries.installmentId)),
      db
        .select({
          id: schema.commissionRecomputeRuns.id,
          runAt: schema.commissionRecomputeRuns.runAt,
          recipientCount: schema.commissionRecomputeRuns.recipientCount,
          entryCount: schema.commissionRecomputeRuns.entryCount,
          voidedCount: schema.commissionRecomputeRuns.voidedCount,
          durationMs: schema.commissionRecomputeRuns.durationMs,
          rulesetHash: schema.commissionRecomputeRuns.rulesetHash,
          triggeredBy: schema.commissionRecomputeRuns.triggeredBy,
          error: schema.commissionRecomputeRuns.error,
        })
        .from(schema.commissionRecomputeRuns)
        .where(eq(schema.commissionRecomputeRuns.saleId, saleId))
        .orderBy(asc(schema.commissionRecomputeRuns.runAt))
        .limit(5),
    ]);

    return {
      sale,
      recipients,
      installments,
      customer,
      suggestions,
      linkedCall,
      entries,
      recomputeRuns,
    };
  });

  if (!detail) notFound();

  const {
    sale,
    recipients,
    installments,
    customer,
    suggestions,
    linkedCall,
    entries,
    recomputeRuns,
  } = detail;
  const entryStatusVariant: Record<string, "info" | "positive" | "won" | "danger" | "neutral"> = {
    pending: "info",
    available: "positive",
    paid: "won",
    clawed_back: "danger",
    voided: "neutral",
  };
  const canRecomputeCommissions = can(ctx.authCtx, "commission:rule:update");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={sale.productName || "Sale"}
        description={customer ? undefined : "Customer details unavailable"}
      />
      {customer && (
        <p className="-mt-3 text-sm">
          <span className="text-zinc-500">Customer · </span>
          <a
            href={`/${slug}/customers/${customer.id}`}
            className="text-zinc-100 hover:text-blue-400"
          >
            {customer.name || customer.email}
          </a>
        </p>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat label="Booked">
          <Money amount={sale.bookedAmount} currency={sale.currency} />
        </Stat>
        <Stat label="Collected">
          <Money amount={sale.collectedAmount} currency={sale.currency} />
        </Stat>
        <Stat label="Closed">
          <Time value={sale.closedAt} />
        </Stat>
      </section>

      <LinkerCard
        slug={slug}
        saleId={sale.id}
        workspaceId={ctx.workspace.id}
        subAccountId={sale.subAccountId}
        linkedCall={linkedCall}
        suggestions={suggestions.map((s) => ({
          callId: s.callId,
          score: s.score,
          signals: s.signals,
          contactName: s.call.contactName ?? null,
          contactEmail: s.call.contactEmail ?? null,
          appointmentAt: s.call.appointmentAt ? s.call.appointmentAt.toISOString() : null,
        }))}
      />

      <RefundCard
        saleId={sale.id}
        bookedAmount={sale.bookedAmount}
        currency={sale.currency}
        refundStatus={sale.refundStatus}
        refundedAmount={sale.refundedAmount}
      />

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          Commission recipients · {recipients.length}
        </h2>
        {recipients.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
            No recipients. Sales-role assignments must exist before creating a sale.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
            {recipients.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="font-mono text-xs text-zinc-500">{r.userId.slice(0, 8)}</span>
                <span className="flex-1 text-zinc-100">
                  {Math.round(Number(r.sharePct) * 100)}% share
                </span>
                <Pill>{r.status}</Pill>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h2 className="text-sm font-medium text-zinc-300">
            Commission entries · {entries.length}
          </h2>
          {canRecomputeCommissions && (
            <RecomputeCommissionButton
              saleId={sale.id}
              workspaceId={ctx.workspace.id}
              subAccountId={ctx.membership.subAccountId}
            />
          )}
        </div>
        {recomputeRuns.length > 0 && (
          <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-medium text-zinc-100">Recompute audit</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Latest run <Time value={recomputeRuns[recomputeRuns.length - 1]!.runAt} /> -{" "}
                  {recomputeRuns.length} recorded {recomputeRuns.length === 1 ? "run" : "runs"}
                </p>
              </div>
              <Pill variant={recomputeRuns.some((run) => run.error) ? "danger" : "positive"}>
                {recomputeRuns.some((run) => run.error) ? "failed run" : "clean"}
              </Pill>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-2">
              {recomputeRuns.slice(-2).map((run) => (
                <p key={run.id}>
                  <Time value={run.runAt} /> - {run.entryCount} entries, {run.voidedCount} voided
                  {run.rulesetHash ? ` - rules ${run.rulesetHash}` : ""}
                  {run.triggeredBy ? ` - ${run.triggeredBy}` : ""}
                  {run.error ? <span className="text-red-400"> - {run.error}</span> : null}
                </p>
              ))}
            </div>
          </div>
        )}
        {entries.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
            Engine has not produced entries yet — they appear seconds after sale creation.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
            {entries.map((e) => {
              const explanation = getCommissionExplanation(e.computedFrom);
              return (
                <li key={e.id} className="flex flex-col gap-3 px-4 py-3 text-sm">
                  <div className="grid grid-cols-12 items-center gap-3">
                    <span className="col-span-3 font-mono text-xs text-zinc-500">
                      {e.recipientUserId.slice(0, 8)}
                    </span>
                    <span className="col-span-3 text-zinc-100">
                      <Money amount={e.amount} currency={e.currency} />
                    </span>
                    <span className="col-span-3">
                      <Pill variant={entryStatusVariant[e.status] ?? "neutral"}>
                        {e.status.replace("_", " ")}
                      </Pill>
                    </span>
                    <span className="col-span-3 text-right text-xs text-zinc-500">
                      {e.status === "pending" && e.pendingUntil ? (
                        <>
                          Holds until <Time value={e.pendingUntil} />
                        </>
                      ) : e.availableAt ? (
                        <Time value={e.availableAt} />
                      ) : null}
                    </span>
                  </div>
                  {explanation && (
                    <div className="rounded-md bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
                      <p className="text-zinc-300">
                        {explanation.amount.base} base ×{" "}
                        {formatPercent(explanation.amount.sharePct)} share ={" "}
                        {explanation.amount.computedAmount} {explanation.amount.currency}
                      </p>
                      <div className="mt-2 grid gap-x-4 gap-y-1 md:grid-cols-2">
                        <AuditFact label="Rule" value={shortId(e.ruleId)} />
                        <AuditFact label="Rule version" value={shortId(e.ruleVersionId)} />
                        <AuditFact label="Sales role" value={shortId(e.salesRoleId)} />
                        <AuditFact label="Role version" value={shortId(e.salesRoleVersionId)} />
                        <AuditFact
                          label="Base source"
                          value={formatReason(explanation.amount.baseSource)}
                        />
                        <AuditFact
                          label="Base reason"
                          value={formatReason(explanation.amount.baseReason)}
                        />
                        <AuditFact
                          label="Paid on"
                          value={formatReason(explanation.matchedRule.paidOn)}
                        />
                        <AuditFact
                          label="Hold"
                          value={`${explanation.hold.holdDays} days from ${formatReason(explanation.hold.anchorSource)}`}
                        />
                        <AuditFact
                          label="Recipient source"
                          value={formatReason(explanation.recipient.source)}
                        />
                        <AuditFact label="Entry" value={shortId(e.id)} />
                      </div>
                    </div>
                  )}
                  {(e.status === "paid" || e.status === "clawed_back") && (
                    <p className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      Locked ledger history. Recompute will not rewrite this{" "}
                      {e.status.replace("_", " ")} entry
                      {e.paidAt ? (
                        <>
                          ; paid <Time value={e.paidAt} />
                        </>
                      ) : null}
                      {e.clawedBackAt ? (
                        <>
                          ; clawed back <Time value={e.clawedBackAt} />
                        </>
                      ) : null}
                      .
                    </p>
                  )}
                  {e.status === "voided" && e.canceledReason && (
                    <p className="rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-500">
                      Voided because {e.canceledReason.replace(/_/g, " ")}
                      {e.canceledAt ? (
                        <>
                          {" "}
                          on <Time value={e.canceledAt} />
                        </>
                      ) : null}
                      .
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          Installments · {installments.length}
        </h2>
        <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
          {installments.map((i) => (
            <li key={i.id} className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm">
              <span className="col-span-1 text-zinc-500">#{i.sequence}</span>
              <span className="col-span-3 text-zinc-100">
                <Money amount={i.expectedAmount} currency={i.currency} />
              </span>
              <span className="col-span-3 text-zinc-400">
                Due {new Date(i.expectedDate).toLocaleDateString()}
              </span>
              <span className="col-span-3">
                <Pill variant={i.status === "collected" ? "positive" : "neutral"}>{i.status}</Pill>
              </span>
              <span className="col-span-2 text-right text-zinc-500">
                {i.collectedAt && <Time value={i.collectedAt} />}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

type CommissionExplanation = {
  matchedRule: {
    ruleId: string | null;
    ruleVersionId: string | null;
    paidOn: string;
    holdDays: number;
  };
  recipient: {
    source: string;
    salesRoleId: string;
    salesRoleVersionId: string;
  };
  amount: {
    base: string;
    baseSource: string;
    baseReason: string;
    sharePct: number;
    computedAmount: string;
    currency: string;
  };
  hold: {
    holdDays: number;
    anchorSource: string;
  };
};

function getCommissionExplanation(
  computedFrom: Record<string, unknown>,
): CommissionExplanation | null {
  const explanation = computedFrom.explanation;
  if (!explanation || typeof explanation !== "object") return null;
  return explanation as CommissionExplanation;
}

function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : "default";
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatReason(value: string): string {
  return value.replace(/_/g, " ");
}

function AuditFact({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-zinc-500">{label}: </span>
      <span className="text-zinc-300">{value}</span>
    </p>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-base text-zinc-100">{children}</p>
    </div>
  );
}
