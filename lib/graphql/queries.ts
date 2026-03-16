import { graphql } from "@/lib/graphql/generated/gql";

export const VAULTS_BY_ADDRESSES = graphql(`
  query VaultsByAddresses($where: VaultFilters, $first: Int) {
    vaults(where: $where, first: $first) {
      items {
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
