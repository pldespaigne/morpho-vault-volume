import { GraphQLClient } from "graphql-request";

import { env } from "@/lib/env";

export const client = new GraphQLClient(env.MORPHO_API_URL);
