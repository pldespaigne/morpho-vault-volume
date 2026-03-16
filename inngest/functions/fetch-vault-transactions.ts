import { inngest } from "@/inngest/client";
import { client } from "@/lib/graphql/client";
import { fetchAllPages } from "@/lib/graphql/paginate";
import {
  VAULTS_BY_ADDRESSES,
  VAULT_TRANSACTIONS,
} from "@/lib/graphql/queries";
import {
  OrderDirection,
  TransactionType,
  TransactionsOrderBy,
} from "@/lib/graphql/generated/graphql";
import { prisma } from "@/lib/prisma";

/** Batch window (in seconds). */
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
      async () => {
        const items = await fetchAllPages(
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

        if (items.length === 0) {
          return { txCount: 0, dailyBuckets: [] as { vaultAddress: string; date: string; netFlow: number }[], vaultAddresses: [] as string[] };
        }

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
            dailyMap.set(key, {
              vaultAddress,
              date: utcDay.toISOString(),
              netFlow,
            });
          }
        }

        return {
          txCount: items.length,
          dailyBuckets: Array.from(dailyMap.values()),
          vaultAddresses: Array.from(vaultAddressSet),
        };
      },
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
      async () => {
        // Chunk addresses (max 100 per request, API limit)
        const CHUNK_SIZE = 100;
        const vaultDataByAddress = new Map<string, { address: string; name: string; chain: { id: number }; metadata?: { image?: string | null } | null }>();

        for (let i = 0; i < vaultAddresses.length; i += CHUNK_SIZE) {
          const chunk = vaultAddresses.slice(i, i + CHUNK_SIZE);
          const result = await client.request(VAULTS_BY_ADDRESSES, {
            where: { address_in: chunk, chainId_in: [1] },
            first: CHUNK_SIZE,
          });
          for (const v of result.vaults.items ?? []) {
            vaultDataByAddress.set(v.address as string, v);
          }
        }

        const mapping: Record<string, string> = {};

        for (const address of vaultAddresses) {
          const vaultData = vaultDataByAddress.get(address);
          if (!vaultData) continue;

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

    // ── Step 4: Upsert aggregated daily net flows ───────────────────────
    const { upsertCount } = await step.run(
      "upsert-daily-net-flows",
      async () => {
        const ops = dailyBuckets
          .filter(({ vaultAddress }) => !!vaultIdByAddress[vaultAddress])
          .map(({ vaultAddress, date, netFlow }) => {
            const vaultId = vaultIdByAddress[vaultAddress]!;
            const parsedDate = new Date(date);
            return prisma.dailyNetFlow.upsert({
              where: { vaultId_date: { vaultId, date: parsedDate } },
              create: { vaultId, date: parsedDate, netFlow },
              update: { netFlow },
            });
          });

        await prisma.$transaction(ops);

        return { upsertCount: ops.length };
      },
    );

    // ── Step 5: Update sync cursor ──────────────────────────────────────
    await step.run("update-sync-cursor", async () => {
      await prisma.syncCursor.upsert({
        where: { id: "vault-transactions" },
        create: { id: "vault-transactions", timestamp: endTimestamp },
        update: { timestamp: endTimestamp },
      });
    });

    logger.info(
      `Synced ${txCount} txs → ${upsertCount} daily buckets`,
    );

    return { txCount, upsertCount };
  },
);
