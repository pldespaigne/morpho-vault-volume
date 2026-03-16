import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod/v4";

const periodSchema = z.enum(["7d", "30d", "12m"]);

export type LeaderboardVault = {
  vaultId: string;
  name: string;
  logo: string;
  address: string;
  netFlow: number;
};

export type PeriodData = {
  topInflow: LeaderboardVault[];
  topOutflow: LeaderboardVault[];
  from: string;
  to: string;
};

export type LeaderboardResponse = {
  current: PeriodData;
  previous: PeriodData;
  totalVaultCount: number;
};

function getPeriodMs(period: z.infer<typeof periodSchema>): number {
  switch (period) {
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return 30 * 24 * 60 * 60 * 1000;
    case "12m":
      return 365 * 24 * 60 * 60 * 1000;
  }
}

function getDateRange(
  period: z.infer<typeof periodSchema>,
  offset: 0 | 1,
): { gte: Date; lt: Date } {
  const now = new Date();
  const ms = getPeriodMs(period);
  const lt = new Date(now.getTime() - offset * ms);
  const gte = new Date(lt.getTime() - ms);
  return { gte, lt };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const periodParam = searchParams.get("period") ?? "7d";

  const parsed = periodSchema.safeParse(periodParam);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid period. Must be one of: 7d, 30d, 12m" },
      { status: 400 }
    );
  }

  const period = parsed.data;
  const currentRange = getDateRange(period, 0);
  const previousRange = getDateRange(period, 1);

  const currentWhere = { date: { gte: currentRange.gte, lt: currentRange.lt } };
  const previousWhere = { date: { gte: previousRange.gte, lt: previousRange.lt } };

  function groupByArgs(
    where: typeof currentWhere,
    order: "desc" | "asc",
  ) {
    return {
      by: ["vaultId"] as ["vaultId"],
      where,
      _sum: { netFlow: true as const },
      orderBy: { _sum: { netFlow: order } },
      take: 10,
    };
  }

  const [curInflow, curOutflow, prevInflow, prevOutflow] =
    period === "12m"
      ? await Promise.all([
          prisma.monthlyNetFlow.groupBy(groupByArgs(currentWhere, "desc")),
          prisma.monthlyNetFlow.groupBy(groupByArgs(currentWhere, "asc")),
          prisma.monthlyNetFlow.groupBy(groupByArgs(previousWhere, "desc")),
          prisma.monthlyNetFlow.groupBy(groupByArgs(previousWhere, "asc")),
        ])
      : await Promise.all([
          prisma.dailyNetFlow.groupBy(groupByArgs(currentWhere, "desc")),
          prisma.dailyNetFlow.groupBy(groupByArgs(currentWhere, "asc")),
          prisma.dailyNetFlow.groupBy(groupByArgs(previousWhere, "desc")),
          prisma.dailyNetFlow.groupBy(groupByArgs(previousWhere, "asc")),
        ]);

  const allVaultIds = [
    ...new Set([
      ...curInflow.map((r) => r.vaultId),
      ...curOutflow.map((r) => r.vaultId),
      ...prevInflow.map((r) => r.vaultId),
      ...prevOutflow.map((r) => r.vaultId),
    ]),
  ];

  const [vaults, totalVaultCount] = await Promise.all([
    prisma.vault.findMany({
      where: { id: { in: allVaultIds } },
    }),
    prisma.vault.count(),
  ]);

  const vaultMap = new Map(vaults.map((v) => [v.id, v]));

  function toLeaderboardVault(
    row: { vaultId: string; _sum?: { netFlow?: number | null } },
  ): LeaderboardVault {
    const vault = vaultMap.get(row.vaultId);
    return {
      vaultId: row.vaultId,
      name: vault?.name ?? "Unknown",
      logo: vault?.logo ?? "",
      address: vault?.address ?? "",
      netFlow: row._sum?.netFlow ?? 0,
    };
  }

  const response: LeaderboardResponse = {
    current: {
      topInflow: curInflow.map(toLeaderboardVault),
      topOutflow: curOutflow.map(toLeaderboardVault),
      from: currentRange.gte.toISOString(),
      to: currentRange.lt.toISOString(),
    },
    previous: {
      topInflow: prevInflow.map(toLeaderboardVault),
      topOutflow: prevOutflow.map(toLeaderboardVault),
      from: previousRange.gte.toISOString(),
      to: previousRange.lt.toISOString(),
    },
    totalVaultCount,
  };

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "s-maxage=600, stale-while-revalidate",
    },
  });
}
