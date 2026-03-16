import { inngest } from "@/inngest/client";
import { client } from "@/lib/graphql/client";
import { fetchAllPages } from "@/lib/graphql/paginate";
import { VAULT_BY_ADDRESS, VAULT_TRANSACTIONS } from "@/lib/graphql/queries";
import {
  OrderDirection,
  TransactionType,
  TransactionsOrderBy,
} from "@/lib/graphql/generated/graphql";
import { prisma } from "@/lib/prisma";

/** 2-month batch window (in seconds) to cap step output size. */
const BATCH_SIZE_SECONDS = 60 * 60 * 24 * 60; // ~60 days

/**
 * Default start timestamp when no sync cursor exists yet.
 * Morpho's first Vaults (0x38989BBA00BDF8181F4082995b3DEAe96163aC5D).
 */
const DEFAULT_START_TIMESTAMP = 1704292895;

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
    //   absolute-set upsert in Step 5 is always correct.
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

    // ── Step 2: Fetch transactions in (lastTimestamp, endTimestamp] ──────
    const items = await step.run("fetch-transactions", async () => {
      return fetchAllPages(
        client,
        VAULT_TRANSACTIONS,
        {
          where: {
            chainId_in: [1],
            type_in: [
              TransactionType.MetaMorphoDeposit,
              TransactionType.MetaMorphoWithdraw,
            ],
            timestamp_gte: lastTimestamp + 1,
            timestamp_lte: endTimestamp,
          },
          orderBy: TransactionsOrderBy.Timestamp,
          orderDirection: OrderDirection.Asc,
        },
        (r) => r.transactions,
      );
    });

    // Short-circuit: nothing to process
    if (items.length === 0) {
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

    // ── Step 3: Aggregate transactions by (vaultAddress, UTC day) ───────
    const { dailyBuckets, vaultAddresses } = await step.run(
      "aggregate-by-day",
      async () => {
        const vaultAddressSet = new Set<string>();
        const dailyMap = new Map<
          string,
          { vaultAddress: string; date: string; netFlow: number }
        >();

        for (const tx of items) {
          if (!("vault" in tx.data)) continue;

          const vaultAddress = tx.data.vault.address;
          vaultAddressSet.add(vaultAddress);

          const assetsUsd = tx.data.assetsUsd ?? 0;
          const netFlow =
            tx.type === TransactionType.MetaMorphoDeposit
              ? assetsUsd
              : -assetsUsd;

          const txDate = new Date(tx.timestamp * 1000);
          const utcDay = new Date(
            Date.UTC(
              txDate.getUTCFullYear(),
              txDate.getUTCMonth(),
              txDate.getUTCDate(),
            ),
          );
          const key = `${vaultAddress}|${utcDay.toISOString()}`;

          const existing = dailyMap.get(key);
          if (existing) {
            existing.netFlow += netFlow;
          } else {
            // Serialize date as ISO string for JSON-safe step output
            dailyMap.set(key, {
              vaultAddress,
              date: utcDay.toISOString(),
              netFlow,
            });
          }
        }

        return {
          dailyBuckets: Array.from(dailyMap.values()),
          vaultAddresses: Array.from(vaultAddressSet),
        };
      },
    );

    // ── Step 4: Ensure every vault exists in DB (idempotent upsert) ─────
    const vaultIdByAddress = await step.run(
      "ensure-vaults-exist",
      async () => {
        const mapping: Record<string, string> = {};

        for (const address of vaultAddresses) {
          const gqlResult = await client.request(VAULT_BY_ADDRESS, {
            address,
            chainId: 1,
          });
          const vaultData = gqlResult.vaultByAddress;

          const vault = await prisma.vault.upsert({
            where: { address },
            create: {
              address,
              chainId: vaultData.chain.id,
              name: vaultData.name,
              logo: vaultData.metadata?.image ?? "",
            },
            update: {
              chainId: vaultData.chain.id,
              name: vaultData.name,
              logo: vaultData.metadata?.image ?? "",
            },
          });

          mapping[address] = vault.id;
        }

        return mapping;
      },
    );

    // ── Step 5: Upsert aggregated daily net flows ───────────────────────
    const { upsertCount } = await step.run(
      "upsert-daily-net-flows",
      async () => {
        let count = 0;

        for (const { vaultAddress, date, netFlow } of dailyBuckets) {
          const vaultId = vaultIdByAddress[vaultAddress];
          if (!vaultId) continue;

          const parsedDate = new Date(date);

          await prisma.dailyNetFlow.upsert({
            where: { vaultId_date: { vaultId, date: parsedDate } },
            create: { vaultId, date: parsedDate, netFlow },
            update: { netFlow },
          });
          count++;
        }

        return { upsertCount: count };
      },
    );

    // ── Step 6: Update sync cursor ──────────────────────────────────────
    await step.run("update-sync-cursor", async () => {
      await prisma.syncCursor.upsert({
        where: { id: "vault-transactions" },
        create: { id: "vault-transactions", timestamp: endTimestamp },
        update: { timestamp: endTimestamp },
      });
    });

    logger.info(
      `Synced ${items.length} txs → ${upsertCount} daily buckets`,
    );

    return { txCount: items.length, upsertCount };
  },
);
