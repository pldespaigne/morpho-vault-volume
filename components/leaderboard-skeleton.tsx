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
import { Skeleton } from "@/components/ui/skeleton";

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

function SkeletonTable({ title }: { title: string }) {
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
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function LeaderboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <div className="flex flex-col items-end gap-1">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-9 w-56" />
        </div>
      </div>
      <SkeletonTable title="Top Net Flow" />
      <SkeletonTable title="Bottom Net Flow" />
    </div>
  );
}
