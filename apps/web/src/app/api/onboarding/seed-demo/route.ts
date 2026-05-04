// Onboarding seed-demo: populates a "demo" sub-account on the calling
// user's workspace with realistic 30-day fixture data (mirrors
// scripts/seed-demo.mjs but invokable from the UI).
//
// Idempotent: re-calling wipes prior demo state before re-seeding so
// the user can iterate. Demo state is scoped to its own sub-account so
// it never collides with the user's real data.
//
// This is what the onboarding wizard's "Try it with sample data" CTA
// hits — turns an empty workspace into populated dashboards in one
// click, the difference between "this is impressive in concept" and
// "this is impressive RIGHT NOW" for design-partner demos.

import { headers } from "next/headers";
import { sql } from "drizzle-orm";
import { getAuth } from "@revops/auth/server";
import { bypassRls, schema } from "@revops/db/client";

const FIRST_NAMES = [
  "Alex","Sam","Jordan","Taylor","Morgan","Casey","Riley","Quinn","Avery","Drew",
  "Skyler","Reese","Charlie","Hayden","Rowan","Sage","Emerson","Phoenix","Indigo","Wren",
];
const LAST_NAMES = [
  "Patel","Nguyen","Garcia","Smith","Johnson","Williams","Brown","Jones","Davis","Martinez",
  "Wilson","Anderson","Thomas","Hernandez","Lee","Walker","Hall","Allen","Young","King",
];
const PRODUCTS = [
  "Coaching Program","Mastermind","1:1 Consulting","Group Cohort","Done-For-You Service",
];
const DISP_WON = ["won"];
const DISP_OBJ = ["price_objection", "timing", "decision_maker_absent"];
const DISP_LOST = ["competitor", "not_qualified", "not_interested"];
const DISP_NS = ["no_show", "rescheduled"];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}
function irand(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export async function POST() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const result = await bypassRls(async (db) => {
    // Resolve user's workspace.
    const [member] = await db
      .select({ workspaceId: schema.memberships.workspaceId })
      .from(schema.memberships)
      .where(sql`user_id = ${session.user.id} AND deleted_at IS NULL`)
      .limit(1);
    if (!member) throw new Error("No workspace membership");
    const workspaceId = member.workspaceId;

    // Wipe any prior demo state.
    await db.execute(
      sql`DELETE FROM sub_accounts WHERE workspace_id = ${workspaceId} AND slug = 'demo'`,
    );
    await db.execute(sql`DELETE FROM "user" WHERE email LIKE 'demo-%@demo.test'`);

    // Pull required scaffolding (sales roles + dispositions) from the
    // workspace bootstrap.
    const roles = await db.execute<{ id: string; slug: string }>(sql`
      SELECT id, slug FROM sales_roles WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
    `);
    const roleArr = roles as unknown as Array<{ id: string; slug: string }>;
    const setterRoleId = roleArr.find((r) => r.slug === "setter")?.id ?? null;
    const closerRoleId = roleArr.find((r) => r.slug === "closer")?.id ?? null;
    const cxRoleId = roleArr.find((r) => r.slug === "cx")?.id ?? null;
    if (!setterRoleId || !closerRoleId) {
      throw new Error(
        "Sample data requires setter + closer roles. Switch to a Setter+Closer or Setter+Closer+CX preset first.",
      );
    }

    const dispRows = await db.execute<{ id: string; slug: string }>(sql`
      SELECT id, slug FROM dispositions WHERE workspace_id = ${workspaceId} AND is_active = 1
    `);
    const dispArr = dispRows as unknown as Array<{ id: string; slug: string }>;
    const dispBySlug = Object.fromEntries(dispArr.map((d) => [d.slug, d.id]));

    // Demo sub-account.
    const subAccountRows = await db.execute<{ id: string }>(sql`
      INSERT INTO sub_accounts (workspace_id, name, slug, timezone)
      VALUES (${workspaceId}, 'Demo', 'demo', 'UTC')
      RETURNING id
    `);
    const subAccountId = (subAccountRows as unknown as Array<{ id: string }>)[0]!.id;

    // Demo users.
    const stamp = Date.now();
    const demoUsers = [
      { id: `demo-setter-${stamp}`, name: "Demo Setter", email: `demo-setter-${stamp}@demo.test`, role: "setter" },
      { id: `demo-closer-${stamp}`, name: "Demo Closer", email: `demo-closer-${stamp}@demo.test`, role: "closer" },
      { id: `demo-cx-${stamp}`, name: "Demo CX", email: `demo-cx-${stamp}@demo.test`, role: "cx" },
    ];
    for (const u of demoUsers) {
      await db.execute(sql`
        INSERT INTO "user" (id, name, email, email_verified)
        VALUES (${u.id}, ${u.name}, ${u.email}, true)
      `);
      await db.execute(sql`
        INSERT INTO memberships (user_id, workspace_id, sub_account_id, access_role, accepted_at)
        VALUES (${u.id}, ${workspaceId}, ${subAccountId}, 'contributor', now())
      `);
      const roleId =
        u.role === "setter" ? setterRoleId : u.role === "closer" ? closerRoleId : cxRoleId;
      if (roleId) {
        await db.execute(sql`
          INSERT INTO sales_role_assignments (user_id, sales_role_id, sub_account_id, workspace_id)
          VALUES (${u.id}, ${roleId}, ${subAccountId}, ${workspaceId})
        `);
      }
    }
    const setterUser = demoUsers[0]!;
    const closerUser = demoUsers[1]!;

    // Quotas (current month).
    const periodStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
      .toISOString().slice(0, 10);
    const periodEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0))
      .toISOString().slice(0, 10);
    await db.execute(sql`
      INSERT INTO goals (workspace_id, sub_account_id, user_id, kind, metric, target_value, currency, period_kind, period_start, period_end)
      VALUES
        (${workspaceId}, ${subAccountId}, ${closerUser.id}, 'quota', 'booked_amount', '60000', 'USD', 'monthly', ${periodStart}, ${periodEnd}),
        (${workspaceId}, ${subAccountId}, ${setterUser.id}, 'quota', 'booked_amount', '15000', 'USD', 'monthly', ${periodStart}, ${periodEnd})
    `);

    // Customers.
    const customerIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const fn = pick(FIRST_NAMES);
      const ln = pick(LAST_NAMES);
      const rows = await db.execute<{ id: string }>(sql`
        INSERT INTO customers (workspace_id, sub_account_id, primary_email, name, phone, lifetime_value)
        VALUES (
          ${workspaceId}, ${subAccountId},
          ${`${fn.toLowerCase()}.${ln.toLowerCase()}${i}@demo.test`},
          ${`${fn} ${ln}`},
          ${`+1${irand(2000000000, 9999999999)}`},
          '0'
        )
        RETURNING id
      `);
      customerIds.push((rows as unknown as Array<{ id: string }>)[0]!.id);
    }

    // Calls + sales seeded over last 30 days. Same logic as scripts/seed-demo.mjs
    // but inlined so this route stays self-contained.
    const dayMs = 24 * 3600 * 1000;
    const now = Date.now();
    let wonCount = 0;
    type CallSeed = { id: string; customerId: string; dispSlug: string | null; closedAt: Date | null };
    const calls: CallSeed[] = [];
    for (let d = 30; d >= 0; d--) {
      const dayStart = now - d * dayMs;
      const callsToday = irand(2, 6);
      for (let i = 0; i < callsToday; i++) {
        const apptAt = new Date(
          dayStart + irand(9, 18) * 3600 * 1000 + irand(0, 59) * 60 * 1000,
        );
        const customer = pick(customerIds);
        const cRows = await db.execute<{ name: string | null; primary_email: string; phone: string | null }>(sql`
          SELECT name, primary_email, phone FROM customers WHERE id = ${customer}
        `);
        const c = (cRows as unknown as Array<{
          name: string | null;
          primary_email: string;
          phone: string | null;
        }>)[0]!;
        const r = Math.random();
        let dispSlug: string | null = null;
        let showed = false;
        let completed = false;
        if (d > 0) {
          if (r < 0.25) { dispSlug = pick(DISP_WON); showed = true; completed = true; wonCount++; }
          else if (r < 0.55) { dispSlug = pick(DISP_OBJ); showed = true; completed = true; }
          else if (r < 0.75) { dispSlug = pick(DISP_LOST); showed = true; completed = true; }
          else if (r < 0.9) { dispSlug = pick(DISP_NS); showed = false; completed = true; }
        }
        const dispId = dispSlug ? dispBySlug[dispSlug] ?? null : null;
        const showedAt = showed ? new Date(apptAt.getTime() + irand(0, 3) * 60 * 1000) : null;
        const completedAt = completed ? new Date(apptAt.getTime() + irand(20, 50) * 60 * 1000) : null;
        const duration = completed ? irand(900, 3600) : null;
        const callRows = await db.execute<{ id: string }>(sql`
          INSERT INTO calls (
            workspace_id, sub_account_id, customer_id,
            contact_name, contact_email, contact_phone,
            setter_user_id, closer_user_id,
            appointment_at, showed_at, completed_at, duration_seconds,
            disposition_id, source_integration
          )
          VALUES (
            ${workspaceId}, ${subAccountId}, ${customer},
            ${c.name}, ${c.primary_email}, ${c.phone},
            ${setterUser.id}, ${closerUser.id},
            ${apptAt}, ${showedAt}, ${completedAt}, ${duration},
            ${dispId}, 'demo'
          )
          RETURNING id
        `);
        const callId = (callRows as unknown as Array<{ id: string }>)[0]!.id;
        calls.push({ id: callId, customerId: customer, dispSlug, closedAt: completedAt });
      }
    }

    // Sales for won calls.
    let salesCount = 0;
    let entriesCount = 0;
    for (const c of calls.filter((x) => x.dispSlug && DISP_WON.includes(x.dispSlug))) {
      const productName = pick(PRODUCTS);
      const bookedAmount = irand(1500, 10000).toFixed(2);
      const closedAt = c.closedAt ?? new Date();
      const saleRows = await db.execute<{ id: string }>(sql`
        INSERT INTO sales (
          workspace_id, sub_account_id, customer_id, linked_call_id,
          product_name, booked_amount, collected_amount, currency, closed_at,
          source_integration
        )
        VALUES (
          ${workspaceId}, ${subAccountId}, ${c.customerId}, ${c.id},
          ${productName}, ${bookedAmount}, ${bookedAmount}, 'USD', ${closedAt},
          'demo'
        )
        RETURNING id
      `);
      const saleId = (saleRows as unknown as Array<{ id: string }>)[0]!.id;
      await db.execute(sql`UPDATE calls SET linked_sale_id = ${saleId} WHERE id = ${c.id}`);

      const planRows = await db.execute<{ id: string }>(sql`
        INSERT INTO payment_plans (
          workspace_id, sub_account_id, sale_id, customer_id,
          installment_frequency, total_installments, installment_amount, currency,
          first_installment_date
        )
        VALUES (
          ${workspaceId}, ${subAccountId}, ${saleId}, ${c.customerId},
          'monthly', 1, ${bookedAmount}, 'USD',
          ${closedAt.toISOString().slice(0, 10)}
        )
        RETURNING id
      `);
      const planId = (planRows as unknown as Array<{ id: string }>)[0]!.id;
      const instRows = await db.execute<{ id: string }>(sql`
        INSERT INTO payment_plan_installments (
          payment_plan_id, sale_id, sequence, expected_amount, actual_amount,
          currency, expected_date, collected_at, status
        )
        VALUES (
          ${planId}, ${saleId}, 1, ${bookedAmount}, ${bookedAmount},
          'USD', ${closedAt.toISOString().slice(0, 10)}, ${closedAt}, 'collected'
        )
        RETURNING id
      `);
      const installmentId = (instRows as unknown as Array<{ id: string }>)[0]!.id;

      const setterVerRows = await db.execute<{ id: string }>(sql`
        SELECT id FROM sales_role_versions WHERE sales_role_id = ${setterRoleId} ORDER BY version DESC LIMIT 1
      `);
      const closerVerRows = await db.execute<{ id: string }>(sql`
        SELECT id FROM sales_role_versions WHERE sales_role_id = ${closerRoleId} ORDER BY version DESC LIMIT 1
      `);
      const setterVerId = (setterVerRows as unknown as Array<{ id: string }>)[0]?.id;
      const closerVerId = (closerVerRows as unknown as Array<{ id: string }>)[0]?.id;
      if (!setterVerId || !closerVerId) throw new Error("missing role versions");

      await db.execute(sql`
        INSERT INTO commission_recipients (
          workspace_id, sub_account_id, sale_id, user_id,
          sales_role_id, sales_role_version_id, share_pct, currency, status
        )
        VALUES
          (${workspaceId}, ${subAccountId}, ${saleId}, ${setterUser.id}, ${setterRoleId}, ${setterVerId}, '0.2000', 'USD', 'pending'),
          (${workspaceId}, ${subAccountId}, ${saleId}, ${closerUser.id}, ${closerRoleId}, ${closerVerId}, '0.8000', 'USD', 'pending')
      `);

      const setterAmount = (Number(bookedAmount) * 0.2).toFixed(2);
      const closerAmount = (Number(bookedAmount) * 0.8).toFixed(2);
      const pendingUntil = new Date(closedAt.getTime() + 30 * dayMs);
      const status = pendingUntil <= new Date() ? "available" : "pending";
      await db.execute(sql`
        INSERT INTO commission_entries (
          workspace_id, sub_account_id, sale_id, installment_id,
          recipient_user_id, sales_role_id, sales_role_version_id,
          amount, currency, status, pending_until, available_at, computed_from
        )
        VALUES
          (${workspaceId}, ${subAccountId}, ${saleId}, ${installmentId},
           ${setterUser.id}, ${setterRoleId}, ${setterVerId},
           ${setterAmount}, 'USD', ${status}, ${pendingUntil}, ${pendingUntil},
           ${JSON.stringify({ base: bookedAmount, share: 0.2 })}::jsonb),
          (${workspaceId}, ${subAccountId}, ${saleId}, ${installmentId},
           ${closerUser.id}, ${closerRoleId}, ${closerVerId},
           ${closerAmount}, 'USD', ${status}, ${pendingUntil}, ${pendingUntil},
           ${JSON.stringify({ base: bookedAmount, share: 0.8 })}::jsonb)
      `);
      await db.execute(sql`
        UPDATE customers SET lifetime_value = lifetime_value + ${bookedAmount}::numeric WHERE id = ${c.customerId}
      `);
      salesCount++;
      entriesCount += 2;
    }

    return {
      sub_account: subAccountId,
      customers: customerIds.length,
      calls: calls.length,
      won: wonCount,
      sales: salesCount,
      entries: entriesCount,
    };
  });

  return Response.json({ ok: true, ...result });
}
