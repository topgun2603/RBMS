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
