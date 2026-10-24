import { describe, expect, it } from "vitest";
import { parseClient } from "./service";

describe("parseClient (x-client header of the mobile apps)", () => {
  it("accepts srikit app identifiers", () => {
    expect(parseClient("srikit-business/1.0.0 (android)")).toBe("srikit-business/1.0.0 (android)");
    expect(parseClient(" srikit-shops/2.3.4+15 (ios) ")).toBe("srikit-shops/2.3.4+15 (ios)");
    expect(parseClient(["srikit-business/1.0.0"])).toBe("srikit-business/1.0.0");
  });

  it("ignores browsers, other apps and junk, so web sessions keep the normal lifetime", () => {
    expect(parseClient(undefined)).toBeNull();
    expect(parseClient("Mozilla/5.0 (Linux; Android 14)")).toBeNull();
    expect(parseClient("other-app/1.0.0")).toBeNull();
    expect(parseClient("srikit-business/1.0.0 (windows)")).toBeNull();
    expect(parseClient(`srikit-business/1.0.0-${"x".repeat(90)}`)).toBeNull();
  });
});
