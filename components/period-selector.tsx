"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PeriodNavigator } from "@/components/period-navigator";

const periods = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "12m", label: "12 months" },
] as const;

export type Period = (typeof periods)[number]["value"];

export function PeriodSelector({
  value,
  onValueChange,
  offset,
  onOffsetChange,
  dateRange,
}: {
  value: Period;
  onValueChange: (value: Period) => void;
  offset: 0 | 1;
  onOffsetChange: (value: 0 | 1) => void;
  dateRange: { from: string; to: string } | null;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <PeriodNavigator
        period={value}
        offset={offset}
        onOffsetChange={onOffsetChange}
        dateRange={dateRange}
      />
      <ToggleGroup
        value={[value]}
        onValueChange={(newValue) => {
          if (newValue.length > 0) {
            onValueChange(newValue[0] as Period);
          }
        }}
        variant="outline"
      >
        {periods.map((p) => (
          <ToggleGroupItem key={p.value} value={p.value}>
            {p.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
