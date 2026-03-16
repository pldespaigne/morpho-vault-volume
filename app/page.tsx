import { Suspense } from "react";

import { getLeaderboardData, type Period } from "@/lib/leaderboard";
import { LeaderboardShell } from "@/components/leaderboard-shell";
import { LeaderboardSkeleton } from "@/components/leaderboard-skeleton";

const ALL_PERIODS: Period[] = ["7d", "30d", "12m"];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { period: rawPeriod } = await searchParams;
  const period: Period = ALL_PERIODS.includes(rawPeriod as Period)
    ? (rawPeriod as Period)
    : "7d";

  // Warm the server cache for the other two periods (fire-and-forget)
  for (const p of ALL_PERIODS) {
    if (p !== period) void getLeaderboardData(p);
  }

  const data = await getLeaderboardData(period);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Suspense fallback={<LeaderboardSkeleton />}>
        <LeaderboardShell data={data} period={period} />
      </Suspense>
    </main>
  );
}
