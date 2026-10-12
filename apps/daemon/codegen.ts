import type { CodegenConfig } from "@graphql-codegen/cli";

// Typed GraphQL documents against GitHub's published schema (pinned in schema/github.graphql;
// refresh with `bun run schema`). Documents are written inline with `graphql(...)` in src/.
const config: CodegenConfig = {
  schema: "schema/github.graphql",
  documents: ["src/**/*.ts", "!src/github/gql/**"],
  ignoreNoDocuments: true,
  generates: {
    "src/github/gql/": {
      preset: "client",
      config: {
        documentMode: "string",
        useTypeImports: true,
        enumsAsTypes: true,
        avoidOptionals: false,
        skipTypename: false,
        strictScalars: true,
        scalars: {
          Base64String: "string",
          BigInt: "string",
          CustomPropertyValue: "string | string[]",
          Date: "string",
          DateTime: "string",
          GitObjectID: "string",
          GitRefname: "string",
          GitSSHRemote: "string",
          GitTimestamp: "string",
          HTML: "string",
          PreciseDateTime: "string",
          URI: "string",
          X509Certificate: "string",
        },
      },
      presetConfig: { fragmentMasking: false },
    },
  },
};

export default config;
