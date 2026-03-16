import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "https://api.morpho.org/graphql",
  documents: ["src/**/*.ts", "index.ts"],
  ignoreNoDocuments: true,
  emitLegacyCommonJSImports: false,
  generates: {
    "./src/graphql/generated/": {
      preset: "client",
      config: {
        documentMode: "string",
        useTypeImports: true,
        scalars: {
          BigInt: "number",
          Address: "`0x${string}`",
          HexString: "`0x${string}`",
          MarketId: "`0x${string}`",
        },
      },
    },
  },
};

export default config;
