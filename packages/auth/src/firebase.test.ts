import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { cachedKeySource, createFirebaseVerifier, FirebaseTokenError, googleSecureTokenKeys, maxAgeFrom, type FirebaseKeySource } from "./firebase";

const PROJECT = "srikit-test";
const NOW = Date.parse("2026-10-17T06:00:00Z");
const nowSec = Math.floor(NOW / 1000);

const pair = () => generateKeyPairSync("rsa", { modulusLength: 2048 });
const good = pair();
const other = pair();
const spki = (k: KeyObject) => k.export({ type: "spki", format: "pem" }).toString();

const keySource = (keys: Record<string, KeyObject> = { k1: good.publicKey }): FirebaseKeySource =>
  vi.fn(async () => ({ keys: Object.fromEntries(Object.entries(keys).map(([kid, k]) => [kid, spki(k)])), maxAgeSeconds: 3600 }));

interface TokenOpts {
  kid?: string;
  key?: KeyObject;
  alg?: string;
  claims?: Record<string, unknown>;
  drop?: string[];
}

async function token(o: TokenOpts = {}) {
  const claims: Record<string, unknown> = {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: "firebase-uid-1",
    iat: nowSec - 30,
    exp: nowSec + 3570,
    auth_time: nowSec - 30,
    phone_number: "+919876543210",
    firebase: { sign_in_provider: "phone", identities: { phone: ["+919876543210"] } },
    ...o.claims,
  };
  for (const k of o.drop ?? []) delete claims[k];
  return new SignJWT(claims).setProtectedHeader({ alg: o.alg ?? "RS256", kid: o.kid ?? "k1", typ: "JWT" }).sign(o.key ?? good.privateKey);
}

const verifier = (source = keySource(), now = () => NOW) => createFirebaseVerifier({ projectId: PROJECT, keySource: source, now });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(FirebaseTokenError);
    return (err as FirebaseTokenError).code;
  }
  throw new Error("expected a rejection");
}

describe("Firebase ID token verifier", () => {
  it("accepts a valid phone sign-in token and returns the verified phone", async () => {
    await expect(verifier()(await token())).resolves.toEqual({ uid: "firebase-uid-1", provider: "phone", phone: "+919876543210", authTime: nowSec - 30 });
  });

  it("rejects the wrong audience or issuer as a different project", async () => {
    const v = verifier();
    expect(await codeOf(v(await token({ claims: { aud: "someone-else" } })))).toBe("firebase_wrong_project");
    expect(await codeOf(v(await token({ claims: { iss: "https://securetoken.google.com/someone-else" } })))).toBe("firebase_wrong_project");
    expect(await codeOf(v(await token({ claims: { iss: "https://accounts.google.com" } })))).toBe("firebase_wrong_project");
  });

  it("rejects expired tokens, allowing a small clock skew", async () => {
    const v = verifier();
    expect(await codeOf(v(await token({ claims: { exp: nowSec - 120 } })))).toBe("firebase_token_expired");
    await expect(v(await token({ claims: { exp: nowSec - 30 } }))).resolves.toMatchObject({ phone: "+919876543210" });
  });

  it("rejects iat / auth_time in the future and sign-ins that are too old", async () => {
    const v = verifier();
    expect(await codeOf(v(await token({ claims: { iat: nowSec + 600 } })))).toBe("firebase_token_invalid");
    expect(await codeOf(v(await token({ claims: { auth_time: nowSec + 600 } })))).toBe("firebase_token_invalid");
    expect(await codeOf(v(await token({ drop: ["auth_time"] })))).toBe("firebase_token_invalid");
    expect(await codeOf(v(await token({ claims: { auth_time: nowSec - 3600 } })))).toBe("firebase_token_stale");
  });

  it("requires a subject", async () => {
    const v = verifier();
    expect(await codeOf(v(await token({ claims: { sub: "" } })))).toBe("firebase_token_invalid");
    expect(await codeOf(v(await token({ drop: ["sub"] })))).toBe("firebase_token_invalid");
  });

  it("accepts only phone sign-ins with a phone number", async () => {
    const v = verifier();
    expect(await codeOf(v(await token({ claims: { firebase: { sign_in_provider: "facebook.com" } } })))).toBe("firebase_not_phone");
    expect(await codeOf(v(await token({ drop: ["firebase"] })))).toBe("firebase_not_phone");
    expect(await codeOf(v(await token({ drop: ["phone_number"] })))).toBe("firebase_no_phone");
    expect(await codeOf(v(await token({ claims: { phone_number: "9876543210" } })))).toBe("firebase_no_phone");
  });

  it("accepts a Google sign-in with a verified email, and nothing else from Google", async () => {
    const v = verifier();
    const google = (claims: Record<string, unknown> = {}, drop: string[] = ["phone_number"]) =>
      token({
        drop,
        claims: {
          email: "Kavya@Example.com",
          email_verified: true,
          name: "Kavya R",
          picture: "https://lh3.example/a.png",
          firebase: { sign_in_provider: "google.com", identities: { "google.com": ["1098765"], email: ["kavya@example.com"] } },
          ...claims,
        },
      });
    await expect(v(await google())).resolves.toEqual({
      uid: "firebase-uid-1",
      provider: "google.com",
      phone: "",
      email: "kavya@example.com",
      name: "Kavya R",
      picture: "https://lh3.example/a.png",
      googleSub: "1098765",
      authTime: nowSec - 30,
    });
    expect(await codeOf(v(await google({ email_verified: false })))).toBe("firebase_no_email");
    expect(await codeOf(v(await google({ email_verified: "true" })))).toBe("firebase_no_email");
    expect(await codeOf(v(await google({}, ["phone_number", "email"])))).toBe("firebase_no_email");
    expect(await codeOf(v(await google({}, ["phone_number", "email_verified"])))).toBe("firebase_no_email");
    expect(await codeOf(v(await google({ firebase: { sign_in_provider: "facebook.com" } })))).toBe("firebase_not_phone");
  });

  it("accepts email + password only with a verified email", async () => {
    const v = verifier();
    const pw = (claims: Record<string, unknown> = {}, drop: string[] = ["phone_number"]) =>
      token({ drop, claims: { sub: "pw-uid-1", email: "Owner@Example.com", email_verified: true, firebase: { sign_in_provider: "password", identities: { email: ["owner@example.com"] } }, ...claims } });
    await expect(v(await pw())).resolves.toEqual({ uid: "pw-uid-1", provider: "password", phone: "", email: "owner@example.com", authTime: nowSec - 30 });
    expect(await codeOf(v(await pw({ email_verified: false })))).toBe("firebase_email_unverified");
    expect(await codeOf(v(await pw({ email_verified: "true" })))).toBe("firebase_email_unverified");
    expect(await codeOf(v(await pw({}, ["phone_number", "email_verified"])))).toBe("firebase_email_unverified");
    expect(await codeOf(v(await pw({}, ["phone_number", "email"])))).toBe("firebase_no_email");
    expect(await codeOf(v(await pw({ email: "no-at-sign" })))).toBe("firebase_no_email");
  });

  it("rejects a bad signature and an unknown key id", async () => {
    const v = verifier();
    expect(await codeOf(v(await token({ key: other.privateKey })))).toBe("firebase_bad_signature");
    expect(await codeOf(v(await token({ kid: "nope" })))).toBe("firebase_unknown_key");
    const t = await token();
    const [h, p, s] = t.split(".");
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, "base64url").toString()), phone_number: "+919000000000" })).toString("base64url")}.${s}`;
    expect(await codeOf(v(tampered))).toBe("firebase_bad_signature");
  });

  it("rejects malformed tokens and other algorithms", async () => {
    const v = verifier();
    expect(await codeOf(v("not-a-jwt"))).toBe("firebase_token_invalid");
    expect(await codeOf(v("a.b.c"))).toBe("firebase_token_invalid");
    const hs = await new SignJWT({ sub: "x" }).setProtectedHeader({ alg: "HS256", kid: "k1" }).sign(new Uint8Array(32));
    expect(await codeOf(v(hs))).toBe("firebase_token_invalid");
  });

  it("reports unavailable keys separately", async () => {
    const v = verifier(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await codeOf(v(await token()))).toBe("firebase_keys_unavailable");
  });

  it("never puts the token in the error message", async () => {
    const t = await token({ key: other.privateKey });
    const err = await verifier()(t).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain(t.slice(0, 20));
  });
});

describe("Firebase key cache", () => {
  it("fetches once within max-age and refetches after it", async () => {
    let now = NOW;
    const source = keySource();
    const keyFor = cachedKeySource(source, () => now);
    expect(await keyFor("k1")).not.toBeNull();
    expect(await keyFor("k1")).not.toBeNull();
    expect(source).toHaveBeenCalledTimes(1);
    now += 3601_000;
    await keyFor("k1");
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("refetches early for an unknown kid, at most once a minute", async () => {
    let now = NOW;
    let keys: Record<string, KeyObject> = { k1: good.publicKey };
    const source = vi.fn(async () => ({ keys: Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, spki(v)])), maxAgeSeconds: 3600 }));
    const keyFor = cachedKeySource(source, () => now);
    await keyFor("k1");
    keys = { k1: good.publicKey, k2: other.publicKey };
    expect(await keyFor("k2")).toBeNull(); // fetched under a minute ago
    now += 61_000;
    expect(await keyFor("k2")).not.toBeNull(); // rotation picked up
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("verifies a token signed with a rotated-in key", async () => {
    let now = NOW;
    let keys: Record<string, KeyObject> = { k1: good.publicKey };
    const source: FirebaseKeySource = async () => ({ keys: Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, spki(v)])), maxAgeSeconds: 3600 });
    const v = createFirebaseVerifier({ projectId: PROJECT, keySource: source, now: () => now });
    await v(await token());
    keys = { k2: other.publicKey };
    now += 120_000;
    await expect(v(await token({ kid: "k2", key: other.privateKey, claims: { iat: Math.floor(now / 1000) - 5, auth_time: Math.floor(now / 1000) - 5 } }))).resolves.toBeTruthy();
  });
});

describe("Google key source", () => {
  it("reads the PEM map and the Cache-Control max-age", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ a: "PEM-A", b: "PEM-B", junk: 1 }), { headers: { "cache-control": "public, max-age=19302, must-revalidate, no-transform" } }));
    const r = await googleSecureTokenKeys(fetchImpl as unknown as typeof fetch)();
    expect(r).toEqual({ keys: { a: "PEM-A", b: "PEM-B" }, maxAgeSeconds: 19302 });
  });

  it("fails on an HTTP error", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 500 }));
    await expect(googleSecureTokenKeys(fetchImpl as unknown as typeof fetch)()).rejects.toThrow(/HTTP 500/);
  });

  it("parses max-age", () => {
    expect(maxAgeFrom("public, max-age=600")).toBe(600);
    expect(maxAgeFrom("no-cache")).toBe(0);
    expect(maxAgeFrom(null)).toBe(0);
    expect(maxAgeFrom("s-maxage=10, max-age=20")).toBe(20);
  });
});
