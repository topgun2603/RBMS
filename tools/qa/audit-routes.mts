// Prints the pages an app's modules declare, as JSON. Run by audit.mjs from inside the app's folder.
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { webApp } = await import(pathToFileURL(join(process.cwd(), "src", "web-app.ts")).href);
const routes: unknown[] = [];
for (const m of webApp.modules) {
  for (const r of m.routes ?? []) routes.push({ module: m.id, base: m.basePath, path: r.path, feature: r.feature ?? m.features ?? null });
  for (const r of m.publicRoutes ?? []) routes.push({ module: m.id, base: m.basePath, path: r.path, public: true });
}
console.log(`@@${JSON.stringify(routes)}`);
process.exit(0);
