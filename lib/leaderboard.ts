"use cache";

import {
  unstable_cacheLife as cacheLife,
  unstable_cacheTag as cacheTag,
} from "next/cache";

import { prisma } from "./prisma";

const LIMIT = 10;

// ── Types ───────────────────────────────────────────────────────────────

export type Period = "7d" | "30d" | "12m";

export type LeaderboardVault = {
  vaultId: string;
  name: string;
  logo: string;
  address: string;
  netFlow: number;
};

export type PeriodData = {
  top: LeaderboardVault[];
  bottom: LeaderboardVault[];
  from: string;
  to: string;
};

export type LeaderboardResponse = {
  current: PeriodData;
  previous: PeriodData;
  totalVaultCount: number;
};

// ── Helpers ─────────────────────────────────────────────────────────────

/** @internal Exported for testing. */
export function getPeriodMs(period: Period): number {
  switch (period) {
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return 30 * 24 * 60 * 60 * 1000;
    case "12m":
      return 365 * 24 * 60 * 60 * 1000;
  }
}

/** @internal Exported for testing. */
export function getDateRange(
  period: Period,
  offset: 0 | 1,
  now: Date = new Date(),
): { gte: Date; lt: Date } {
  const ms = getPeriodMs(period);
  const lt = new Date(now.getTime() - offset * ms);
  const gte = new Date(lt.getTime() - ms);
  return { gte, lt };
}

// ── Main data function ──────────────────────────────────────────────────

export async function getLeaderboardData(
  period: Period,
): Promise<LeaderboardResponse> {
  cacheLife("minutes");
  cacheTag("leaderboard", `leaderboard-${period}`);

  const currentRange = getDateRange(period, 0);
  const previousRange = getDateRange(period, 1);

  const currentWhere = {
    date: { gte: currentRange.gte, lt: currentRange.lt },
  };
  const previousWhere = {
    date: { gte: previousRange.gte, lt: previousRange.lt },
  };

  const useMonthly = period === "12m";

  // Get per-window distinct vault counts (for skip) and global count (for rank labels)
  const [curWindowCount, prevWindowCount, totalVaultCount] = useMonthly
    ? await Promise.all([
        prisma.monthlyNetFlow
          .findMany({
            where: currentWhere,
            select: { vaultId: true },
            distinct: ["vaultId"],
          })
          .then((rows) => rows.length),
        prisma.monthlyNetFlow
          .findMany({
            where: previousWhere,
            select: { vaultId: true },
            distinct: ["vaultId"],
          })
          .then((rows) => rows.length),
        prisma.monthlyNetFlow
          .findMany({
            select: { vaultId: true },
            distinct: ["vaultId"],
          })
          .then((rows) => rows.length),
      ])
    : await Promise.all([
        prisma.dailyNetFlow
          .findMany({
            where: currentWhere,
            select: { vaultId: true },
            distinct: ["vaultId"],
          })
          .then((rows) => rows.length),
        prisma.dailyNetFlow
          .findMany({
            where: previousWhere,
            select: { vaultId: true },
            distinct: ["vaultId"],
          })
          .then((rows) => rows.length),
        prisma.dailyNetFlow
          .findMany({
            select: { vaultId: true },
            distinct: ["vaultId"],
          })
          .then((rows) => rows.length),
      ]);

  const curBottomSkip = Math.max(LIMIT, curWindowCount - LIMIT);
  const prevBottomSkip = Math.max(LIMIT, prevWindowCount - LIMIT);

  function topArgs(where: typeof currentWhere) {
    return {
      by: ["vaultId"] as ["vaultId"],
      where,
      _sum: { netFlow: true as const },
      orderBy: { _sum: { netFlow: "desc" as const } },
      take: LIMIT,
    } as const;
  }

  function bottomArgs(where: typeof currentWhere, skip: number) {
    return {
      by: ["vaultId"] as ["vaultId"],
      where,
      _sum: { netFlow: true as const },
      orderBy: { _sum: { netFlow: "desc" as const } },
      skip,
      take: LIMIT,
    } as const;
  }

  type FlowRow = { vaultId: string; _sum: { netFlow: number | null } };
  const emptyRows: FlowRow[] = [];

  const [curTop, curBottom, prevTop, prevBottom] = useMonthly
    ? await Promise.all([
        prisma.monthlyNetFlow.groupBy(topArgs(currentWhere)),
        curWindowCount > LIMIT
          ? prisma.monthlyNetFlow.groupBy(
              bottomArgs(currentWhere, curBottomSkip),
            )
          : emptyRows,
        prisma.monthlyNetFlow.groupBy(topArgs(previousWhere)),
        prevWindowCount > LIMIT
          ? prisma.monthlyNetFlow.groupBy(
              bottomArgs(previousWhere, prevBottomSkip),
            )
          : emptyRows,
      ])
    : await Promise.all([
        prisma.dailyNetFlow.groupBy(topArgs(currentWhere)),
        curWindowCount > LIMIT
          ? prisma.dailyNetFlow.groupBy(
              bottomArgs(currentWhere, curBottomSkip),
            )
          : emptyRows,
        prisma.dailyNetFlow.groupBy(topArgs(previousWhere)),
        prevWindowCount > LIMIT
          ? prisma.dailyNetFlow.groupBy(
              bottomArgs(previousWhere, prevBottomSkip),
            )
          : emptyRows,
      ]);

  const allVaultIds = [
    ...new Set([
      ...curTop.map((r) => r.vaultId),
      ...curBottom.map((r) => r.vaultId),
      ...prevTop.map((r) => r.vaultId),
      ...prevBottom.map((r) => r.vaultId),
    ]),
  ];

  const vaults = await prisma.vault.findMany({
    where: { id: { in: allVaultIds } },
  });

  const vaultMap = new Map(vaults.map((v) => [v.id, v]));

  function toLeaderboardVault(row: {
    vaultId: string;
    _sum?: { netFlow?: number | null };
  }): LeaderboardVault {
    const vault = vaultMap.get(row.vaultId);
    return {
      vaultId: row.vaultId,
      name: vault?.name ?? "Unknown",
      logo: vault?.logo ?? "",
      address: vault?.address ?? "",
      netFlow: row._sum?.netFlow ?? 0,
    };
  }

  return {
    current: {
      top: curTop.map(toLeaderboardVault),
      bottom: curBottom.map(toLeaderboardVault),
      from: currentRange.gte.toISOString(),
      to: currentRange.lt.toISOString(),
    },
    previous: {
      top: prevTop.map(toLeaderboardVault),
      bottom: prevBottom.map(toLeaderboardVault),
      from: previousRange.gte.toISOString(),
      to: previousRange.lt.toISOString(),
    },
    totalVaultCount,
  };
}
