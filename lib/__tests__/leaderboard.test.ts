import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPeriodMs, getDateRange } from "../leaderboard";
import type { Period } from "../leaderboard";

// ── getPeriodMs ─────────────────────────────────────────────────────────

describe("getPeriodMs", () => {
  it("returns 7 days in ms for '7d'", () => {
    expect(getPeriodMs("7d")).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("returns 30 days in ms for '30d'", () => {
    expect(getPeriodMs("30d")).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("returns 365 days in ms for '12m'", () => {
    expect(getPeriodMs("12m")).toBe(365 * 24 * 60 * 60 * 1000);
  });
});

// ── getDateRange ────────────────────────────────────────────────────────

describe("getDateRange", () => {
  // Pin time to 2025-06-15T12:00:00.000Z
  const now = new Date("2025-06-15T12:00:00.000Z");

  it.each<{ period: Period; offset: 0 | 1; expectedGte: string; expectedLt: string }>([
    {
      period: "7d",
      offset: 0,
      expectedLt: "2025-06-15T12:00:00.000Z",
      expectedGte: "2025-06-08T12:00:00.000Z",
    },
    {
      period: "7d",
      offset: 1,
      expectedLt: "2025-06-08T12:00:00.000Z",
      expectedGte: "2025-06-01T12:00:00.000Z",
    },
    {
      period: "30d",
      offset: 0,
      expectedLt: "2025-06-15T12:00:00.000Z",
      expectedGte: "2025-05-16T12:00:00.000Z",
    },
    {
      period: "30d",
      offset: 1,
      expectedLt: "2025-05-16T12:00:00.000Z",
      expectedGte: "2025-04-16T12:00:00.000Z",
    },
    {
      period: "12m",
      offset: 0,
      expectedLt: "2025-06-15T12:00:00.000Z",
      expectedGte: "2024-06-15T12:00:00.000Z",
    },
    {
      period: "12m",
      offset: 1,
      expectedLt: "2024-06-15T12:00:00.000Z",
      expectedGte: "2023-06-16T12:00:00.000Z",
    },
  ])(
    "$period offset=$offset → [$expectedGte, $expectedLt)",
    ({ period, offset, expectedGte, expectedLt }) => {
      const range = getDateRange(period, offset, now);
      expect(range.gte.toISOString()).toBe(expectedGte);
      expect(range.lt.toISOString()).toBe(expectedLt);
    },
  );

  it("current window lt equals previous window lt + periodMs", () => {
    const current = getDateRange("30d", 0, now);
    const previous = getDateRange("30d", 1, now);
    // The previous period ends exactly where the current period starts
    expect(previous.lt.getTime()).toBe(current.gte.getTime());
  });

  it("window size is always exactly periodMs", () => {
    for (const period of ["7d", "30d", "12m"] as Period[]) {
      const range = getDateRange(period, 0, now);
      expect(range.lt.getTime() - range.gte.getTime()).toBe(
        getPeriodMs(period),
      );
    }
  });
});

// ── getLeaderboardData ──────────────────────────────────────────────────

// Mock next/cache before importing the module that uses "use cache"
vi.mock("next/cache", () => ({
  unstable_cacheLife: vi.fn(),
  unstable_cacheTag: vi.fn(),
}));

// Mock prisma
const mockGroupBy = vi.fn();
const mockFindManyFlow = vi.fn();
const mockFindManyVault = vi.fn();

vi.mock("../prisma", () => ({
  prisma: {
    dailyNetFlow: {
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
      findMany: (...args: unknown[]) => mockFindManyFlow(...args),
    },
    monthlyNetFlow: {
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
      findMany: (...args: unknown[]) => mockFindManyFlow(...args),
    },
    vault: {
      findMany: (...args: unknown[]) => mockFindManyVault(...args),
    },
  },
}));

// Import after mocks are set up
const { getLeaderboardData } = await import("../leaderboard");

describe("getLeaderboardData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns top and bottom vaults mapped with vault metadata", async () => {
    // findMany (distinct vaultId counts) → return 2 vaults each time
    mockFindManyFlow.mockResolvedValue([
      { vaultId: "v1" },
      { vaultId: "v2" },
    ]);

    // groupBy → top 2 vaults (only called for top since count <= LIMIT)
    mockGroupBy.mockResolvedValue([
      { vaultId: "v1", _sum: { netFlow: 5000 } },
      { vaultId: "v2", _sum: { netFlow: -1000 } },
    ]);

    // vault.findMany → return metadata
    mockFindManyVault.mockResolvedValue([
      { id: "v1", name: "Vault A", logo: "https://logo-a.png", address: "0xAAA" },
      { id: "v2", name: "Vault B", logo: "https://logo-b.png", address: "0xBBB" },
    ]);

    const result = await getLeaderboardData("7d");

    expect(result.current.top).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ vaultId: "v1", name: "Vault A", netFlow: 5000 }),
      ]),
    );
    expect(result.totalVaultCount).toBe(2);
  });

  it("fills defaults for unknown vaults", async () => {
    mockFindManyFlow.mockResolvedValue([{ vaultId: "v-unknown" }]);
    mockGroupBy.mockResolvedValue([
      { vaultId: "v-unknown", _sum: { netFlow: 100 } },
    ]);
    // No vault metadata found
    mockFindManyVault.mockResolvedValue([]);

    const result = await getLeaderboardData("30d");

    expect(result.current.top[0]).toEqual(
      expect.objectContaining({
        vaultId: "v-unknown",
        name: "Unknown",
        logo: "",
        address: "",
        netFlow: 100,
      }),
    );
  });

  it("returns from/to ISO strings matching the period window", async () => {
    mockFindManyFlow.mockResolvedValue([]);
    mockGroupBy.mockResolvedValue([]);
    mockFindManyVault.mockResolvedValue([]);

    const result = await getLeaderboardData("7d");

    // from and to should be valid ISO dates, 7 days apart
    const from = new Date(result.current.from);
    const to = new Date(result.current.to);
    expect(to.getTime() - from.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
