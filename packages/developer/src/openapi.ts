import type { FastifyInstance, RouteOptions } from "fastify";
import "./fastify";

export interface CollectedRoute {
  method: string;
  /** Full Fastify URL, e.g. "/v1/invoices/:id([0-9a-fA-F-]{36})". */
  url: string;
  /** Plugin prefix, e.g. "/v1/invoices". */
  prefix: string;
  feature: string[];
  permission: string[];
  summary: string | null;
  apiKey: boolean;
}

const toList = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? [...v] : [v]);

/**
 * Captures every registered route through Fastify's `onRoute` hook. The host calls `routeCollector.register(app)`
 * BEFORE registering modules (after `routeRules.register`, so host-attached `config.permission` is seen too — config is
 * read lazily when the document is built) and passes `routeCollector` to `createDeveloper({ routes })`.
 */
export function createRouteCollector() {
  const seen: Array<{ method: string; url: string; prefix: string; opts: RouteOptions }> = [];
  return {
    register(app: FastifyInstance) {
      app.addHook("onRoute", (r) => {
        const methods = Array.isArray(r.method) ? r.method : [r.method];
        const prefix = (r as RouteOptions & { prefix?: string }).prefix ?? "";
        for (const m of methods) seen.push({ method: String(m).toUpperCase(), url: r.url, prefix, opts: r });
      });
    },
    routes(): CollectedRoute[] {
      return seen.map(({ method, url, prefix, opts }) => ({
        method,
        url,
        prefix,
        feature: toList(opts.config?.feature),
        permission: toList(opts.config?.permission),
        summary: opts.config?.summary ?? null,
        apiKey: opts.config?.apiKey !== false,
      }));
    },
  };
}
export type RouteCollector = ReturnType<typeof createRouteCollector>;

/** `/v1/invoices/:id([0-9a-f-]{36})/pay/*` → path `/v1/invoices/{id}/pay/{wildcard}` + its parameter names. */
export function toOpenApiPath(url: string): { path: string; params: string[] } {
  const params: string[] = [];
  const segs = url.split("/").map((seg) => {
    if (seg === "*") {
      params.push("wildcard");
      return "{wildcard}";
    }
    // A segment may hold several params (`:from-:to`); strip regex parts in parentheses.
    return seg.replace(/:([A-Za-z0-9_]+)(\((?:[^()]|\([^()]*\))*\))?/g, (_m, name: string) => {
      params.push(name);
      return `{${name}}`;
    });
  });
  let path = segs.join("/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return { path: path || "/", params };
}

/** Module id from the `/v1/<id>` prefix (or URL), e.g. "invoices"; "other" when there is none. */
export function moduleOf(r: Pick<CollectedRoute, "prefix" | "url">): string {
  const m = /^\/v1\/([^/]+)/.exec(r.prefix || r.url);
  return m ? m[1]! : "other";
}

const PUBLIC_RE = /\/(public|webhooks|share|s)\//;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export interface OpenApiOptions {
  title?: string;
  version?: string;
  description?: string;
  serverUrl?: string;
  /** URL prefixes to leave out (e.g. super-admin routes). `/v1/` routes are listed otherwise. */
  hidePrefixes?: string[];
  /** Short module descriptions for the tags. */
  moduleDescriptions?: Record<string, string>;
}

/**
 * OpenAPI 3.1 summary of the registered routes: one operation per method + path, tags = module, bearer auth (API key
 * or session token), `x-feature` / `x-permission` / `x-api-key` extensions. No request/response schemas.
 */
export function buildOpenApi(routes: readonly CollectedRoute[], opts: OpenApiOptions = {}) {
  const paths: Record<string, Record<string, unknown>> = {};
  const tags = new Set<string>();
  const hide = opts.hidePrefixes ?? [];
  const sorted = [...routes]
    .filter((r) => METHODS.has(r.method) && r.url.startsWith("/v1/") && !hide.some((p) => r.url.startsWith(p)))
    .sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));
  const opIds = new Set<string>();

  for (const r of sorted) {
    const { path, params } = toOpenApiPath(r.url);
    const tag = moduleOf(r);
    tags.add(tag);
    const method = r.method.toLowerCase();
    let opId = `${method}_${path.replace(/^\/v1\//, "").replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/_+$/, "")}`;
    while (opIds.has(opId)) opId += "_";
    opIds.add(opId);
    const isPublic = PUBLIC_RE.test(path + "/") || path.endsWith("/openapi.json");
    const op: Record<string, unknown> = {
      operationId: opId,
      tags: [tag],
      summary: r.summary ?? `${r.method} ${path}`,
      parameters: params.map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
      responses: { "200": { description: "OK" }, default: { description: "Error `{ error: { code, message, details } }`" } },
    };
    if (isPublic) op.security = [];
    if (r.feature.length) op["x-feature"] = r.feature;
    if (r.permission.length) op["x-permission"] = r.permission;
    if (!r.apiKey) op["x-api-key"] = false;
    if (["post", "put", "patch"].includes(method))
      op.requestBody = { required: false, content: { "application/json": { schema: { type: "object" } } } };
    (paths[path] ??= {})[method] = op;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: opts.title ?? "Srikit API",
      version: opts.version ?? "1.0.0",
      description:
        opts.description ??
        "Authenticate with `Authorization: Bearer sk_live_…` (an API key from Settings → Developer). Money is in paise. " +
          "Lists return `{ items, total }`. `x-permission` names the API key scope an operation needs.",
    },
    ...(opts.serverUrl ? { servers: [{ url: opts.serverUrl }] } : {}),
    tags: [...tags].sort().map((name) => ({ name, ...(opts.moduleDescriptions?.[name] ? { description: opts.moduleDescriptions[name] } : {}) })),
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "API key (`sk_live_…`) or session token" } },
    },
    security: [{ bearerAuth: [] }],
    paths,
  };
}
export type OpenApiDocument = ReturnType<typeof buildOpenApi>;
