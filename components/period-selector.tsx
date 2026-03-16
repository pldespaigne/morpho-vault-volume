"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Period } from "@/lib/leaderboard";

export function PeriodSelector({
  period,
  offset,
  onOffsetChange,
  dateRange,
}: {
  period: Period;
  offset: 0 | 1;
  onOffsetChange: (value: 0 | 1) => void;
  dateRange: { from: string; to: string } | null;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        disabled={offset === 1}
        onClick={() => onOffsetChange(1)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-30 text-center text-xs text-muted-foreground">
        {dateRange
          ? `${formatDate(dateRange.from, period)} – ${formatDate(dateRange.to, period)}`
          : ""}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        disabled={offset === 0}
        onClick={() => onOffsetChange(0)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
