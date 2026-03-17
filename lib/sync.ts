import { client } from "./graphql/client";
import { fetchAllPages } from "./graphql/paginate";
import {
  VAULTS_BY_ADDRESSES,
  VAULT_TRANSACTIONS,
} from "./graphql/queries";
import {
  OrderDirection,
  TransactionType,
  TransactionsOrderBy,
} from "./graphql/generated/graphql";
import { prisma } from "./prisma";

// ── Constants ───────────────────────────────────────────────────────────

/**
 * Default start timestamp when no sync cursor exists yet.
 * Morpho's first Vault (0x38989BBA00BDF8181F4082995b3DEAe96163aC5D).
 */
export const DEFAULT_START_TIMESTAMP = 1704292895;

/** Fixed 30-day window size (in milliseconds) for monthly aggregation. */
export const MONTHLY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Chunk size for Prisma $transaction batches. */
const DB_CHUNK_SIZE = 500;

/** Chunk size for fetching vault metadata from the API. */
const VAULT_API_CHUNK_SIZE = 100;

// ── Types ───────────────────────────────────────────────────────────────

export type DailyBucket = {
  vaultAddress: string;
  date: string;
  netFlow: number;
};

// ── Helpers ─────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// ── Shared sync functions ───────────────────────────────────────────────

/**
 * Fetch vault transactions from the Morpho API and aggregate them into
 * daily net-flow buckets (deposits positive, withdrawals negative).
 *
 * @param fromTimestamp - Inclusive start (unix seconds).
 * @param toTimestamp   - Inclusive end (unix seconds).
 */
export async function fetchAndAggregateDailyBuckets(
  fromTimestamp: number,
  toTimestamp: number,
): Promise<{
  txCount: number;
  dailyBuckets: DailyBucket[];
  vaultAddresses: string[];
}> {
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
        timestamp_gte: fromTimestamp,
        timestamp_lte: toTimestamp,
      },
      orderBy: TransactionsOrderBy.Timestamp,
      orderDirection: OrderDirection.Asc,
    },
    (r) => r.transactions,
  );

  if (items.length === 0) {
    return { txCount: 0, dailyBuckets: [], vaultAddresses: [] };
  }

  const vaultAddressSet = new Set<string>();
  const dailyMap = new Map<string, DailyBucket>();

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
}

/**
 * Fetch vault metadata from the Morpho API and upsert into the DB.
 *
 * @returns A mapping from vault address → vault ID.
 */
export async function ensureVaultsExist(
  vaultAddresses: string[],
): Promise<Record<string, string>> {
  const vaultDataByAddress = new Map<
    string,
    {
      address: string;
      name: string;
      chain: { id: number };
      metadata?: { image?: string | null } | null;
    }
  >();

  const apiChunks = chunk(vaultAddresses, VAULT_API_CHUNK_SIZE);
  for (const addrChunk of apiChunks) {
    const result = await client.request(VAULTS_BY_ADDRESSES, {
      where: { address_in: addrChunk, chainId_in: [1] },
      first: VAULT_API_CHUNK_SIZE,
    });
    for (const v of result.vaults.items ?? []) {
      vaultDataByAddress.set(v.address as string, v);
    }
  }

  const upserts = vaultAddresses
    .filter((address) => vaultDataByAddress.has(address))
    .map((address) => {
      const vaultData = vaultDataByAddress.get(address)!;
      return prisma.vault.upsert({
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
    });

  const mapping: Record<string, string> = {};
  const dbChunks = chunk(upserts, DB_CHUNK_SIZE);

  for (const batch of dbChunks) {
    const vaults = await prisma.$transaction(batch);
    for (const vault of vaults) {
      mapping[vault.address] = vault.id;
    }
  }

  return mapping;
}

/**
 * Upsert aggregated daily net-flow rows into the DB.
 */
export async function upsertDailyNetFlows(
  dailyBuckets: DailyBucket[],
  vaultIdByAddress: Record<string, string>,
): Promise<{ upsertCount: number }> {
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

  const dbChunks = chunk(ops, DB_CHUNK_SIZE);
  for (const batch of dbChunks) {
    await prisma.$transaction(batch);
  }

  return { upsertCount: ops.length };
}

/**
 * Aggregate DailyNetFlow → MonthlyNetFlow for a single 30-day window.
 */
export async function aggregateMonthlyWindow(
  windowStart: Date,
  windowEnd: Date,
): Promise<{ upsertCount: number }> {
  const aggregated = await prisma.dailyNetFlow.groupBy({
    by: ["vaultId"],
    where: {
      date: { gte: windowStart, lt: windowEnd },
    },
    _sum: { netFlow: true },
  });

  const ops = aggregated.map((row) =>
    prisma.monthlyNetFlow.upsert({
      where: {
        vaultId_date: { vaultId: row.vaultId, date: windowStart },
      },
      create: {
        vaultId: row.vaultId,
        date: windowStart,
        netFlow: row._sum.netFlow ?? 0,
      },
      update: {
        netFlow: row._sum.netFlow ?? 0,
      },
    }),
  );

  const dbChunks = chunk(ops, DB_CHUNK_SIZE);
  for (const batch of dbChunks) {
    await prisma.$transaction(batch);
  }

  return { upsertCount: aggregated.length };
}
