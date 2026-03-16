import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const usdCompactFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdCompactSignedFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

export function formatUsd(value: number, { signed = false } = {}): string {
  return signed
    ? usdCompactSignedFormat.format(value)
    : usdCompactFormat.format(value);
}
