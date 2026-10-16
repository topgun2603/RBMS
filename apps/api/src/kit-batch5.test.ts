import { describe, expect, it } from "vitest";
import { appUrlFor } from "./kit-batch5";

describe("appUrlFor", () => {
  const setting = "BL=http://{slug}.localhost:3001,EC=http://{slug}.localhost:3002/";
  it("picks the app's template and fills the slug", () => {
    expect(appUrlFor(setting, "BL", "anbu")).toBe("http://anbu.localhost:3001");
    expect(appUrlFor(setting, "EC", "anbu")).toBe("http://anbu.localhost:3002");
  });
  it("falls back to the first entry, or a single template", () => {
    expect(appUrlFor(setting, null, "x-shop")).toBe("http://x-shop.localhost:3001");
    expect(appUrlFor("https://{slug}.srikit.in", "EC", "anbu")).toBe("https://anbu.srikit.in");
  });
});
