import { describe, expect, it } from "vitest";
import { DEFAULT_ALLOWED_TYPES, buildKey, extFor, isAllowedType, sanitizeFilename, thumbKeyFor, withExtension } from "./keys";
import { isValidKey } from "./storage/local";

describe("sanitizeFilename", () => {
  it("keeps safe names", () => {
    expect(sanitizeFilename("invoice-2026_01.pdf")).toBe("invoice-2026_01.pdf");
  });

  it("replaces unsafe characters and strips paths", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\me\\My Photo (1).JPG")).toBe("My-Photo-1-.JPG".replace("-.", "."));
    expect(sanitizeFilename("Café résumé.pdf")).toBe("Cafe-resume.pdf");
  });

  it("falls back to 'file' for names without ASCII", () => {
    expect(sanitizeFilename("புகைப்படம்.jpg")).toBe("file.jpg");
    expect(sanitizeFilename("...")).toBe("file");
    expect(sanitizeFilename(".env")).toBe("env");
  });

  it("limits length but keeps the extension", () => {
    const out = sanitizeFilename(`${"a".repeat(300)}.png`);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith(".png")).toBe(true);
  });

  it("always yields a valid storage key segment", () => {
    for (const n of ["a..b", "-x-", "x/../y", "  spaced  name .txt", "a.b.c.tar.gz", "émoji 😀.png"]) {
      expect(isValidKey(`t/x/${sanitizeFilename(n)}`)).toBe(true);
    }
  });
});

describe("buildKey", () => {
  const now = new Date("2026-03-05T10:00:00Z");
  it("builds tenant keys", () => {
    expect(buildKey({ tenantId: "ten-1", purpose: "avatar", filename: "Me.png", id: "abc", now })).toBe(
      "t/ten-1/avatar/2026/03/abc-Me.png",
    );
  });

  it("uses platform and misc defaults and rejects odd purposes", () => {
    expect(buildKey({ tenantId: null, filename: "a.pdf", id: "id1", now })).toBe("t/platform/misc/2026/03/id1-a.pdf");
    expect(buildKey({ tenantId: "t", purpose: "../x", filename: "a.pdf", id: "id1", now })).toBe("t/t/misc/2026/03/id1-a.pdf");
  });

  it("produces valid keys and thumb keys", () => {
    const key = buildKey({ tenantId: "8a1c", purpose: "product", filename: "../../x y.JPG", id: crypto.randomUUID() });
    expect(isValidKey(key)).toBe(true);
    expect(isValidKey(thumbKeyFor(key))).toBe(true);
  });
});

describe("isAllowedType", () => {
  it("matches exact types and wildcards, ignoring case and parameters", () => {
    expect(isAllowedType("image/png", ["image/*"])).toBe(true);
    expect(isAllowedType("IMAGE/JPEG; charset=binary", ["image/jpeg"])).toBe(true);
    expect(isAllowedType("application/pdf", ["image/*"])).toBe(false);
    expect(isAllowedType("anything/x", ["*/*"])).toBe(true);
  });

  it("rejects malformed types", () => {
    expect(isAllowedType("image", ["image/*"])).toBe(false);
    expect(isAllowedType("image/png\r\nx: y", ["image/*"])).toBe(false);
  });

  it("default list covers images, pdf, csv, xlsx, mp4, mp3 but not svg", () => {
    for (const t of [
      "image/jpeg",
      "application/pdf",
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "video/mp4",
      "audio/mpeg",
    ]) {
      expect(isAllowedType(t, DEFAULT_ALLOWED_TYPES)).toBe(true);
    }
    expect(isAllowedType("image/svg+xml", DEFAULT_ALLOWED_TYPES)).toBe(false);
    expect(isAllowedType("text/html", DEFAULT_ALLOWED_TYPES)).toBe(false);
  });
});

describe("extFor / withExtension", () => {
  it("maps known types", () => {
    expect(extFor("image/jpeg")).toBe("jpg");
    expect(extFor("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("xlsx");
    expect(extFor("audio/mpeg")).toBe("mp3");
    expect(extFor("x/unknown")).toBeUndefined();
  });

  it("adds an extension only when missing", () => {
    expect(withExtension("photo", "image/png")).toBe("photo.png");
    expect(withExtension("photo.jpeg", "image/png")).toBe("photo.jpeg");
  });
});
