/** Liveness check for the load balancer / uptime monitor (docs/ops.md). Never touches the API or the database. */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { ok: true, app: "seller", sha: process.env.GIT_SHA ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
