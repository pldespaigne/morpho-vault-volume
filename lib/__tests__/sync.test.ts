import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock side-effectful imports so sync.ts can load without env vars or DB
vi.mock("../graphql/client", () => ({ client: {} }));
vi.mock("../graphql/paginate", () => ({ fetchAllPages: vi.fn() }));
vi.mock("../graphql/queries", () => ({
  VAULT_TRANSACTIONS: "",
  VAULTS_BY_ADDRESSES: "",
}));

const mockGroupBy = vi.fn();
const mockUpsert = vi.fn();
const mockTransaction = vi.fn();

vi.mock("../prisma", () => ({
  prisma: {
    dailyNetFlow: {
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
    },
    monthlyNetFlow: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

import {
  chunk,
  aggregateTransactionsToDailyBuckets,
  aggregateMonthlyWindow,
  type RawTransaction,
} from "../sync";

// ── chunk ───────────────────────────────────────────────────────────────

describe("chunk", () => {
  it("splits an array into chunks of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns one chunk when size >= array length", () => {
    expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it("returns empty array for empty input", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("handles chunk size of 1", () => {
    expect(chunk(["a", "b", "c"], 1)).toEqual([["a"], ["b"], ["c"]]);
  });
});

// ── aggregateTransactionsToDailyBuckets ─────────────────────────────────

describe("aggregateTransactionsToDailyBuckets", () => {
  const VAULT_A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const VAULT_B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

  /** Helper to create a typed transaction fixture. */
  function makeTx(
    type: "MetaMorphoDeposit" | "MetaMorphoWithdraw",
    vaultAddress: string,
    timestamp: number,
    assetsUsd: number,
  ): RawTransaction {
    return {
      type,
      timestamp,
      data: { vault: { address: vaultAddress }, assetsUsd },
    };
  }

  it("deposits are positive, withdrawals are negative", () => {
    const txs = [
      makeTx("MetaMorphoDeposit", VAULT_A, 1700000000, 100),
      makeTx("MetaMorphoWithdraw", VAULT_A, 1700000001, 40),
    ];

    const { dailyBuckets } = aggregateTransactionsToDailyBuckets(txs);
    // Same vault, same day → summed: 100 + (-40) = 60
    expect(dailyBuckets).toHaveLength(1);
    expect(dailyBuckets[0]!.netFlow).toBe(60);
    expect(dailyBuckets[0]!.vaultAddress).toBe(VAULT_A);
  });

  it("sums multiple transactions for the same vault and day", () => {
    // All on the same UTC day (2023-11-14)
    const txs = [
      makeTx("MetaMorphoDeposit", VAULT_A, 1700000000, 200),
      makeTx("MetaMorphoDeposit", VAULT_A, 1700000100, 300),
      makeTx("MetaMorphoWithdraw", VAULT_A, 1700000200, 50),
    ];

    const { dailyBuckets } = aggregateTransactionsToDailyBuckets(txs);
    expect(dailyBuckets).toHaveLength(1);
    expect(dailyBuckets[0]!.netFlow).toBe(200 + 300 - 50);
  });

  it("keeps different vaults on the same day separate", () => {
    const txs = [
      makeTx("MetaMorphoDeposit", VAULT_A, 1700000000, 100),
      makeTx("MetaMorphoDeposit", VAULT_B, 1700000000, 200),
    ];

    const { dailyBuckets, vaultAddresses } =
      aggregateTransactionsToDailyBuckets(txs);
    expect(dailyBuckets).toHaveLength(2);
    expect(vaultAddresses).toContain(VAULT_A);
    expect(vaultAddresses).toContain(VAULT_B);
  });

  it("keeps same vault on different days separate", () => {
    // Two timestamps 2 days apart
    const day1 = 1700000000; // 2023-11-14
    const day2 = day1 + 2 * 86400; // 2023-11-16

    const txs = [
      makeTx("MetaMorphoDeposit", VAULT_A, day1, 100),
      makeTx("MetaMorphoDeposit", VAULT_A, day2, 200),
    ];

    const { dailyBuckets } = aggregateTransactionsToDailyBuckets(txs);
    expect(dailyBuckets).toHaveLength(2);

    const sorted = dailyBuckets.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    expect(sorted[0]!.netFlow).toBe(100);
    expect(sorted[1]!.netFlow).toBe(200);
  });

  it("skips transactions without vault in data", () => {
    const txs: RawTransaction[] = [
      {
        type: "MetaMorphoDeposit",
        timestamp: 1700000000,
        data: { someOtherField: true }, // no "vault" key
      },
      makeTx("MetaMorphoDeposit", VAULT_A, 1700000000, 100),
    ];

    const { dailyBuckets, vaultAddresses } =
      aggregateTransactionsToDailyBuckets(txs);
    expect(dailyBuckets).toHaveLength(1);
    expect(vaultAddresses).toEqual([VAULT_A]);
  });

  it("returns empty arrays for empty input", () => {
    const { dailyBuckets, vaultAddresses } =
      aggregateTransactionsToDailyBuckets([]);
    expect(dailyBuckets).toEqual([]);
    expect(vaultAddresses).toEqual([]);
  });

  it("treats null assetsUsd as 0", () => {
    const txs: RawTransaction[] = [
      {
        type: "MetaMorphoDeposit",
        timestamp: 1700000000,
        data: { vault: { address: VAULT_A }, assetsUsd: null },
      },
    ];

    const { dailyBuckets } = aggregateTransactionsToDailyBuckets(txs);
    expect(dailyBuckets).toHaveLength(1);
    expect(dailyBuckets[0]!.netFlow).toBe(0);
  });

  it("produces correct UTC date strings regardless of timestamp time-of-day", () => {
    // 2023-11-14T23:59:59 UTC — should still bucket to Nov 14
    const txs = [makeTx("MetaMorphoDeposit", VAULT_A, 1700006399, 100)];

    const { dailyBuckets } = aggregateTransactionsToDailyBuckets(txs);
    expect(dailyBuckets[0]!.date).toBe("2023-11-14T00:00:00.000Z");
  });
});
// ── aggregateMonthlyWindow ──────────────────────────────────────────────

describe("aggregateMonthlyWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const windowStart = new Date("2025-01-01T00:00:00.000Z");
  const windowEnd = new Date("2025-01-31T00:00:00.000Z");

  it("groups daily rows by vault and upserts monthly totals", async () => {
    mockGroupBy.mockResolvedValue([
      { vaultId: "v1", _sum: { netFlow: 1500 } },
      { vaultId: "v2", _sum: { netFlow: -300 } },
    ]);

    // mockUpsert returns a dummy value; $transaction resolves the batch
    const upsertSentinel = { id: "upserted" };
    mockUpsert.mockReturnValue(upsertSentinel);
    mockTransaction.mockResolvedValue([upsertSentinel, upsertSentinel]);

    const result = await aggregateMonthlyWindow(windowStart, windowEnd);

    expect(result.upsertCount).toBe(2);

    // groupBy was called with correct window
    expect(mockGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["vaultId"],
        where: { date: { gte: windowStart, lt: windowEnd } },
        _sum: { netFlow: true },
      }),
    );

    // upsert called once per vault
    expect(mockUpsert).toHaveBeenCalledTimes(2);

    // First upsert for v1
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { vaultId_date: { vaultId: "v1", date: windowStart } },
        create: expect.objectContaining({ vaultId: "v1", netFlow: 1500 }),
        update: { netFlow: 1500 },
      }),
    );

    // Second upsert for v2 (negative flow preserved)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { vaultId_date: { vaultId: "v2", date: windowStart } },
        create: expect.objectContaining({ vaultId: "v2", netFlow: -300 }),
        update: { netFlow: -300 },
      }),
    );
  });

  it("returns zero upserts when no daily rows exist in the window", async () => {
    mockGroupBy.mockResolvedValue([]);

    const result = await aggregateMonthlyWindow(windowStart, windowEnd);

    expect(result.upsertCount).toBe(0);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("defaults netFlow to 0 when _sum.netFlow is null", async () => {
    mockGroupBy.mockResolvedValue([
      { vaultId: "v1", _sum: { netFlow: null } },
    ]);
    mockUpsert.mockReturnValue({});
    mockTransaction.mockResolvedValue([{}]);

    await aggregateMonthlyWindow(windowStart, windowEnd);

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ netFlow: 0 }),
        update: { netFlow: 0 },
      }),
    );
  });
});