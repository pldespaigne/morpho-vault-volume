import { client } from "./src/graphql/client.js";
import { fetchAllPages } from "./src/graphql/paginate.js";
import { VAULT_TRANSACTIONS } from "./src/graphql/queries.js";
import { OrderDirection, TransactionType, TransactionsOrderBy } from "./src/graphql/generated/graphql.js";

const items = await fetchAllPages(
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


console.log(JSON.stringify(items, null, 2));
console.log(`Fetched ${items.length} items`);