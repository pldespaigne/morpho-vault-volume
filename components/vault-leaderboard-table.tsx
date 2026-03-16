import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown } from "lucide-react";
import { formatUsd } from "@/lib/utils";
import type { LeaderboardVault } from "@/app/api/leaderboard/route";

function VaultRow({
  vault,
  rank,
  previousRankMap,
}: {
  vault: LeaderboardVault;
  rank: number;
  previousRankMap?: Map<string, number>;
}) {
  const href = `https://app.morpho.org/ethereum/vault/${vault.address}`;

  // Compute trend: compare current rank against previous period rank
  let trendIcon: React.ReactNode = null;
  if (previousRankMap) {
    const prevRank = previousRankMap.get(vault.vaultId);
    if (prevRank === undefined || prevRank > rank) {
      // New entry or moved up
      trendIcon = <TrendingUp className="h-4 w-4 shrink-0 text-green-500" />;
    } else if (prevRank < rank) {
      // Moved down
      trendIcon = <TrendingDown className="h-4 w-4 shrink-0 text-red-500" />;
    }
    // prevRank === rank → unchanged, no icon
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

function SkeletonRow() {
  return (
    <TableRow>
      <TableCell className="w-10">
        <Skeleton className="h-4 w-4" />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Skeleton className="ml-auto h-4 w-16" />
      </TableCell>
    </TableRow>
  );
}

export function VaultLeaderboardTable({
  title,
  vaults,
  loading,
  previousRankMap,
  totalVaultCount,
}: {
  title: string;
  vaults: LeaderboardVault[];
  loading: boolean;
  previousRankMap?: Map<string, number>;
  totalVaultCount?: number;
}) {
  // When totalVaultCount is provided (outflow table), reverse the list so
  // the vault with the largest outflow appears at the bottom and gets the
  // highest rank number (= totalVaultCount).
  const displayVaults = totalVaultCount != null ? [...vaults].reverse() : vaults;
  const computeRank = (index: number) =>
    totalVaultCount != null
      ? totalVaultCount - vaults.length + 1 + index
      : index + 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Vault</TableHead>
              <TableHead className="text-right">Net Flow</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))
              : displayVaults.map((vault, i) => (
                  <VaultRow key={vault.vaultId} vault={vault} rank={computeRank(i)} previousRankMap={previousRankMap} />
                ))}
            {!loading && vaults.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No data available
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
