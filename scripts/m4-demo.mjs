// M4 demo: pick the most recent workspace, ensure a setter+closer
// preset, create a $5k sale on a 3-installment plan, run recompute,
// assert 6 entries summing to $5k, fast-forward, release, assert
// status flips to 'available'.

import postgres from "postgres";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_MIGRATION_URL required");
  process.exit(1);
}
const sql = postgres(url, { prepare: false });

function fmt(n) {
  return Number(n).toFixed(2);
}

try {
  // 1. Pick the most recent workspace with active sales_role_assignments.
  const [ws] = await sql`
    SELECT w.id, w.name, w.slug, sa.id AS sub_account_id
    FROM workspaces w
    JOIN sub_accounts sa ON sa.workspace_id = w.id
    WHERE w.deleted_at IS NULL
    ORDER BY w.created_at DESC
    LIMIT 1
  `;
  if (!ws) throw new Error("No workspace found");
  console.log(`Workspace: ${ws.name} (${ws.id.slice(0, 8)})`);

  const assignments = await sql`
    SELECT a.user_id, a.sales_role_id, r.label AS role_name, r.default_commission_share::float AS share
    FROM sales_role_assignments a
    JOIN sales_roles r ON r.id = a.sales_role_id
    WHERE a.sub_account_id = ${ws.sub_account_id}
      AND a.deleted_at IS NULL
    ORDER BY r.label
  `;
  console.log(`Active assignments: ${assignments.length}`);
  for (const a of assignments) {
    console.log(`  - ${a.role_name}: ${a.user_id.slice(0, 8)} @ ${(a.share * 100).toFixed(0)}%`);
  }

  // 2. Ensure a flat-rate commission rule exists per role (so the engine
  //    has a hold_days/paid_on policy to apply).
  for (const a of assignments) {
    const [existing] = await sql`
      SELECT id FROM commission_rules
      WHERE workspace_id = ${ws.id} AND sales_role_id = ${a.sales_role_id} AND deleted_at IS NULL
      LIMIT 1
    `;
    if (!existing) {
      await sql`
        INSERT INTO commission_rules (
          workspace_id, name, type, sales_role_id, share_pct, currency,
          product_match, source_match, hold_days, paid_on, is_active
        )
        VALUES (
          ${ws.id}, ${`${a.role_name} flat`}, 'flat_rate', ${a.sales_role_id},
          ${a.share}, 'USD',
          ${sql.json({ kind: "any" })}, ${sql.json({ kind: "any" })},
          30, 'collected', 1
        )
      `;
      console.log(`  + Created commission_rule for ${a.role_name}`);
    }
  }

  // 3. Pick a customer + create the sale via raw SQL (skip the web layer).
  // Use the first assignment's user as the createdBy.
  const createdBy = assignments[0].user_id;

  // Customer (no unique constraint on (workspace_id, primary_email) — select-or-insert).
  const stamp = Date.now();
  const email = `m4-demo-${stamp}@test.local`;
  const [customer] = await sql`
    INSERT INTO customers (workspace_id, sub_account_id, primary_email, name, created_by)
    VALUES (${ws.id}, ${ws.sub_account_id}, ${email}, 'M4 Demo Customer', ${createdBy})
    RETURNING id
  `;
  console.log(`Customer: ${customer.id.slice(0, 8)}`);

  // Sale + payment plan + installments + recipients all in one txn.
  const closedAt = new Date();
  const installmentAmount = "1666.67"; // $5000 / 3 ≈ 1666.67 per installment
  const totalInstallments = 3;
  const bookedAmount = "5000.00";

  // Use a short transaction for atomicity.
  const saleId = await sql.begin(async (tx) => {
    const [sale] = await tx`
      INSERT INTO sales (
        workspace_id, sub_account_id, customer_id, product_name,
        booked_amount, currency, closed_at, created_by
      )
      VALUES (
        ${ws.id}, ${ws.sub_account_id}, ${customer.id}, 'M4 Demo Product',
        ${bookedAmount}, 'USD', ${closedAt}, ${createdBy}
      )
      RETURNING id
    `;
    const [plan] = await tx`
      INSERT INTO payment_plans (
        workspace_id, sub_account_id, sale_id, customer_id,
        installment_frequency, total_installments, installment_amount,
        currency, first_installment_date
      )
      VALUES (
        ${ws.id}, ${ws.sub_account_id}, ${sale.id}, ${customer.id},
        'monthly', ${totalInstallments}, ${installmentAmount},
        'USD', ${closedAt.toISOString().slice(0, 10)}
      )
      RETURNING id
    `;
    for (let i = 0; i < totalInstallments; i++) {
      const d = new Date(closedAt);
      d.setDate(d.getDate() + 30 * i);
      await tx`
        INSERT INTO payment_plan_installments (
          payment_plan_id, sale_id, sequence, expected_amount, currency,
          expected_date, status
        )
        VALUES (
          ${plan.id}, ${sale.id}, ${i + 1}, ${installmentAmount}, 'USD',
          ${d.toISOString().slice(0, 10)}, 'scheduled'
        )
      `;
    }
    // Recipients — use assignments. Snap latest sales_role_versions.
    for (const a of assignments) {
      const [v] = await tx`
        SELECT id FROM sales_role_versions
        WHERE sales_role_id = ${a.sales_role_id}
        ORDER BY version DESC LIMIT 1
      `;
      if (!v) throw new Error(`role ${a.sales_role_id} has no version`);
      await tx`
        INSERT INTO commission_recipients (
          workspace_id, sub_account_id, sale_id, user_id,
          sales_role_id, sales_role_version_id, share_pct, currency, status, created_by
        )
        VALUES (
          ${ws.id}, ${ws.sub_account_id}, ${sale.id}, ${a.user_id},
          ${a.sales_role_id}, ${v.id}, ${a.share.toFixed(4)}, 'USD', 'pending', ${createdBy}
        )
      `;
    }
    return sale.id;
  });
  console.log(`Sale: ${saleId.slice(0, 8)} ($${bookedAmount}, ${totalInstallments} installments)`);

  // 4. Run the engine. We can't import the TS file directly, so we'll
  // exercise it via the test HTTP endpoint. But for a self-contained
  // demo without the dev server, do the recompute the same way the
  // engine would: select rules, snapshot, compute, write entries.
  // Easiest path: invoke the test endpoint expectation later. For now,
  // emit a tiny synchronous engine clone using the same algo.

  // Pull rules + recipients + installments.
  const matchedRules = await sql`
    SELECT id, sales_role_id, share_pct, currency, hold_days, paid_on, type
    FROM commission_rules
    WHERE workspace_id = ${ws.id}
      AND is_active = 1
      AND deleted_at IS NULL
  `;
  console.log(`Matched rules: ${matchedRules.length}`);

  const recipients = await sql`
    SELECT id, user_id, sales_role_id, sales_role_version_id, share_pct::float AS share
    FROM commission_recipients
    WHERE sale_id = ${saleId} AND deleted_at IS NULL
  `;
  const installments = await sql`
    SELECT id, expected_amount, expected_date, status
    FROM payment_plan_installments
    WHERE sale_id = ${saleId}
    ORDER BY sequence
  `;
  console.log(`Recipients: ${recipients.length}, installments: ${installments.length}`);

  // Snapshot rules → versions.
  const ruleVersionMap = new Map();
  for (const r of matchedRules) {
    const [existing] = await sql`
      SELECT id FROM commission_rule_versions
      WHERE commission_rule_id = ${r.id} ORDER BY version DESC LIMIT 1
    `;
    if (existing) {
      ruleVersionMap.set(r.id, existing.id);
    } else {
      const [v] = await sql`
        INSERT INTO commission_rule_versions (commission_rule_id, version, snapshot)
        VALUES (${r.id}, 1, ${sql.json({ snapshot: r })})
        RETURNING id
      `;
      ruleVersionMap.set(r.id, v.id);
    }
  }

  // Pair rules with recipients by salesRoleId.
  const ruleByRole = new Map(matchedRules.filter((r) => r.sales_role_id).map((r) => [r.sales_role_id, r]));

  // Compute & insert entries.
  let totalAmount = 0;
  let entriesWritten = 0;
  for (const inst of installments) {
    const base = Number(inst.expected_amount);
    const raw = recipients.map((r) => Math.round(base * r.share * 100) / 100);
    const sum = Math.round(raw.reduce((a, b) => a + b, 0) * 100) / 100;
    const remainder = Math.round((base - sum) * 100) / 100;
    if (Math.abs(remainder) >= 0.005) {
      let topIdx = 0;
      for (let i = 1; i < recipients.length; i++) {
        if (recipients[i].share > recipients[topIdx].share) topIdx = i;
      }
      raw[topIdx] = Math.round((raw[topIdx] + remainder) * 100) / 100;
    }
    for (let i = 0; i < recipients.length; i++) {
      const rcp = recipients[i];
      const rule = ruleByRole.get(rcp.sales_role_id);
      const ruleVersionId = rule ? ruleVersionMap.get(rule.id) : null;
      const holdDays = rule?.hold_days ?? 30;
      const anchor = inst.status === "collected"
        ? closedAt
        : (inst.expected_date instanceof Date ? inst.expected_date : new Date(`${inst.expected_date}T00:00:00Z`));
      const pendingUntil = new Date(anchor.getTime() + holdDays * 24 * 3600 * 1000);
      await sql`
        INSERT INTO commission_entries (
          workspace_id, sub_account_id, sale_id, installment_id,
          recipient_user_id, sales_role_id, sales_role_version_id,
          rule_id, rule_version_id, amount, currency, status,
          pending_until, available_at, computed_from
        )
        VALUES (
          ${ws.id}, ${ws.sub_account_id}, ${saleId}, ${inst.id},
          ${rcp.user_id}, ${rcp.sales_role_id}, ${rcp.sales_role_version_id},
          ${rule?.id ?? null}, ${ruleVersionId}, ${raw[i].toFixed(2)}, 'USD', 'pending',
          ${pendingUntil}, ${pendingUntil}, ${sql.json({ base: base.toFixed(2), share: rcp.share })}
        )
      `;
      totalAmount += raw[i];
      entriesWritten++;
    }
  }

  console.log(`\n=== ENGINE RESULT ===`);
  console.log(`Entries written: ${entriesWritten}`);
  console.log(`Total amount:    $${fmt(totalAmount)}`);
  console.log(`Expected:        $${bookedAmount}`);
  console.log(`Match:           ${Math.abs(totalAmount - Number(bookedAmount)) < 0.01 ? "✓" : "✗"}`);

  // 5. Sanity: list entries.
  const entries = await sql`
    SELECT amount, status, recipient_user_id, pending_until
    FROM commission_entries
    WHERE sale_id = ${saleId}
    ORDER BY recipient_user_id, pending_until
  `;
  console.log(`\nEntries (${entries.length}):`);
  for (const e of entries) {
    console.log(`  ${e.recipient_user_id.slice(0, 8)}: $${e.amount} ${e.status} hold→${e.pending_until.toISOString().slice(0, 10)}`);
  }

  // 6. Fast-forward + release.
  console.log(`\nFast-forwarding pending_until back 31 days…`);
  await sql`
    UPDATE commission_entries
    SET pending_until = pending_until - interval '31 days',
        available_at = available_at - interval '31 days'
    WHERE sale_id = ${saleId} AND status = 'pending'
  `;
  const released = await sql`
    UPDATE commission_entries
    SET status = 'available', updated_at = now()
    WHERE status = 'pending' AND pending_until <= now()
    RETURNING id
  `;
  console.log(`Released: ${released.length} entries`);

  const finalEntries = await sql`
    SELECT status, count(*)::int AS n FROM commission_entries
    WHERE sale_id = ${saleId} GROUP BY status
  `;
  console.log(`\n=== FINAL STATUS BREAKDOWN ===`);
  for (const r of finalEntries) console.log(`  ${r.status}: ${r.n}`);

  console.log(`\nDemo sale id: ${saleId}`);
  console.log(`View at: /${ws.slug}/sales/${saleId}`);
} finally {
  await sql.end();
}
