import { graphql } from "./generated/gql.js";

export const VAULT_TRANSACTIONS = graphql(`
  query VaultTransactions($where: TransactionFilters, $first: Int, $skip: Int, $orderBy: TransactionsOrderBy, $orderDirection: OrderDirection) {
    transactions(where: $where, first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection) {
      items {
        type
        timestamp
        data {
          ...on VaultTransactionData {
            vault {
              chain {
                id
              }
              address
            }
            assetsUsd
          }
        }
      }
      pageInfo {
        countTotal
        count
        limit
        skip
      }
    }
  }
`);
