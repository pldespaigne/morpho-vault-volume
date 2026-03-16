import { graphql } from "@/lib/graphql/generated/gql";

export const VAULT_BY_ADDRESS = graphql(`
  query VaultByAddress($address: String!, $chainId: Int) {
    vaultByAddress(address: $address, chainId: $chainId) {
      address
      name
      metadata {
        image
      }
      chain {
        id
      }
    }
  }
`);

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
