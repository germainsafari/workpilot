import vinext from "vinext";
import { defineConfig } from "vite";
import { resolve } from "node:path";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const { d1, r2 } = hostingConfig;

// Real D1 id from `wrangler d1 create workpilot`. Omit to deploy without D1 (AWS API mode).
const d1DatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim();

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases:
    d1 && d1DatabaseId
      ? [
          {
            binding: d1,
            database_name: "workpilot",
            database_id: d1DatabaseId,
          },
        ]
      : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const dockerProduction = process.env.WORKPILOT_DOCKER_BUILD === "true";
  // The local Docker image talks to FastAPI and runs under Node. Loading the
  // Cloudflare plugin there would leave `cloudflare:` imports in the production
  // bundle, which Node cannot execute.
  const cloudflarePlugins = dockerProduction
    ? []
    : [
        (
          await import("@cloudflare/vite-plugin")
        ).cloudflare({
          viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
          config: localBindingConfig,
        }),
      ];

  return {
    // RSC, SSR, and the browser optimizer must all share one React singleton.
    // Without this, a dev-server dependency refresh can leave a client chunk
    // calling hooks against a different dispatcher (`useState` on null).
    resolve: {
      dedupe: ["react", "react-dom", "react-server-dom-webpack"],
      alias: dockerProduction
        ? {
            "cloudflare:workers": resolve(
              process.cwd(),
              "db/cloudflare-workers-node.ts",
            ),
          }
        : undefined,
    },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      ...cloudflarePlugins,
    ],
  };
});
