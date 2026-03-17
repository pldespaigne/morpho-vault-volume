import "dotenv/config";

import {
  DEFAULT_START_TIMESTAMP,
  MONTHLY_WINDOW_MS,
  aggregateMonthlyWindow,
  ensureVaultsExist,
  fetchAndAggregateDailyBuckets,
  upsertDailyNetFlows,
} from "../lib/sync";
import { prisma } from "../lib/prisma";

// ── Helpers ─────────────────────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function elapsed(startMs: number): string {
  const seconds = ((Date.now() - startMs) / 1000).toFixed(1);
  return `${seconds}s`;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();
  console.log("⚡ Fast-sync starting…\n");

  // ── 1. Read sync cursor ───────────────────────────────────────────────
  const cursor = await prisma.syncCursor.findUnique({
    where: { id: "vault-transactions" },
  });
  const lastTimestamp = cursor?.timestamp ?? DEFAULT_START_TIMESTAMP;

  const startOfTodayUtc = Math.floor(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    ) / 1000,
  );
  const endTimestamp = startOfTodayUtc - 1;

  if (lastTimestamp >= endTimestamp) {
    console.log("✅ Already up to date — nothing to sync.");
    return;
  }

  console.log(
    `📅 Syncing transactions from ${formatTimestamp(lastTimestamp)} to ${formatTimestamp(endTimestamp)}`,
  );

  // ── 2. Fetch all transactions & aggregate into daily buckets ──────────
  console.log("\n🔄 Fetching transactions from Morpho API…");
  const fetchStart = Date.now();

  const { txCount, dailyBuckets, vaultAddresses } =
    await fetchAndAggregateDailyBuckets(lastTimestamp + 1, endTimestamp);

  console.log(
    `✅ Fetched ${txCount.toLocaleString()} transactions → ${dailyBuckets.length.toLocaleString()} daily buckets across ${vaultAddresses.length.toLocaleString()} vaults (${elapsed(fetchStart)})`,
  );

  if (txCount === 0) {
    console.log("ℹ️  No new transactions found — advancing cursor.");
    await prisma.syncCursor.upsert({
      where: { id: "vault-transactions" },
      create: { id: "vault-transactions", timestamp: endTimestamp },
      update: { timestamp: endTimestamp },
    });
    return;
  }

  // ── 3. Upsert vault metadata ─────────────────────────────────────────
  console.log("\n🏦 Fetching & upserting vault metadata…");
  const vaultStart = Date.now();

  const vaultIdByAddress = await ensureVaultsExist(vaultAddresses);

  console.log(
    `✅ ${Object.keys(vaultIdByAddress).length.toLocaleString()} vaults upserted (${elapsed(vaultStart)})`,
  );

  // ── 4. Upsert DailyNetFlow rows ──────────────────────────────────────
  console.log("\n📈 Upserting daily net flows…");
  const dailyStart = Date.now();

  const { upsertCount: dailyUpsertCount } = await upsertDailyNetFlows(
    dailyBuckets,
    vaultIdByAddress,
  );

  console.log(
    `✅ ${dailyUpsertCount.toLocaleString()} daily net flow rows upserted (${elapsed(dailyStart)})`,
  );

  // ── 5. Aggregate DailyNetFlow → MonthlyNetFlow ───────────────────────
  console.log("\n📅 Aggregating monthly net flows…");
  const monthlyStart = Date.now();

  const monthlyCursor = await prisma.syncCursor.findUnique({
    where: { id: "monthly-net-flow" },
  });

  let windowStartMs: number;
  if (monthlyCursor) {
    windowStartMs = monthlyCursor.timestamp * 1000;
  } else {
    const earliest = await prisma.dailyNetFlow.findFirst({
      orderBy: { date: "asc" },
      select: { date: true },
    });
    if (!earliest) {
      console.log("ℹ️  No daily data found — skipping monthly aggregation.");
      windowStartMs = 0;
    } else {
      windowStartMs = earliest.date.getTime();
    }
  }

  const startOfTodayMs = startOfTodayUtc * 1000;
  let monthlyUpsertCount = 0;
  let windowCount = 0;
  let lastWindowEnd = windowStartMs;

  if (windowStartMs > 0) {
    while (windowStartMs + MONTHLY_WINDOW_MS <= startOfTodayMs) {
      const windowEnd = windowStartMs + MONTHLY_WINDOW_MS;
      windowCount++;

      console.log(
        `   Window ${windowCount}: ${new Date(windowStartMs).toISOString().slice(0, 10)} → ${new Date(windowEnd).toISOString().slice(0, 10)}`,
      );

      const { upsertCount } = await aggregateMonthlyWindow(
        new Date(windowStartMs),
        new Date(windowEnd),
      );

      monthlyUpsertCount += upsertCount;
      lastWindowEnd = windowEnd;
      windowStartMs = windowEnd;
    }
  }

  console.log(
    `✅ ${windowCount} window(s) → ${monthlyUpsertCount.toLocaleString()} monthly rows upserted (${elapsed(monthlyStart)})`,
  );

  // ── 6. Update sync cursors ────────────────────────────────────────────
  console.log("\n💾 Updating sync cursors…");

  await prisma.syncCursor.upsert({
    where: { id: "vault-transactions" },
    create: { id: "vault-transactions", timestamp: endTimestamp },
    update: { timestamp: endTimestamp },
  });

  if (windowCount > 0) {
    const monthlyEndTimestamp = Math.floor(lastWindowEnd / 1000);
    await prisma.syncCursor.upsert({
      where: { id: "monthly-net-flow" },
      create: { id: "monthly-net-flow", timestamp: monthlyEndTimestamp },
      update: { timestamp: monthlyEndTimestamp },
    });
  }

  // ── Done ──────────────────────────────────────────────────────────────
  console.log(`
🏁 Fast-sync complete (${elapsed(t0)})
   Transactions fetched : ${txCount.toLocaleString()}
   Daily rows upserted  : ${dailyUpsertCount.toLocaleString()}
   Monthly rows upserted: ${monthlyUpsertCount.toLocaleString()}
   Vaults synced         : ${Object.keys(vaultIdByAddress).length.toLocaleString()}
`);
}

main()
  .catch((err) => {
    console.error("❌ Fast-sync failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
