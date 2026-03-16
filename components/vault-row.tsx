import { TableCell, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TrendingUp, TrendingDown } from "lucide-react";
import { formatUsd } from "@/lib/utils";
import type { LeaderboardVault } from "@/lib/leaderboard";

export function VaultRow({
  vault,
  rank,
  previousRank,
  isNew,
}: {
  vault: LeaderboardVault;
  rank: number;
  previousRank?: number;
  isNew?: boolean;
}) {
  const href = `https://app.morpho.org/ethereum/vault/${vault.address}`;

  // Compute trend: compare current rank against previous period rank
  let trendIcon: React.ReactNode = null;
  if (previousRank !== undefined) {
    if (previousRank > rank) {
      // Moved up
      trendIcon = <TrendingUp className="h-4 w-4 shrink-0 text-green-500" />;
    } else if (previousRank < rank) {
      // Moved down
      trendIcon = <TrendingDown className="h-4 w-4 shrink-0 text-red-500" />;
    }
    // previousRank === rank → unchanged, no icon
  } else if (isNew) {
    // Vault was not in the previous period's top/bottom — it's a new entry
    trendIcon = <TrendingUp className="h-4 w-4 shrink-0 text-green-500" />;
  }

  return (
    <TableRow className="relative">
      <TableCell className="w-10 font-medium">{rank}</TableCell>
      <TableCell>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 after:absolute after:inset-0"
        >
          <Avatar className="h-6 w-6">
            <AvatarImage src={vault.logo} alt={vault.name} />
            <AvatarFallback className="text-xs">
              {vault.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{vault.name}</span>
          {trendIcon}
        </a>
      </TableCell>
      <TableCell
        className={`text-right font-mono ${
          vault.netFlow > 0
            ? "text-green-500"
            : vault.netFlow < 0
              ? "text-red-500"
              : ""
        }`}
      >
        {formatUsd(vault.netFlow, { signed: true })}
      </TableCell>
    </TableRow>
  );
}
