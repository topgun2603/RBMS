import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { routePermissions } from "./permissions";

async function build(map: Record<string, string | string[]>, guards: Record<string, () => Promise<void>> = {}) {
  const rules = routePermissions(map, guards);
  const app = Fastify();
  rules.register(app);
  await app.register(
    async (s) => {
      s.post("/", { config: { feature: "x" } }, async (req) => ({ permission: req.routeOptions.config.permission ?? null }));
      s.get("/:id([0-9]+)", async (req) => ({ permission: req.routeOptions.config.permission ?? null }));
      s.post("/:id([0-9]+)/cancel", { config: { permission: "x.own" } }, async (req) => ({ permission: req.routeOptions.config.permission }));
    },
    { prefix: "/v1/x" },
  );
  return { app, rules };
}

describe("routePermissions", () => {
  it("annotates both slash forms of a prefixed root route, merges with the route's own and keeps feature", async () => {
    const { app, rules } = await build({ "POST /v1/x/": "x.create", "POST /v1/x/:id([0-9]+)/cancel": ["x.cancel"] });
    rules.assertAllMatched();
    for (const url of ["/v1/x", "/v1/x/"]) {
      expect((await app.inject({ method: "POST", url })).json()).toEqual({ permission: ["x.create"] });
    }
    expect((await app.inject({ method: "POST", url: "/v1/x/1/cancel" })).json()).toEqual({ permission: ["x.own", "x.cancel"] });
    expect((await app.inject({ url: "/v1/x/1" })).json()).toEqual({ permission: null });
  });

  it("adds guards as route preHandlers", async () => {
    let calls = 0;
    const { app } = await build({}, { "POST /v1/x": async () => void calls++ });
    await app.inject({ method: "POST", url: "/v1/x" });
    expect(calls).toBe(1);
  });

  it("refuses rules for routes that don't exist", async () => {
    const { rules } = await build({ "POST /v1/x/": "x.create", "DELETE /v1/x/:id": "x.delete" });
    expect(() => rules.assertAllMatched()).toThrow("DELETE /v1/x/:id");
  });
});

describe("guest ticket limits", () => {
  it("WindowLimiter allows `limit` hits per window, then refuses until the window moves on", async () => {
    const { WindowLimiter } = await import("./permissions");
    let now = 0;
    const l = new WindowLimiter(2, 1000, () => now);
    expect([l.hit("a"), l.hit("a"), l.hit("a"), l.hit("b")]).toEqual([true, true, false, true]);
    now = 1001;
    expect(l.hit("a")).toBe(true);
  });

  it("guestTicketGuard: 5 per verified phone, unverifiable tokens and signed-in users not counted", async () => {
    const { guestTicketGuard } = await import("./permissions");
    const guard = guestTicketGuard((_t, token) => (token === "good" ? { phone: "+919999000001" } : null), { perPhone: 5, perIp: 20, windowMs: 3_600_000 });
    const req = (token: string | undefined, user: unknown = null, ip = "10.0.0.1") =>
      ({ headers: token ? { "x-guest-token": token } : {}, ctx: { user, tenant: { id: "t1" }, ip } }) as never;
    for (let i = 0; i < 10; i++) await guard(req("bad"));
    for (let i = 0; i < 5; i++) await guard(req("good"));
    await expect(guard(req("good"))).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    await guard(req("good", { id: "u1" })); // signed in: not limited here
  });

  it("guestTicketGuard: 20 per IP across phones", async () => {
    const { guestTicketGuard } = await import("./permissions");
    let n = 0;
    const guard = guestTicketGuard((_t, token) => ({ phone: token }), { perPhone: 5, perIp: 20, windowMs: 3_600_000 });
    const req = () => ({ headers: { "x-guest-token": `+91999900${String(n++).padStart(4, "0")}` }, ctx: { user: null, tenant: { id: "t1" }, ip: "10.0.0.2" } }) as never;
    for (let i = 0; i < 20; i++) await guard(req());
    await expect(guard(req())).rejects.toMatchObject({ status: 429 });
  });
});
