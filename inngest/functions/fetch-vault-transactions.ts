import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_START_TIMESTAMP,
  ensureVaultsExist,
  fetchAndAggregateDailyBuckets,
  upsertDailyNetFlows,
} from "@/lib/sync";

/** Batch window (in seconds). */
const BATCH_SIZE_SECONDS = 60 * 60 * 24 * 60; // ~60 days

export const fetchVaultTransactions = inngest.createFunction(
  {
    id: "fetch-vault-transactions",
    concurrency: {
      limit: 1,
      key: "fetch-vault-transactions",
      scope: "fn",
    }
  },
  { cron: "*/10 * * * *" },
  async ({ step, logger }) => {
    // ── Step 1: Read the sync cursor ────────────────────────────────────
    const lastTimestamp = await step.run(
      "get-last-synced-timestamp",
      async () => {
        const cursor = await prisma.syncCursor.findUnique({
          where: { id: "vault-transactions" },
        });
        return cursor?.timestamp ?? DEFAULT_START_TIMESTAMP;
      },
    );

    // Cap the query window so we only ever process complete UTC days.
    // – Prevents the cursor from jumping into the future when no txs exist.
    // – Ensures every day in the window is fully captured, so the idempotent
    //   absolute-set upsert in Step 4 is always correct.
    const startOfTodayUtc = Math.floor(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
      ) / 1000,
    );
    const endTimestamp = Math.min(
      lastTimestamp + BATCH_SIZE_SECONDS,
      startOfTodayUtc - 1,
    );

    // ── Step 2: Fetch transactions and aggregate by (vaultAddress, UTC day)
    // Merged into a single step so the large raw transaction list is never
    // serialised as step output, avoiding the Inngest payload size limit.
    const { txCount, dailyBuckets, vaultAddresses } = await step.run(
      "fetch-and-aggregate",
      () => fetchAndAggregateDailyBuckets(lastTimestamp + 1, endTimestamp),
    );

    // Short-circuit: nothing to process
    if (txCount === 0) {
      await step.run("advance-sync-cursor", async () => {
        await prisma.syncCursor.upsert({
          where: { id: "vault-transactions" },
          create: { id: "vault-transactions", timestamp: endTimestamp },
          update: { timestamp: endTimestamp },
        });
      });
      logger.info("No new transactions found — cursor advanced.");
      return { txCount: 0, upsertCount: 0 };
    }

    // ── Step 3: Ensure every vault exists in DB (idempotent upsert) ─────
    const vaultIdByAddress = await step.run(
      "ensure-vaults-exist",
      () => ensureVaultsExist(vaultAddresses),
    );

    // ── Step 4: Upsert aggregated daily net flows ───────────────────────
    const { upsertCount } = await step.run(
      "upsert-daily-net-flows",
      () => upsertDailyNetFlows(dailyBuckets, vaultIdByAddress),
    );

    // ── Step 5: Update sync cursor ──────────────────────────────────────
    await step.run("update-sync-cursor", async () => {
      await prisma.syncCursor.upsert({
        where: { id: "vault-transactions" },
        create: { id: "vault-transactions", timestamp: endTimestamp },
        update: { timestamp: endTimestamp },
      });
    });

    // ── Step 6: Invalidate leaderboard cache (only if we wrote new data) ─
    if (upsertCount > 0) {
      await step.run("invalidate-cache", async () => {
        const { revalidateTag } = await import("next/cache");
        revalidateTag("leaderboard");
      });
    }

    logger.info(
      `Synced ${txCount} txs → ${upsertCount} daily buckets`,
    );

    return { txCount, upsertCount };
  },
);
