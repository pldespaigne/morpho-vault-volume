import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { aggregateMonthlyWindow, MONTHLY_WINDOW_MS } from "@/lib/sync";

/** Maximum number of 30-day windows to process per invocation. */
const MAX_WINDOWS_PER_RUN = 6;

export const aggregateMonthlyNetFlows = inngest.createFunction(
  {
    id: "aggregate-monthly-net-flows",
    concurrency: {
      limit: 1,
      key: "aggregate-monthly-net-flows",
      scope: "fn",
    },
  },
  { cron: "0 * * * *" },
  async ({ step, logger }) => {
    // ── Step 1: Determine the start date for windowing ──────────────────
    const cursorIso = await step.run("get-cursor", async () => {
      // Check if we have a cursor from a previous run.
      const cursor = await prisma.syncCursor.findUnique({
        where: { id: "monthly-net-flow" },
      });

      if (cursor) {
        // The cursor stores the end of the last processed window (unix s).
        return new Date(cursor.timestamp * 1000).toISOString();
      }

      // No cursor yet — find the earliest DailyNetFlow date.
      const earliest = await prisma.dailyNetFlow.findFirst({
        orderBy: { date: "asc" },
        select: { date: true },
      });

      if (!earliest) return null; // DB is empty, nothing to do.

      return earliest.date.toISOString();
    });

    // Short-circuit: no daily data at all.
    if (cursorIso === null) {
      logger.info("No DailyNetFlow data — nothing to aggregate.");
      return { windowsProcessed: 0, upsertCount: 0 };
    }

    // ── Step 2: Build 30-day windows that are fully complete ────────────
    const windows = await step.run("compute-windows", async () => {
      const startOfTodayUtc = Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
      );

      const result: { start: string; end: string }[] = [];
      let windowStart = new Date(cursorIso).getTime();

      for (let i = 0; i < MAX_WINDOWS_PER_RUN; i++) {
        const windowEnd = windowStart + MONTHLY_WINDOW_MS;

        // Only process windows whose end date is ≤ start-of-today.
        if (windowEnd > startOfTodayUtc) break;

        result.push({
          start: new Date(windowStart).toISOString(),
          end: new Date(windowEnd).toISOString(),
        });

        windowStart = windowEnd;
      }

      return result;
    });

    if (windows.length === 0) {
      logger.info("No complete 30-day windows to process yet.");
      return { windowsProcessed: 0, upsertCount: 0 };
    }

    // ── Step 3: Aggregate DailyNetFlow → MonthlyNetFlow per window ──────
    const { upsertCount } = await step.run(
      "aggregate-and-upsert",
      async () => {
        let count = 0;

        for (const { start, end } of windows) {
          const result = await aggregateMonthlyWindow(
            new Date(start),
            new Date(end),
          );
          count += result.upsertCount;
        }

        return { upsertCount: count };
      },
    );

    // ── Step 4: Advance the sync cursor ─────────────────────────────────
    await step.run("advance-cursor", async () => {
      const lastWindow = windows[windows.length - 1]!;
      const endTimestamp = Math.floor(
        new Date(lastWindow.end).getTime() / 1000,
      );

      await prisma.syncCursor.upsert({
        where: { id: "monthly-net-flow" },
        create: { id: "monthly-net-flow", timestamp: endTimestamp },
        update: { timestamp: endTimestamp },
      });
    });

    // ── Step 5: Invalidate leaderboard cache (only if we wrote new data) ─
    if (upsertCount > 0) {
      await step.run("invalidate-cache", async () => {
        const { revalidateTag } = await import("next/cache");
        revalidateTag("leaderboard");
      });
    }

    logger.info(
      `Aggregated ${windows.length} window(s) → ${upsertCount} monthly rows`,
    );

    return { windowsProcessed: windows.length, upsertCount };
  },
);
