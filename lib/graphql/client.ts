import { GraphQLClient } from "graphql-request";

import { env } from "../env";

export const client = new GraphQLClient(env.MORPHO_API_URL);
