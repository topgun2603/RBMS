import { describe, expect, it } from "vitest";
import { BRANDING_BOOT_ID, BRANDING_BOOT_SCRIPT, BRANDING_CACHE_PREFIX } from "./branding-boot";

/** Runs the inline script against a fake page and returns the <style> text it added (or null). */
function boot(hostname: string, store: Record<string, string>, opts: { throwOnStorage?: boolean } = {}) {
  const added: { id: string; textContent: string }[] = [];
  const document = {
    getElementById: (id: string) => added.find((e) => e.id === id) ?? null,
    createElement: () => ({ id: "", textContent: "" }),
    head: { appendChild: (e: { id: string; textContent: string }) => added.push(e) },
  };
  const localStorage = {
    getItem: (k: string) => {
      if (opts.throwOnStorage) throw new Error("blocked");
      return store[k] ?? null;
    },
  };
  new Function("location", "localStorage", "document", BRANDING_BOOT_SCRIPT)({ hostname }, localStorage, document);
  return added.length ? { id: added[0]!.id, css: added[0]!.textContent, count: added.length } : null;
}

const css = ":root{--primary:oklch(0.5 0.2 30)}";

describe("branding boot script", () => {
  it("applies the cached CSS of the subdomain's shop", () => {
    expect(boot("raja.localhost", { [`${BRANDING_CACHE_PREFIX}raja`]: css })).toEqual({ id: BRANDING_BOOT_ID, css, count: 1 });
    expect(boot("raja.rbms.in", { [`${BRANDING_CACHE_PREFIX}raja`]: css })?.css).toBe(css);
  });

  it("never applies another shop's colours", () => {
    expect(boot("anbu.localhost", { [`${BRANDING_CACHE_PREFIX}raja`]: css, sr_tenant: "raja" })).toBeNull();
  });

  it("uses the stored shop on a bare host or IP", () => {
    expect(boot("localhost", { [`${BRANDING_CACHE_PREFIX}raja`]: css, sr_tenant: "raja" })?.css).toBe(css);
    expect(boot("192.168.1.20", { [`${BRANDING_CACHE_PREFIX}raja`]: css, sr_tenant: "raja" })?.css).toBe(css);
    expect(boot("localhost", {})).toBeNull();
  });

  it("does nothing without a cache, and survives blocked storage", () => {
    expect(boot("raja.localhost", {})).toBeNull();
    expect(boot("raja.localhost", {}, { throwOnStorage: true })).toBeNull();
  });
});
