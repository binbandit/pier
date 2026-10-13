// The dependencies fake repos use, with a short release history each (oldest first). Bots always
// propose the newest version, so the same (package, to-version) shows up across many repos while
// the from-version varies with how far behind each repo is.

export type CatalogEcosystem = "npm" | "github-actions" | "gomod" | "cargo" | "docker";

export type CatalogEntry = {
  ecosystem: CatalogEcosystem;
  name: string;
  /** Oldest first; the last one is what bots propose. */
  versions: string[];
  source: string;
  /** Lockfile-only dependencies (Dependabot calls them "indirect"). */
  indirect?: boolean;
  /** Every release runs an install script (not a new one). */
  installScript?: boolean;
};

type Row = [name: string, versions: string, source: string, flags?: "indirect" | "install"];

const NPM: Row[] = [
  ["lodash", "4.17.15 4.17.19 4.17.20 4.17.21", "lodash/lodash"],
  ["react", "18.2.0 18.3.1 19.0.0 19.1.0 19.1.1 19.2.0 19.2.1", "facebook/react"],
  ["react-dom", "18.2.0 18.3.1 19.0.0 19.1.0 19.1.1 19.2.0 19.2.1", "facebook/react"],
  ["typescript", "5.6.3 5.7.3 5.8.3 5.9.2 5.9.3", "microsoft/TypeScript"],
  ["eslint", "8.57.0 8.57.1 9.30.1 9.36.0 9.37.0", "eslint/eslint"],
  ["vite", "6.3.5 7.0.6 7.1.5 7.1.7 7.1.9", "vitejs/vite"],
  ["vitest", "3.0.9 3.1.4 3.2.3 3.2.4", "vitest-dev/vitest"],
  ["@types/node", "20.14.2 20.16.10 22.15.3 22.18.6 22.18.8", "DefinitelyTyped/DefinitelyTyped"],
  ["@types/react", "19.1.8 19.1.13 19.1.15 19.2.0 19.2.2", "DefinitelyTyped/DefinitelyTyped"],
  ["express", "4.19.2 4.21.1 4.21.2 5.0.1 5.1.0", "expressjs/express"],
  ["zod", "3.23.8 3.24.2 3.25.67 3.25.76 4.1.11 4.1.12", "colinhacks/zod"],
  ["axios", "1.7.7 1.8.4 1.10.0 1.11.0 1.12.2", "axios/axios"],
  ["prettier", "3.3.3 3.4.2 3.5.3 3.6.1 3.6.2", "prettier/prettier"],
  ["jest", "29.7.0 30.0.5 30.1.3 30.2.0", "jestjs/jest"],
  ["@babel/core", "7.26.0 7.27.4 7.28.0 7.28.3 7.28.4", "babel/babel"],
  ["webpack", "5.95.0 5.98.0 5.100.2 5.101.3 5.102.1", "webpack/webpack"],
  ["next", "14.2.15 15.3.4 15.4.7 15.5.3 15.5.4", "vercel/next.js"],
  ["tailwindcss", "3.4.14 4.0.17 4.1.11 4.1.13 4.1.14", "tailwindlabs/tailwindcss"],
  ["postcss", "8.4.47 8.5.3 8.5.4 8.5.6", "postcss/postcss"],
  ["semver", "7.6.3 7.7.1 7.7.2", "npm/node-semver"],
  ["dotenv", "16.4.5 16.4.7 16.5.0 16.6.1 17.2.3", "motdotla/dotenv"],
  ["uuid", "9.0.1 10.0.0 11.1.0 13.0.0", "uuidjs/uuid"],
  ["date-fns", "3.6.0 4.1.0", "date-fns/date-fns"],
  ["@tanstack/react-query", "5.59.0 5.81.5 5.89.0 5.90.2 5.90.3", "TanStack/query"],
  ["esbuild", "0.24.0 0.25.5 0.25.9 0.25.10", "evanw/esbuild", "install"],
  ["rollup", "4.24.0 4.44.1 4.50.2 4.52.3 4.52.4", "rollup/rollup"],
  ["glob", "10.4.5 11.0.0 11.0.3", "isaacs/node-glob"],
  ["chalk", "5.3.0 5.4.1 5.6.0 5.6.2", "chalk/chalk"],
  ["commander", "12.1.0 13.1.0 14.0.0 14.0.1", "tj/commander.js"],
  ["ws", "8.18.0 8.18.2 8.18.3", "websockets/ws"],
  ["pg", "8.13.0 8.14.1 8.16.0 8.16.3", "brianc/node-postgres"],
  ["winston", "3.15.0 3.17.0 3.18.3", "winstonjs/winston"],
  ["pino", "9.4.0 9.7.0 9.9.5 9.12.0", "pinojs/pino"],
  ["helmet", "7.1.0 8.0.0 8.1.0", "helmetjs/helmet"],
  ["jsonwebtoken", "9.0.0 9.0.1 9.0.2", "auth0/node-jsonwebtoken"],
  ["sharp", "0.33.5 0.34.2 0.34.3 0.34.4", "lovell/sharp", "install"],
  ["@playwright/test", "1.48.2 1.53.1 1.55.0 1.55.1 1.56.0", "microsoft/playwright"],
  ["msw", "2.4.9 2.10.2 2.11.2 2.11.3", "mswjs/msw"],
  ["@testing-library/react", "15.0.7 16.0.1 16.3.0", "testing-library/react-testing-library"],
  [
    "@typescript-eslint/parser",
    "8.8.1 8.35.0 8.44.0 8.45.0 8.46.0",
    "typescript-eslint/typescript-eslint",
  ],
  ["lint-staged", "15.2.10 16.1.2 16.2.3 16.2.4", "lint-staged/lint-staged"],
  ["turbo", "2.2.3 2.5.4 2.5.6 2.5.8", "vercel/turborepo"],
  ["@aws-sdk/client-s3", "3.668.0 3.840.0 3.896.0 3.906.0 3.908.0", "aws/aws-sdk-js-v3"],
  ["nodemon", "3.1.7 3.1.9 3.1.10", "remy/nodemon"],
  ["ioredis", "5.4.1 5.6.1 5.7.0 5.8.1", "redis/ioredis"],
  ["cross-spawn", "7.0.3 7.0.5 7.0.6", "moxystudio/node-cross-spawn", "indirect"],
  ["micromatch", "4.0.5 4.0.7 4.0.8", "micromatch/micromatch", "indirect"],
  ["braces", "3.0.2 3.0.3", "micromatch/braces", "indirect"],
  ["@babel/helpers", "7.25.6 7.26.10 7.28.4", "babel/babel", "indirect"],
];

const ACTIONS: Row[] = [
  ["actions/checkout", "4.1.7 4.2.0 4.2.2 5.0.0", "actions/checkout"],
  ["actions/setup-node", "4.0.4 4.1.0 4.4.0 5.0.0", "actions/setup-node"],
  ["actions/cache", "4.0.2 4.1.2 4.2.3 4.2.4 4.3.0", "actions/cache"],
  ["actions/upload-artifact", "4.4.3 4.6.0 4.6.2", "actions/upload-artifact"],
  ["docker/build-push-action", "6.9.0 6.15.0 6.18.0", "docker/build-push-action"],
  ["docker/login-action", "3.3.0 3.4.0 3.5.0 3.6.0", "docker/login-action"],
  ["github/codeql-action", "3.26.13 3.29.0 3.30.5 3.30.6", "github/codeql-action"],
  ["actions/setup-go", "5.0.2 5.4.0 5.5.0 6.0.0", "actions/setup-go"],
  ["pnpm/action-setup", "4.0.0 4.1.0 4.2.0", "pnpm/action-setup"],
];

const GO: Row[] = [
  ["github.com/stretchr/testify", "1.8.4 1.9.0 1.10.0 1.11.1", "stretchr/testify"],
  ["golang.org/x/net", "0.30.0 0.38.0 0.43.0 0.44.0 0.45.0", "golang/net"],
  ["golang.org/x/crypto", "0.28.0 0.36.0 0.41.0 0.42.0 0.43.0", "golang/crypto"],
  ["github.com/spf13/cobra", "1.8.1 1.9.1 1.10.1", "spf13/cobra"],
  ["google.golang.org/grpc", "1.67.1 1.73.0 1.75.1 1.76.0", "grpc/grpc-go"],
  [
    "github.com/prometheus/client_golang",
    "1.20.4 1.22.0 1.23.0 1.23.2",
    "prometheus/client_golang",
  ],
  ["github.com/jackc/pgx/v5", "5.7.1 5.7.5 5.7.6", "jackc/pgx"],
  ["go.uber.org/zap", "1.26.0 1.27.0", "uber-go/zap"],
];

const CARGO: Row[] = [
  ["serde", "1.0.210 1.0.219 1.0.226 1.0.228", "serde-rs/serde"],
  ["tokio", "1.40.0 1.45.1 1.47.1", "tokio-rs/tokio"],
  ["clap", "4.5.20 4.5.40 4.5.47 4.5.48", "clap-rs/clap"],
  ["anyhow", "1.0.89 1.0.98 1.0.99 1.0.100", "dtolnay/anyhow"],
  ["thiserror", "1.0.64 2.0.12 2.0.16 2.0.17", "dtolnay/thiserror"],
  ["reqwest", "0.12.8 0.12.20 0.12.23 0.12.24", "seanmonstar/reqwest"],
  ["serde_json", "1.0.128 1.0.140 1.0.143 1.0.145", "serde-rs/json"],
];

const DOCKER: Row[] = [
  ["node", "20.18.0-alpine 22.17.0-alpine 22.19.0-alpine 22.20.0-alpine", "nodejs/docker-node"],
  ["golang", "1.23.2-alpine 1.24.4-alpine 1.25.1-alpine 1.25.2-alpine", "docker-library/golang"],
  ["nginx", "1.27.2-alpine 1.29.0-alpine 1.29.1-alpine 1.29.2-alpine", "nginxinc/docker-nginx"],
  ["rust", "1.82.0-slim 1.88.0-slim 1.89.0-slim 1.90.0-slim", "rust-lang/docker-rust"],
];

function entries(ecosystem: CatalogEcosystem, rows: Row[]): CatalogEntry[] {
  return rows.map(([name, versions, source, flag]) => ({
    ecosystem,
    name,
    versions: versions.split(" "),
    source: `https://github.com/${source}`,
    ...(flag === "indirect" ? { indirect: true } : {}),
    ...(flag === "install" ? { installScript: true } : {}),
  }));
}

export const CATALOG: Record<CatalogEcosystem, CatalogEntry[]> = {
  npm: entries("npm", NPM),
  "github-actions": entries("github-actions", ACTIONS),
  gomod: entries("gomod", GO),
  cargo: entries("cargo", CARGO),
  docker: entries("docker", DOCKER),
};

/** Bumps that start an install script the previous release didn't have. */
export const NEW_INSTALL_SCRIPTS = new Set(["npm:turbo@2.5.8"]);

/** Made-up advisories against a few target versions, so the advisory gate has something to catch. */
export const ADVISORIES: Record<string, string[]> = {
  "npm:ws@8.18.3": ["GHSA-fq2m-7wpx-c9vh"],
  "cargo:reqwest@0.12.24": ["GHSA-x8hr-2cwv-q5mj"],
};
