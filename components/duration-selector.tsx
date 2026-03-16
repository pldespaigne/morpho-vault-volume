"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Period } from "@/lib/leaderboard";

const periods = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "12m", label: "12 months" },
] as const;

export function DurationSelector({
  value,
  onValueChange,
  pending = false,
}: {
  value: Period;
  onValueChange: (value: Period) => void;
  pending?: boolean;
}) {
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    if (!pending) {
      setShowSpinner(false);
      return;
    }
    const timer = setTimeout(() => setShowSpinner(true), 100);
    return () => clearTimeout(timer);
  }, [pending]);

  return (
    <div className="relative flex items-center">
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
      {showSpinner && (
        <LoaderCircle className="absolute -right-6 h-4 w-4 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}
