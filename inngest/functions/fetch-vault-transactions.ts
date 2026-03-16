import { inngest } from "@/inngest/client";
import { client } from "@/lib/graphql/client";
import { fetchAllPages } from "@/lib/graphql/paginate";
import { VAULT_TRANSACTIONS } from "@/lib/graphql/queries";
import {
  OrderDirection,
  TransactionType,
  TransactionsOrderBy,
} from "@/lib/graphql/generated/graphql";

export const fetchVaultTransactions = inngest.createFunction(
  { id: "fetch-vault-transactions" },
  { cron: "*/10 * * * *" },
  async ({ step }) => {
    const items = await step.run("fetch-all-transactions", async () => {
      return fetchAllPages(
        client,
        VAULT_TRANSACTIONS,
        {
          where: {
            chainId_in: [1],
            type_in: [
              TransactionType.MetaMorphoDeposit,
              TransactionType.MetaMorphoWithdraw,
            ],
          },
          orderBy: TransactionsOrderBy.Timestamp,
          orderDirection: OrderDirection.Desc,
        },
        (r) => r.transactions,
      );
    });

    console.log(`[fetch-vault-transactions] Fetched ${items.length} items`);

    return { count: items.length };
  },
);
