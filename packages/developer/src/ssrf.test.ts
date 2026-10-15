import { describe, expect, it } from "vitest";
import { checkWebhookUrl, isPrivateAddress } from "./ssrf";

const prod = (addrs: Record<string, string[]> = {}) => ({
  allowHttp: false,
  allowPrivate: false,
  resolve: async (h: string) => {
    if (!(h in addrs)) throw new Error("ENOTFOUND");
    return addrs[h]!;
  },
});
const dev = { allowHttp: true, allowPrivate: true };

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "13.235.1.2", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2404:6800:4007:80f::200e"])(
    "allows %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe("checkWebhookUrl", () => {
  it("allows public https hosts in production", async () => {
    const r = await checkWebhookUrl("https://hooks.example.com/srikit", prod({ "hooks.example.com": ["93.184.216.34"] }));
    expect(r.ok).toBe(true);
    expect((await checkWebhookUrl("https://8.8.8.8/x", prod())).ok).toBe(true);
  });

  it("refuses http, credentials, odd ports and bad URLs in production", async () => {
    const p = prod({ "hooks.example.com": ["93.184.216.34"] });
    for (const u of ["http://hooks.example.com/x", "https://u:p@hooks.example.com/", "https://hooks.example.com:22/", "not a url", "ftp://hooks.example.com"])
      expect((await checkWebhookUrl(u, p)).ok, u).toBe(false);
  });

  it("refuses localhost, internal names, private IPs and hosts resolving to them (SSRF)", async () => {
    const p = prod({ "evil.example.com": ["93.184.216.34", "10.0.0.5"], "meta.example.com": ["169.254.169.254"] });
    for (const u of [
      "https://localhost/x",
      "https://api.localhost/x",
      "https://printer.local/",
      "https://db.internal/",
      "https://intranet/",
      "https://127.0.0.1/",
      "https://[::1]/",
      "https://192.168.0.10/",
      "https://evil.example.com/",
      "https://meta.example.com/",
      "https://unknown.example.com/",
    ]) {
      const r = await checkWebhookUrl(u, p);
      expect(r.ok, u).toBe(false);
    }
  });

  it("allows http and localhost in development", async () => {
    expect((await checkWebhookUrl("http://localhost:4000/hook", dev)).ok).toBe(true);
    expect((await checkWebhookUrl("http://192.168.1.5:8080/hook", dev)).ok).toBe(true);
    expect((await checkWebhookUrl("ftp://localhost/", dev)).ok).toBe(false);
  });
});
