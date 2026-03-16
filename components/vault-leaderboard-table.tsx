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
import { VaultRow } from "@/components/vault-row";
import type { LeaderboardVault } from "@/lib/leaderboard";

export function VaultLeaderboardTable({
  title,
  vaults,
  previousRankMap,
  startRank = 1,
}: {
  title: string;
  vaults: LeaderboardVault[];
  previousRankMap?: Map<string, number>;
  startRank?: number;
}) {
  const computeRank = (index: number) => startRank + index;

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
            {vaults.map((vault, i) => (
              <VaultRow
                key={vault.vaultId}
                vault={vault}
                rank={computeRank(i)}
                previousRank={previousRankMap?.get(vault.vaultId)}
                isNew={
                  previousRankMap != null &&
                  !previousRankMap.has(vault.vaultId)
                }
              />
            ))}
            {vaults.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-center text-muted-foreground"
                >
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
