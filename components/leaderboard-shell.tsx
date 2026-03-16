"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { PeriodSelector } from "@/components/period-selector";
import { DurationSelector } from "@/components/duration-selector";
import { VaultLeaderboardTable } from "@/components/vault-leaderboard-table";
import type { LeaderboardResponse, Period } from "@/lib/leaderboard";

const ALL_PERIODS: Period[] = ["7d", "30d", "12m"];

export function LeaderboardShell({
  data,
  period,
}: {
  data: LeaderboardResponse;
  period: Period;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [offset, setOffset] = useState<0 | 1>(0);

  // Reset offset when period changes (data comes from server with new period)
  useEffect(() => {
    setOffset(0);
  }, [period]);

  // Prefetch all period URLs on mount so navigation is instant
  useEffect(() => {
    for (const p of ALL_PERIODS) {
      router.prefetch(`/?period=${p}`);
    }
  }, [router]);

  const handlePeriodChange = useCallback(
    (newPeriod: Period) => {
      startTransition(() => {
        router.push(`/?period=${newPeriod}`, { scroll: false });
      });
    },
    [router],
  );

  const activeWindow = offset === 0 ? data.current : data.previous;
  const dateRange = { from: activeWindow.from, to: activeWindow.to };

  // Build rank map from the previous period so we can show trend icons on the current period
  const prevRankMap =
    offset === 0
      ? new Map([
          ...data.previous.top.map((v, i) => [v.vaultId, i + 1] as const),
          ...data.previous.bottom.map((v, i) => [
            v.vaultId,
            data.totalVaultCount - data.previous.bottom.length + 1 + i,
          ] as const),
        ])
      : undefined;

  const bottomStartRank =
    data.totalVaultCount - activeWindow.bottom.length + 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Vault Leaderboard</h1>
        <div className="flex flex-col items-end gap-1">
          <PeriodSelector
            period={period}
            offset={offset}
            onOffsetChange={setOffset}
            dateRange={dateRange}
          />
          <DurationSelector
            value={period}
            onValueChange={handlePeriodChange}
            pending={isPending}
          />
        </div>
      </div>
      <VaultLeaderboardTable
        title="Top Net Flow"
        vaults={activeWindow.top}
        previousRankMap={prevRankMap}
      />
      {activeWindow.bottom.length > 0 && (
        <VaultLeaderboardTable
          title="Bottom Net Flow"
          vaults={activeWindow.bottom}
          startRank={bottomStartRank}
          previousRankMap={prevRankMap}
        />
      )}
    </div>
  );
}
