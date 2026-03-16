import { fetchVaultTransactions } from "@/inngest/functions/fetch-vault-transactions";
import { aggregateMonthlyNetFlows } from "@/inngest/functions/aggregate-monthly-net-flows";

export const allFunctions = [fetchVaultTransactions, aggregateMonthlyNetFlows];
