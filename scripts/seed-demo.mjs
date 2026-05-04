// Seed-demo script — populates a realistic 30-day workspace so every
// dashboard goes from empty state to "wow" for design-partner demos.
//
// Usage:
//   node scripts/seed-demo.mjs [workspaceSlug]
//
// Without a slug it picks the most recent workspace. The script is
// idempotent on a per-run basis (re-run to clear + re-seed), but does
// NOT preserve the existing workspace's manually-created data — it
// scopes all inserts to a "Demo" sub-account it creates fresh and
// inserts demo users with @demo.test emails so it never clashes with
// real signups.
//
// What gets seeded:
//   - 3 demo users (1 setter, 1 closer, 1 cx) with memberships +
//     sales-role assignments
//   - Monthly quotas for closer + setter
//   - 50 customers
//   - ~120 calls over the last 30 days (varied dispositions + showed
//     timestamps)
//   - ~40 sales linked to the closer with multi-party recipients
//   - Commission entries via direct insert (mirrors what the engine
//     would produce)
//   - 2-3 refunded sales with proper clawback entries
//   - 10 agent facts on top customers

import postgres from "postgres";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_MIGRATION_URL required");
  process.exit(1);
}
const sql = postgres(url, { prepare: false });

const FIRST_NAMES = [
  "Alex","Sam","Jordan","Taylor","Morgan","Casey","Riley","Quinn","Avery","Drew",
  "Skyler","Reese","Charlie","Hayden","Rowan","Sage","Emerson","Phoenix","Indigo","Wren",
];
const LAST_NAMES = [
  "Patel","Nguyen","Garcia","Smith","Johnson","Williams","Brown","Jones","Davis","Martinez",
  "Wilson","Anderson","Thomas","Hernandez","Lee","Walker","Hall","Allen","Young","King",
];
const PRODUCTS = [
  "Coaching Program",
  "Mastermind",
  "1:1 Consulting",
  "Group Cohort",
  "Done-For-You Service",
];
const DISPOSITIONS_WON = ["won"];
const DISPOSITIONS_OBJECTION = ["price_objection", "timing", "decision_maker_absent"];
const DISPOSITIONS_LOST = ["competitor", "not_qualified", "not_interested"];
const DISPOSITIONS_NOSHOW = ["no_show", "rescheduled"];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function nrand(min, max) {
  return min + Math.random() * (max - min);
}
function irand(min, max) {
  return Math.floor(nrand(min, max + 1));
}

const slugArg = process.argv[2];

try {
  // 1. Pick workspace.
  const wsRow = slugArg
    ? await sql`SELECT id, name, slug FROM workspaces WHERE slug = ${slugArg} AND deleted_at IS NULL LIMIT 1`
    : await sql`SELECT id, name, slug FROM workspaces WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`;
  const ws = wsRow[0];
  if (!ws) throw new Error(`Workspace not found${slugArg ? ` (slug=${slugArg})` : ""}`);
  console.log(`Seeding ${ws.name} (${ws.id.slice(0, 8)})`);

  // 2. Wipe prior demo state for this workspace (idempotent).
  await sql`DELETE FROM sub_accounts WHERE workspace_id = ${ws.id} AND slug = 'demo'`;
  await sql`DELETE FROM "user" WHERE email LIKE 'demo-%@demo.test'`;

  // 3. Ensure sales roles exist (workspace bootstrap may have created them).
  let roles = await sql`
    SELECT id, slug FROM sales_roles WHERE workspace_id = ${ws.id} AND deleted_at IS NULL
  `;
  if (roles.length === 0) {
    console.log("No sales_roles found — workspace bootstrap should have seeded them. Aborting.");
    process.exit(1);
  }
  const roleBySlug = Object.fromEntries(roles.map((r) => [r.slug, r.id]));
  const setterRoleId = roleBySlug.setter ?? roleBySlug.SETTER ?? null;
  const closerRoleId = roleBySlug.closer ?? roleBySlug.CLOSER ?? null;
  const cxRoleId = roleBySlug.cx ?? roleBySlug.CX ?? null;
  if (!setterRoleId || !closerRoleId) {
    console.log("Workspace must have setter + closer sales roles. Aborting.");
    process.exit(1);
  }

  // 4. Demo sub-account.
  const [subAccount] = await sql`
    INSERT INTO sub_accounts (workspace_id, name, slug, timezone)
    VALUES (${ws.id}, 'Demo', 'demo', 'UTC')
    RETURNING id
  `;
  console.log(`  sub_account: demo (${subAccount.id.slice(0, 8)})`);

  // 5. Demo users.
  const demoUsers = [
    { id: `demo-setter-${Date.now()}`, name: "Demo Setter", email: `demo-setter-${Date.now()}@demo.test`, role: "setter" },
    { id: `demo-closer-${Date.now()}`, name: "Demo Closer", email: `demo-closer-${Date.now()}@demo.test`, role: "closer" },
    { id: `demo-cx-${Date.now()}`, name: "Demo CX", email: `demo-cx-${Date.now()}@demo.test`, role: "cx" },
  ];
  for (const u of demoUsers) {
    await sql`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES (${u.id}, ${u.name}, ${u.email}, true)
    `;
    await sql`
      INSERT INTO memberships (user_id, workspace_id, sub_account_id, access_role, accepted_at)
      VALUES (${u.id}, ${ws.id}, ${subAccount.id}, 'contributor', now())
    `;
    const roleId =
      u.role === "setter" ? setterRoleId : u.role === "closer" ? closerRoleId : cxRoleId;
    if (roleId) {
      await sql`
        INSERT INTO sales_role_assignments (user_id, sales_role_id, sub_account_id, workspace_id)
        VALUES (${u.id}, ${roleId}, ${subAccount.id}, ${ws.id})
      `;
    }
  }
  console.log(`  users: ${demoUsers.map((u) => u.name).join(", ")}`);
  const setterUser = demoUsers[0];
  const closerUser = demoUsers[1];
  const cxUser = demoUsers[2];

  // 6. Monthly quota for closer + setter (current month).
  const periodStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
    .toISOString().slice(0, 10);
  const periodEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0))
    .toISOString().slice(0, 10);
  await sql`
    INSERT INTO goals (workspace_id, sub_account_id, user_id, kind, metric, target_value, currency, period_kind, period_start, period_end)
    VALUES
      (${ws.id}, ${subAccount.id}, ${closerUser.id}, 'quota', 'booked_amount', '60000', 'USD', 'monthly', ${periodStart}, ${periodEnd}),
      (${ws.id}, ${subAccount.id}, ${setterUser.id}, 'quota', 'booked_amount', '15000', 'USD', 'monthly', ${periodStart}, ${periodEnd})
  `;
  console.log(`  quotas: closer $60k, setter $15k`);

  // 7. Customers.
  const customerIds = [];
  for (let i = 0; i < 50; i++) {
    const fn = pick(FIRST_NAMES);
    const ln = pick(LAST_NAMES);
    const email = `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@demo.test`;
    const [row] = await sql`
      INSERT INTO customers (workspace_id, sub_account_id, primary_email, name, phone, lifetime_value)
      VALUES (${ws.id}, ${subAccount.id}, ${email}, ${`${fn} ${ln}`}, ${`+1${irand(2000000000, 9999999999)}`}, '0')
      RETURNING id
    `;
    customerIds.push(row.id);
  }
  console.log(`  customers: ${customerIds.length}`);

  // 8. Calls + dispositions over last 30 days.
  const dispRows = await sql`
    SELECT id, slug, category FROM dispositions WHERE workspace_id = ${ws.id} AND is_active = 1
  `;
  const dispBySlug = Object.fromEntries(dispRows.map((d) => [d.slug, d]));
  const callIds = [];
  const dayMs = 24 * 3600 * 1000;
  const now = Date.now();
  let won = 0;
  for (let d = 30; d >= 0; d--) {
    const dayStart = now - d * dayMs;
    const callsToday = irand(2, 6);
    for (let i = 0; i < callsToday; i++) {
      const apptAt = new Date(dayStart + irand(9, 18) * 3600 * 1000 + irand(0, 59) * 60 * 1000);
      const customer = pick(customerIds);
      const [crow] = await sql`
        SELECT name, primary_email, phone FROM customers WHERE id = ${customer}
      `;
      // Outcome distribution: 25% won, 30% objection, 20% lost, 15% no-show, 10% pending
      const r = Math.random();
      let dispSlug = null;
      let showed = false;
      let completed = false;
      if (d > 0) {
        if (r < 0.25) { dispSlug = pick(DISPOSITIONS_WON); showed = true; completed = true; won++; }
        else if (r < 0.55) { dispSlug = pick(DISPOSITIONS_OBJECTION); showed = true; completed = true; }
        else if (r < 0.75) { dispSlug = pick(DISPOSITIONS_LOST); showed = true; completed = true; }
        else if (r < 0.9) { dispSlug = pick(DISPOSITIONS_NOSHOW); showed = false; completed = true; }
      }
      const dispId = dispSlug ? dispBySlug[dispSlug]?.id : null;
      const showedAt = showed ? new Date(apptAt.getTime() + irand(0, 3) * 60 * 1000) : null;
      const completedAt = completed ? new Date(apptAt.getTime() + irand(20, 50) * 60 * 1000) : null;
      const duration = completed ? irand(900, 3600) : null;
      const [callRow] = await sql`
        INSERT INTO calls (
          workspace_id, sub_account_id, customer_id,
          contact_name, contact_email, contact_phone,
          setter_user_id, closer_user_id,
          appointment_at, showed_at, completed_at, duration_seconds,
          disposition_id, source_integration
        )
        VALUES (
          ${ws.id}, ${subAccount.id}, ${customer},
          ${crow.name}, ${crow.primary_email}, ${crow.phone},
          ${setterUser.id}, ${closerUser.id},
          ${apptAt.toISOString()}, ${showedAt ? showedAt.toISOString() : null},
          ${completedAt ? completedAt.toISOString() : null}, ${duration},
          ${dispId}, 'demo'
        )
        RETURNING id, customer_id
      `;
      callIds.push({ id: callRow.id, customerId: callRow.customer_id, dispSlug, closedAt: completedAt });
    }
  }
  console.log(`  calls: ${callIds.length} (${won} won)`);

  // 9. Sales for won calls.
  const salesIds = [];
  const wonCalls = callIds.filter((c) => c.dispSlug && DISPOSITIONS_WON.includes(c.dispSlug));
  for (const c of wonCalls) {
    const [crow] = await sql`SELECT name, primary_email FROM customers WHERE id = ${c.customerId}`;
    const productName = pick(PRODUCTS);
    const bookedAmount = (irand(1500, 10000) / 1).toFixed(2);
    const closedAt = c.closedAt ?? new Date();
    const [saleRow] = await sql`
      INSERT INTO sales (
        workspace_id, sub_account_id, customer_id, linked_call_id,
        product_name, booked_amount, collected_amount, currency, closed_at,
        source_integration
      )
      VALUES (
        ${ws.id}, ${subAccount.id}, ${c.customerId}, ${c.id},
        ${productName}, ${bookedAmount}, ${bookedAmount}, 'USD', ${closedAt.toISOString()},
        'demo'
      )
      RETURNING id
    `;
    await sql`UPDATE calls SET linked_sale_id = ${saleRow.id} WHERE id = ${c.id}`;
    salesIds.push({ id: saleRow.id, bookedAmount: Number(bookedAmount), closedAt });

    // Synthetic single-installment plan (matches sales-domain createSale).
    const [plan] = await sql`
      INSERT INTO payment_plans (
        workspace_id, sub_account_id, sale_id, customer_id,
        installment_frequency, total_installments, installment_amount, currency,
        first_installment_date
      )
      VALUES (
        ${ws.id}, ${subAccount.id}, ${saleRow.id}, ${c.customerId},
        'monthly', 1, ${bookedAmount}, 'USD',
        ${closedAt.toISOString().slice(0, 10)}
      )
      RETURNING id
    `;
    const [installment] = await sql`
      INSERT INTO payment_plan_installments (
        payment_plan_id, sale_id, sequence, expected_amount, actual_amount,
        currency, expected_date, collected_at, status
      )
      VALUES (
        ${plan.id}, ${saleRow.id}, 1, ${bookedAmount}, ${bookedAmount},
        'USD', ${closedAt.toISOString().slice(0, 10)}, ${closedAt.toISOString()}, 'collected'
      )
      RETURNING id
    `;

    // Recipients: setter 20%, closer 80%.
    const [setterVer] = await sql`
      SELECT id FROM sales_role_versions WHERE sales_role_id = ${setterRoleId} ORDER BY version DESC LIMIT 1
    `;
    const [closerVer] = await sql`
      SELECT id FROM sales_role_versions WHERE sales_role_id = ${closerRoleId} ORDER BY version DESC LIMIT 1
    `;
    if (!setterVer || !closerVer) throw new Error("missing role versions");

    await sql`
      INSERT INTO commission_recipients (
        workspace_id, sub_account_id, sale_id, user_id,
        sales_role_id, sales_role_version_id, share_pct, currency, status
      )
      VALUES
        (${ws.id}, ${subAccount.id}, ${saleRow.id}, ${setterUser.id}, ${setterRoleId}, ${setterVer.id}, '0.2000', 'USD', 'pending'),
        (${ws.id}, ${subAccount.id}, ${saleRow.id}, ${closerUser.id}, ${closerRoleId}, ${closerVer.id}, '0.8000', 'USD', 'pending')
    `;

    // Commission entries (engine-equivalent shape). Hold = 30 days, anchored to collectedAt.
    const setterAmount = (Number(bookedAmount) * 0.2).toFixed(2);
    const closerAmount = (Number(bookedAmount) * 0.8).toFixed(2);
    const pendingUntil = new Date(closedAt.getTime() + 30 * dayMs);
    // Available status if pendingUntil already passed.
    const status = pendingUntil <= new Date() ? "available" : "pending";
    await sql`
      INSERT INTO commission_entries (
        workspace_id, sub_account_id, sale_id, installment_id,
        recipient_user_id, sales_role_id, sales_role_version_id,
        amount, currency, status, pending_until, available_at, computed_from
      )
      VALUES
        (${ws.id}, ${subAccount.id}, ${saleRow.id}, ${installment.id},
         ${setterUser.id}, ${setterRoleId}, ${setterVer.id},
         ${setterAmount}, 'USD', ${status}, ${pendingUntil.toISOString()}, ${pendingUntil.toISOString()},
         ${sql.json({ base: bookedAmount, share: 0.2 })}),
        (${ws.id}, ${subAccount.id}, ${saleRow.id}, ${installment.id},
         ${closerUser.id}, ${closerRoleId}, ${closerVer.id},
         ${closerAmount}, 'USD', ${status}, ${pendingUntil.toISOString()}, ${pendingUntil.toISOString()},
         ${sql.json({ base: bookedAmount, share: 0.8 })})
    `;

    // Update customer LTV.
    await sql`
      UPDATE customers SET lifetime_value = lifetime_value + ${bookedAmount}::numeric WHERE id = ${c.customerId}
    `;
  }
  console.log(`  sales: ${salesIds.length}`);

  // 10. Refund a couple of sales.
  const refundCount = Math.min(2, Math.floor(salesIds.length * 0.05) + 1);
  for (let i = 0; i < refundCount; i++) {
    const target = salesIds[salesIds.length - 1 - i];
    if (!target) break;
    await sql`
      UPDATE sales
         SET refund_status = 'issued',
             refunded_amount = ${target.bookedAmount.toFixed(2)},
             refunded_at = now()
       WHERE id = ${target.id}
    `;
    await sql`
      UPDATE commission_entries
         SET status = 'clawed_back', clawed_back_at = now()
       WHERE sale_id = ${target.id}
    `;
    await sql`
      UPDATE payment_plan_installments
         SET status = 'refunded'
       WHERE sale_id = ${target.id}
    `;
  }
  console.log(`  refunded: ${refundCount}`);

  // 11. Agent facts on top customers.
  const topCustomerIds = customerIds.slice(0, 10);
  const factTemplates = [
    "Mentioned considering a competitor on last call",
    "Wants to revisit pricing in Q3 budget cycle",
    "Decision-maker is the COO; we've only spoken to the manager",
    "Successful onboarding — high product engagement signals",
    "Renewal conversation scheduled for next month",
    "Confirmed buying timeline: 2 weeks",
    "Asked about white-label option",
    "Concerned about implementation timeline",
    "Strong fit, intro requested for sister company",
    "Reported a billing issue — keep an eye on retention",
  ];
  // agent_facts requires an embedding (vector(1536)). For seed we generate a
  // zero-vector — acceptable for fixtures since vector search isn't used in
  // dashboards directly; the customer-detail page filters by scope_ref_id.
  const zeroVec = `[${new Array(1536).fill(0).join(",")}]`;
  for (let i = 0; i < topCustomerIds.length; i++) {
    await sql`
      INSERT INTO agent_facts (
        workspace_id, scope, scope_ref_id, kind, content, confidence, embedding
      )
      VALUES (
        ${ws.id}, 'customer', ${topCustomerIds[i]}, 'fact',
        ${factTemplates[i % factTemplates.length]}, '0.70', ${zeroVec}::vector
      )
    `;
  }
  console.log(`  agent_facts: ${topCustomerIds.length}`);

  console.log(`\nDone. Visit /${ws.slug}/dashboard/closer to see the dashboards in action.`);
} finally {
  await sql.end();
}
