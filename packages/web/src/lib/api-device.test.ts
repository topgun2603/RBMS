import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, authHeaders, authToken, setDeviceToken, setSessionOverride } from "./api";

/** Paired POS terminals (docs/pos-terminals.md): x-device-token on every call, the PIN session instead of the sign-in. */
describe("api() on a paired POS terminal", () => {
  afterEach(() => {
    setDeviceToken(null);
    setSessionOverride(null);
    vi.unstubAllGlobals();
  });

  const stubFetch = (status: number, body: unknown) => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };
  const headersOf = (fetch: ReturnType<typeof stubFetch>) => new Headers(fetch.mock.calls[0]![1].headers);

  it("sends x-device-token and the override bearer; anonymous calls keep the device token but no bearer", async () => {
    const fetch = stubFetch(200, { ok: true });
    setDeviceToken("dev-1");
    setSessionOverride({ token: "pin-1" });
    await api.get("/pos/staff");
    expect(headersOf(fetch).get("x-device-token")).toBe("dev-1");
    expect(headersOf(fetch).get("authorization")).toBe("Bearer pin-1");
    expect(authToken()).toBe("pin-1");
    fetch.mockClear();
    await api.post("/pos/pair", {}, { anonymous: true });
    expect(headersOf(fetch).get("authorization")).toBeNull();
    expect(headersOf(fetch).get("x-device-token")).toBe("dev-1");
  });

  it("a locked terminal sends no bearer; 401s go to the terminal, not the sign-out redirect", async () => {
    stubFetch(401, { error: { code: "device_not_paired", message: "no" } });
    const onUnauthorized = vi.fn();
    setDeviceToken("dev-1");
    setSessionOverride({ token: null, onUnauthorized });
    await expect(api.get("/pos/device")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onUnauthorized.mock.calls[0]![0]).toMatchObject({ status: 401, code: "device_not_paired" });
    expect(authHeaders().get("authorization")).toBeNull();
    expect(authHeaders().get("x-device-token")).toBe("dev-1");
  });

  it("without terminal mode nothing extra is sent", async () => {
    const fetch = stubFetch(200, {});
    await api.get("/features");
    expect(headersOf(fetch).has("x-device-token")).toBe(false);
  });
});
