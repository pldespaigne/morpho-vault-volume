import pLimit from "p-limit";
import pRetry, { AbortError } from "p-retry";
import { ClientError } from "graphql-request";
import type { GraphQLClient } from "graphql-request";
import type { ResultOf, VariablesOf } from "@graphql-typed-document-node/core";

/** Shape every paginated Morpho API response exposes via its nested object. */
export interface PaginatedResult<TItem> {
  items?: TItem[] | null;
  pageInfo?: {
    countTotal: number;
    count: number;
    limit: number;
    skip: number;
  } | null;
}

/** Tuning knobs for {@link fetchAllPages}. */
export interface FetchAllPagesOptions {
  /** Max items per page (maps to the `first` variable). @default 1000 */
  pageSize?: number;
  /** Max concurrent in-flight requests. @default 5 */
  maxConcurrency?: number;
  /** Max retries per page for transient / server errors. @default 3 */
  retries?: number;
  /** Initial retry delay in ms (doubles each attempt). @default 1000 */
  minTimeout?: number;
  /** Ceiling for the retry delay in ms. @default 30_000 */
  maxTimeout?: number;
  /**
   * Hard cap on consecutive 429 retries **per page** before aborting.
   * These retries do NOT consume the regular retry budget.
   * @default 10
   */
  maxRateLimitRetries?: number;
}

const DEFAULTS = {
  pageSize: 1_000,
  maxConcurrency: 5,
  retries: 3,
  minTimeout: 1_000,
  maxTimeout: 30_000,
  maxRateLimitRetries: 5,
} as const satisfies Required<FetchAllPagesOptions>;

const isRateLimited = (error: unknown): boolean =>
  error instanceof ClientError && error.response.status === 429;

const isNonRetryableClientError = (error: unknown): boolean =>
  error instanceof ClientError &&
  error.response.status >= 400 &&
  error.response.status < 500 &&
  error.response.status !== 429;

interface ComplexityInfo {
  complexity: number;
  maximumComplexity: number;
}

/** Extract complexity info from a GraphQL "query too complex" error, if any. */
const getComplexityError = (error: unknown): ComplexityInfo | null => {
  if (!(error instanceof ClientError)) return null;
  const errors: unknown[] =
    (error.response as Record<string, unknown>)?.errors as unknown[] ?? [];
  for (const e of errors) {
    const entry = e as Record<string, unknown>;
    if (
      typeof entry.message === "string" &&
      entry.message.toLowerCase().includes("too complex") &&
      typeof entry.extensions === "object" &&
      entry.extensions !== null
    ) {
      const ext = entry.extensions as Record<string, unknown>;
      if (
        typeof ext.complexity === "number" &&
        typeof ext.maximumComplexity === "number"
      ) {
        return {
          complexity: ext.complexity,
          maximumComplexity: ext.maximumComplexity,
        };
      }
    }
  }
  return null;
};

/** Thrown when the API reports the query exceeds its complexity budget. */
class QueryTooComplexError extends Error {
  constructor(
    public readonly info: ComplexityInfo,
    skip: number,
  ) {
    super(
      `Query too complex (${info.complexity}/${info.maximumComplexity}) at skip=${skip} – try a smaller pageSize`,
    );
    this.name = "QueryTooComplexError";
  }
}

/**
 * Fetches **all pages** of an offset-paginated Morpho GraphQL query.
 *
 * Strategy:
 * 1. Fetch page 0 to discover `countTotal`.
 * 2. Compute all remaining offsets and fire them concurrently (bounded by
 *    `maxConcurrency` via `p-limit`).
 * 3. Each page request is wrapped in `p-retry` with exponential back-off +
 *    jitter. HTTP 429 responses are retried **without** consuming the retry
 *    budget, up to a configurable hard cap (`maxRateLimitRetries`).
 *
 * @typeParam TDoc  – The typed document (inferred automatically).
 * @typeParam TItem – Type of a single item inside `items`.
 *
 * @param client    – A `graphql-request` {@link GraphQLClient} instance.
 * @param document  – A typed document node produced by GraphQL Code Generator.
 * @param variables – Query variables **without** `first` / `skip` (managed internally).
 * @param accessor  – Extracts the paginated field from the query result
 *                    (e.g. `(r) => r.transactions`).
 * @param options   – Optional tuning knobs (see {@link FetchAllPagesOptions}).
 * @returns A flat array of every `TItem` across all pages.
 */
export async function fetchAllPages<TDoc, TItem>(
  client: GraphQLClient,
  document: TDoc,
  variables: Omit<VariablesOf<TDoc>, "first" | "skip">,
  accessor: (result: ResultOf<TDoc>) => PaginatedResult<TItem>,
  options?: FetchAllPagesOptions,
): Promise<TItem[]> {
  const {
    pageSize,
    maxConcurrency,
    retries,
    minTimeout,
    maxTimeout,
    maxRateLimitRetries,
  } = { ...DEFAULTS, ...options };

  const limit = pLimit(maxConcurrency);

  /** Build the full variables object for a given offset. */
  const buildVars = (skip: number) =>
    ({ ...variables, first: pageSize, skip }) as unknown as VariablesOf<TDoc>;

  // Typed wrapper — VariablesAndRequestHeadersArgs is a conditional type that
  // TypeScript cannot resolve over a generic TVars. We fix the generics at the
  // call-site instead and keep the outer signature fully type-safe.
  const requestPage = (skip: number) =>
    client.request<ResultOf<TDoc>, Record<string, unknown>>(
      document as unknown as string,
      buildVars(skip) as Record<string, unknown>,
    );

  /** Fetch a single page with retry + exponential backoff. */
  const fetchPage = (skip: number): Promise<PaginatedResult<TItem>> => {
    let rateLimitHits = 0;

    return pRetry(
      async () => {
        const result = await requestPage(skip);
        return accessor(result);
      },
      {
        retries,
        minTimeout,
        maxTimeout,
        factor: 2,
        randomize: true, // jitter to avoid thundering-herd

        onFailedAttempt({ error, attemptNumber, retriesLeft }) {
          if (isRateLimited(error)) {
            rateLimitHits++;
            if (rateLimitHits > maxRateLimitRetries) {
              throw new AbortError(
                `Exceeded ${maxRateLimitRetries} consecutive 429 retries for skip=${skip}`,
              );
            }
            console.warn(
              `[paginate] 429 rate-limited (${rateLimitHits}/${maxRateLimitRetries}) – skip=${skip}, backing off…`,
            );
            return;
          }

          // Complexity errors (HTTP 500 with "Query is too complex") → abort immediately
          const complexityInfo = getComplexityError(error);
          if (complexityInfo) {
            throw new QueryTooComplexError(complexityInfo, skip);
          }

          // Non-retryable client errors (4xx except 429) → abort immediately
          if (isNonRetryableClientError(error)) {
            throw new AbortError(
              `Non-retryable ${(error as unknown as ClientError).response.status} error for skip=${skip}`,
            );
          }

          // Transient / server errors → p-retry handles the backoff
          console.warn(
            `[paginate] Transient error (attempt ${attemptNumber}, ${retriesLeft} retries left) – skip=${skip}: ${error.message}`,
          );
        },

        shouldConsumeRetry({ error }) {
          // 429 retries are "free" – don't burn the regular budget
          return !isRateLimited(error);
        },
      },
    );
  };

  // -- 1. First page (sequential) – discover countTotal ----------------------

  console.log(`[paginate] Fetching first page (pageSize=${pageSize})…`);
  const firstPage = await fetchPage(0);
  const countTotal = firstPage.pageInfo?.countTotal ?? 0;
  const firstPageCount = firstPage.items?.length ?? 0;
  const allItems: TItem[] = [...(firstPage.items ?? [])];

  console.log(
    `[paginate] First page returned ${firstPageCount} items – ${countTotal} total items discovered`,
  );

  if (countTotal <= pageSize) {
    console.log(`[paginate] All ${countTotal} items fit in a single page, done.`);
    return allItems;
  }

  console.log(
    `[paginate] ${countTotal} total items – fetching ${Math.ceil((countTotal - pageSize) / pageSize)} remaining pages (concurrency: ${maxConcurrency})`,
  );

  // -- 2. Remaining pages (concurrent, bounded) ------------------------------

  const offsets: number[] = [];
  for (let skip = pageSize; skip < countTotal; skip += pageSize) {
    offsets.push(skip);
  }

  const totalPages = offsets.length + 1; // +1 for the first page
  let completedPages = 1; // first page already done

  const remainingPages = await Promise.all(
    offsets.map((skip) =>
      limit(async () => {
        const page = await fetchPage(skip);
        completedPages++;
        console.log(
          `[paginate] ${completedPages}/${totalPages} pages done`,
        );
        return page;
      }),
    ),
  );

  for (const page of remainingPages) {
    allItems.push(...(page.items ?? []));
  }

  console.log(
    `[paginate] Done – collected ${allItems.length} items across ${totalPages} pages.`,
  );

  return allItems;
}
