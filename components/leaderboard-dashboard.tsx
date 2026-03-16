"use client";

import { useCallback, useEffect, useState } from "react";
import { PeriodSelector, type Period } from "@/components/period-selector";
import { VaultLeaderboardTable } from "@/components/vault-leaderboard-table";
import type { LeaderboardResponse } from "@/app/api/leaderboard/route";

export function LeaderboardDashboard() {
  const [period, setPeriod] = useState<Period>("7d");
  const [offset, setOffset] = useState<0 | 1>(0);
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const handlePeriodChange = useCallback(
    (newPeriod: Period) => {
      setPeriod(newPeriod);
      setOffset(0);
    },
    [],
  );

  const fetchData = useCallback(async (period: Period, signal: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leaderboard?period=${period}`, { signal });
      if (!res.ok) throw new Error("Failed to fetch leaderboard");
      const json: LeaderboardResponse = await res.json();
      setData(json);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(period, controller.signal);
    return () => controller.abort();
  }, [period, fetchData]);

  const activeWindow = data ? (offset === 0 ? data.current : data.previous) : null;
  const dateRange = activeWindow ? { from: activeWindow.from, to: activeWindow.to } : null;

  // Build rank maps from the previous period so we can show trend icons on the current period
  const prevInflowRanks =
    offset === 0 && data?.previous
      ? new Map(data.previous.topInflow.map((v, i) => [v.vaultId, i + 1]))
      : undefined;
  const prevOutflowRanks =
    offset === 0 && data?.previous
      ? new Map(data.previous.topOutflow.map((v, i) => [v.vaultId, data.totalVaultCount - i]))
      : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Vault Leaderboard</h1>
        <PeriodSelector
          value={period}
          onValueChange={handlePeriodChange}
          offset={offset}
          onOffsetChange={setOffset}
          dateRange={dateRange}
        />
      </div>
      <VaultLeaderboardTable
        title="Top Inflow"
        vaults={activeWindow?.topInflow ?? []}
        loading={loading}
        previousRankMap={prevInflowRanks}
      />
      <VaultLeaderboardTable
        title="Top Outflow"
        vaults={activeWindow?.topOutflow ?? []}
        loading={loading}
        previousRankMap={prevOutflowRanks}
        totalVaultCount={data?.totalVaultCount}
      />
    </div>
  );
}
