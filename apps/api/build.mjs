// Production bundle of the API (docs/deploy-aws.md): esbuild compiles src/ and the workspace packages it imports
// (they ship TypeScript source) into dist/*.mjs. Every third-party package stays external and is loaded from
// node_modules at runtime (native modules such as sharp, pino's worker transports, puppeteer-core).
// Development keeps running the source with tsx; nothing here is used by `pnpm dev` or `pnpm start`.
//
//   node build.mjs        → dist/main.mjs, dist/migrate.mjs, dist/seed.mjs, dist/run-job.mjs
import { rm } from "node:fs/promises";
import { build } from "esbuild";

const entryPoints = {
  main: "src/main.ts",
  migrate: "src/migrate.ts",
  seed: "src/seed.ts",
  "run-job": "src/scripts/run-job.ts",
};

/** Bundle our own @srirealtime/* packages; leave every other bare import to node_modules. */
const externalThirdParty = {
  name: "external-third-party",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("@srirealtime/")) return undefined;
      return { path: args.path, external: true };
    });
  },
};

await rm("dist", { recursive: true, force: true });
const result = await build({
  entryPoints,
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: "linked",
  legalComments: "none",
  logLevel: "info",
  metafile: true,
  plugins: [externalThirdParty],
});
const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`api bundle: ${Object.keys(entryPoints).length} entry points, ${(bytes / 1024 / 1024).toFixed(1)} MiB in dist/`);
