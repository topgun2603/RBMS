/**
 * Firebase Phone Authentication for the sign-in screens (docs/firebase-auth.md). Framework-free so the kit login,
 * the landing site (apps/www) and the admin app share it: `import … from "@srirealtime/web/firebase-phone"`.
 *
 * Firebase only verifies the phone number. The ID token goes to `POST /v1/auth/firebase`, which starts our own session;
 * the Firebase client is signed out right after (in-memory persistence, nothing stored). The SDK (`firebase/app` +
 * `firebase/auth` only) is loaded on demand when a phone sign-in starts.
 */

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

/** The public web config from NEXT_PUBLIC_FIREBASE_* (all four, or null = use the OTP flow). */
export function firebaseWebConfig(): FirebaseWebConfig | null {
  // Literal process.env.NEXT_PUBLIC_* references so Next inlines them into each app's bundle.
  const c = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  };
  return c.apiKey && c.authDomain && c.projectId && c.appId ? c : null;
}

/** `GET /v1/auth/config`, the parts the sign-in screens use. */
export interface AuthClientConfig {
  phone: { method: "firebase" | "otp"; firebaseProjectId: string | null; smsOtp?: boolean };
  google?: boolean;
  testTargets?: string[];
}

/** Same rule as the API's test identities: exact values or `*` patterns; a bare "*" never matches. */
export function matchesTestTarget(target: string, patterns: readonly string[] = []): boolean {
  const value = target.trim().toLowerCase();
  return patterns.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p || p === "*") return false;
    if (!p.includes("*")) return p === value;
    return new RegExp(`^${p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(value);
  });
}

/**
 * How to verify `target`: "firebase" only when this app has the Firebase config, the API says phones use Firebase
 * for the same project, the target is a phone on the SMS channel and not a test identity (those keep the fixed dev
 * OTP so the e2e tests work). Anything else, including an unreachable config endpoint, is "otp" (the existing flow).
 */
export function choosePhoneMethod(input: {
  kind: "phone" | "email" | "invalid";
  target: string;
  channel?: "sms" | "whatsapp" | "email";
  web: FirebaseWebConfig | null;
  server: AuthClientConfig | null;
}): "firebase" | "otp" {
  const { kind, target, channel = "sms", web, server } = input;
  if (!web || kind !== "phone" || channel !== "sms" || !server) return "otp";
  if (server.phone.method !== "firebase" || server.phone.firebaseProjectId !== web.projectId) return "otp";
  if (matchesTestTarget(target, server.testTargets)) return "otp";
  return "firebase";
}

let configPromise: Promise<AuthClientConfig | null> | null = null;

/** Loads `/auth/config` once per page (null when it fails; callers then use the OTP flow). */
export function loadAuthConfig(fetchConfig: () => Promise<AuthClientConfig>): Promise<AuthClientConfig | null> {
  configPromise ??= fetchConfig().catch(() => {
    configPromise = null; // try again next time
    return null;
  });
  return configPromise;
}

/** Decides the method for a target, fetching the API config only when this app has a Firebase config at all. */
export async function resolvePhoneMethod(
  input: { kind: "phone" | "email" | "invalid"; target: string; channel?: "sms" | "whatsapp" | "email" },
  fetchConfig: () => Promise<AuthClientConfig>,
): Promise<"firebase" | "otp"> {
  const web = firebaseWebConfig();
  if (!web || input.kind !== "phone" || (input.channel ?? "sms") !== "sms") return "otp";
  return choosePhoneMethod({ ...input, web, server: await loadAuthConfig(fetchConfig) });
}

// ------------------------------------------------------------------ authorized hosts (per-shop subdomains)

/**
 * Hosts where Firebase phone sign-in may run in place: NEXT_PUBLIC_FIREBASE_AUTH_HOSTS, comma-separated exact host
 * names ("localhost", "srikit.in") or ".suffix" entries for every subdomain (".srikit.in"). Default "localhost".
 * Must mirror the Firebase console's authorized domains. Elsewhere the kit login sends the user to the landing site's
 * /login to verify the number and comes back with a handoff code.
 */
export function firebaseAuthHosts(): string[] {
  return (process.env.NEXT_PUBLIC_FIREBASE_AUTH_HOSTS || "localhost")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function isFirebaseAuthHost(hostname: string, hosts: readonly string[] = firebaseAuthHosts()): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, "");
  return hosts.some((e) => (e.startsWith(".") ? h.endsWith(e) && h.length > e.length : h === e));
}

/** The landing site's /login that verifies `phone` and hands the session back to `returnUrl`. */
export function phoneSignInRedirectUrl(wwwUrl: string, phone: string, returnUrl: string): string {
  const u = new URL("/login", wwwUrl);
  u.searchParams.set("phone", phone);
  u.searchParams.set("return", returnUrl);
  return u.toString();
}

/**
 * Validates a `?return=` URL before a handoff code is sent there (a code signs the user in, so an open redirect would
 * hand over the account). Allowed: an origin matching one of `origins` ("https://admin.srikit.in",
 * "http://*.localhost:3001" — `*` = one subdomain label), no credentials, and a path ending in "/login". Returns the
 * normalised URL without `handoff`, or null.
 */
export function safeReturnUrl(raw: string | null | undefined, origins: readonly string[]): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (!/(^|\/)login\/?$/.test(u.pathname)) return null;
  const origin = u.origin.toLowerCase();
  const ok = origins.some((pattern) => {
    const p = pattern.trim().toLowerCase().replace(/\/+$/, "");
    if (!p) return false;
    if (!p.includes("*")) return p === origin;
    const re = new RegExp(`^${p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[a-z0-9-]+")}$`);
    return re.test(origin);
  });
  if (!ok) return null;
  u.searchParams.delete("handoff");
  u.hash = "";
  return u.toString();
}

// ------------------------------------------------------------------ errors

export type FirebasePhoneErrorKind =
  | "invalid_code"
  | "code_expired"
  | "too_many_attempts"
  | "quota_exceeded"
  | "network"
  | "invalid_phone"
  | "captcha"
  | "unauthorized_domain"
  | "popup_closed"
  | "popup_blocked"
  | "account_exists"
  | "not_enabled"
  | "unknown";

/** Maps a Firebase Auth error (its `code`) to a kind the UI can explain. */
export function firebasePhoneErrorKind(err: unknown): FirebasePhoneErrorKind {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  switch (code) {
    case "auth/invalid-verification-code":
    case "auth/missing-verification-code":
      return "invalid_code";
    case "auth/code-expired":
    case "auth/session-expired":
    case "auth/invalid-verification-id":
    case "auth/missing-verification-id":
      return "code_expired";
    case "auth/too-many-requests":
      return "too_many_attempts";
    case "auth/quota-exceeded":
      return "quota_exceeded";
    case "auth/network-request-failed":
    case "auth/timeout":
      return "network";
    case "auth/invalid-phone-number":
    case "auth/missing-phone-number":
      return "invalid_phone";
    case "auth/captcha-check-failed":
    case "auth/invalid-app-credential":
    case "auth/missing-app-credential":
      return "captcha";
    case "auth/unauthorized-domain":
      return "unauthorized_domain";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
    case "auth/user-cancelled":
      return "popup_closed";
    case "auth/popup-blocked":
      return "popup_blocked";
    case "auth/account-exists-with-different-credential":
      return "account_exists";
    case "firebase_no_email":
      return "account_exists";
    case "auth/operation-not-allowed":
    case "auth/admin-restricted-operation":
    case "auth/invalid-api-key":
    case "auth/configuration-not-found":
    case "not_configured":
      return "not_enabled";
    // Our API rejecting the token (POST /v1/auth/firebase).
    case "firebase_token_expired":
    case "firebase_token_stale":
      return "code_expired";
    case "firebase_keys_unavailable":
      return "network";
    default:
      return "unknown";
  }
}

/** True for Firebase Auth errors (`auth/…`) and our API's Firebase token rejections (`firebase_…`). */
export const isFirebaseError = (err: unknown) => {
  const code = !!err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  return code.startsWith("auth/") || code.startsWith("firebase_");
};

const MESSAGES: Record<"en" | "ta", Record<FirebasePhoneErrorKind, string>> = {
  en: {
    invalid_code: "That code didn't work. Check it and try again.",
    code_expired: "The code has expired. Tap Resend to get a new one.",
    too_many_attempts: "Too many attempts. Please wait a while and try again.",
    quota_exceeded: "We can't send more codes right now. Please try again later or use email.",
    network: "No connection. Check your internet and try again.",
    invalid_phone: "Enter a valid mobile number.",
    captcha: "We couldn't confirm this request. Reload the page and try again.",
    unauthorized_domain: "Phone sign-in isn't available on this address. Please use email.",
    popup_closed: "Sign-in was cancelled. Please try again.",
    popup_blocked: "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.",
    account_exists: "We couldn't use this Google account. Make sure its email is verified, or use your mobile number.",
    not_enabled: "Phone sign-in isn't available right now. Please use email.",
    unknown: "Something went wrong. Please try again.",
  },
  ta: {
    invalid_code: "இந்தக் குறியீடு சரியில்லை. சரிபார்த்து மீண்டும் முயலவும்.",
    code_expired: "குறியீடு காலாவதியாகிவிட்டது. புதிய குறியீட்டுக்கு 'மீண்டும் அனுப்பு' என்பதைத் தட்டவும்.",
    too_many_attempts: "பல முறை முயன்றுவிட்டீர்கள். சிறிது நேரம் கழித்து மீண்டும் முயலவும்.",
    quota_exceeded: "இப்போது மேலும் குறியீடுகளை அனுப்ப முடியவில்லை. பின்னர் முயலவும் அல்லது மின்னஞ்சலைப் பயன்படுத்தவும்.",
    network: "இணைய இணைப்பு இல்லை. இணையத்தைச் சரிபார்த்து மீண்டும் முயலவும்.",
    invalid_phone: "சரியான மொபைல் எண்ணை உள்ளிடவும்.",
    captcha: "இந்தக் கோரிக்கையை உறுதிசெய்ய முடியவில்லை. பக்கத்தை மீண்டும் ஏற்றி முயலவும்.",
    unauthorized_domain: "இந்த முகவரியில் தொலைபேசி உள்நுழைவு இல்லை. மின்னஞ்சலைப் பயன்படுத்தவும்.",
    popup_closed: "உள்நுழைவு ரத்து செய்யப்பட்டது. மீண்டும் முயலவும்.",
    popup_blocked: "உங்கள் உலாவி உள்நுழைவு சாளரத்தைத் தடுத்தது. இந்தத் தளத்திற்கு பாப்-அப்களை அனுமதித்து மீண்டும் முயலவும்.",
    account_exists: "இந்த Google கணக்கைப் பயன்படுத்த முடியவில்லை. அதன் மின்னஞ்சல் சரிபார்க்கப்பட்டதா என்று பாருங்கள் அல்லது மொபைல் எண்ணைப் பயன்படுத்துங்கள்.",
    not_enabled: "தொலைபேசி உள்நுழைவு இப்போது கிடைக்கவில்லை. மின்னஞ்சலைப் பயன்படுத்தவும்.",
    unknown: "ஏதோ தவறு நடந்தது. மீண்டும் முயலவும்.",
  },
};

/** A friendly English or Tamil message for a Firebase phone error. */
export function firebasePhoneMessage(err: unknown, locale: string | null | undefined): string {
  const lang = locale?.toLowerCase().startsWith("ta") ? "ta" : "en";
  return MESSAGES[lang][firebasePhoneErrorKind(err)];
}

// ------------------------------------------------------------------ the SDK (lazy)

type AuthModule = typeof import("firebase/auth");
type FirebaseAuth = import("firebase/auth").Auth;
type Verifier = import("firebase/auth").RecaptchaVerifier;

let sdk: Promise<{ mod: AuthModule; auth: FirebaseAuth }> | null = null;

function loadSdk(): Promise<{ mod: AuthModule; auth: FirebaseAuth }> {
  const cfg = firebaseWebConfig();
  if (!cfg) return Promise.reject(Object.assign(new Error("Firebase is not configured"), { code: "auth/invalid-api-key" }));
  sdk ??= Promise.all([import("firebase/app"), import("firebase/auth")])
    .then(([appMod, mod]) => {
      const name = "srikit-phone";
      const app = appMod.getApps().find((a) => a.name === name) ?? appMod.initializeApp(cfg, name);
      // In memory only: our API session is the source of truth, nothing of Firebase's is kept in the browser.
      const auth = mod.initializeAuth(app, { persistence: mod.inMemoryPersistence });
      return { mod, auth };
    })
    .catch((err) => {
      sdk = null;
      throw err;
    });
  return sdk;
}

let verifier: Verifier | null = null;
let holder: HTMLElement | null = null;

function resetVerifier() {
  try {
    verifier?.clear();
  } catch {
    // already gone
  }
  verifier = null;
  holder?.remove();
  holder = null;
}

/** A code sent by Firebase; `confirm` checks it and returns the ID token for `POST /v1/auth/firebase`. */
export interface FirebasePhoneCode {
  confirm(code: string): Promise<string>;
}

/**
 * Sends the SMS code to `phone` (E.164) behind an invisible reCAPTCHA. `locale` picks the SMS language. Throws Firebase
 * errors (map them with `firebasePhoneMessage`).
 */
export async function sendFirebasePhoneCode(phone: string, opts: { locale?: string } = {}): Promise<FirebasePhoneCode> {
  const { mod, auth } = await loadSdk();
  auth.languageCode = opts.locale?.toLowerCase().startsWith("ta") ? "ta" : "en";
  resetVerifier();
  holder = document.createElement("div");
  holder.setAttribute("data-firebase-recaptcha", "");
  document.body.appendChild(holder);
  verifier = new mod.RecaptchaVerifier(auth, holder, { size: "invisible" });
  let confirmation: import("firebase/auth").ConfirmationResult;
  try {
    confirmation = await mod.signInWithPhoneNumber(auth, phone, verifier);
  } catch (err) {
    resetVerifier();
    throw err;
  }
  return {
    async confirm(code: string) {
      const cred = await confirmation.confirm(code.replace(/\s/g, ""));
      try {
        return await cred.user.getIdToken();
      } finally {
        // Our session replaces Firebase's; the ID token stays valid for the exchange.
        await mod.signOut(auth).catch(() => undefined);
        resetVerifier();
      }
    },
  };
}

/**
 * "Continue with Google" through Firebase: a Google account picker in a popup. Resolves with the Firebase ID token for
 * `POST /v1/auth/firebase` (the API accepts a Google token only with a verified email). Must run from a click (pop-up
 * blockers). Firebase is signed out right away, like the phone flow. Throws Firebase errors (`firebasePhoneMessage`).
 */
export async function signInWithGoogle(opts: { locale?: string } = {}): Promise<string> {
  const { mod, auth } = await loadSdk();
  auth.languageCode = opts.locale?.toLowerCase().startsWith("ta") ? "ta" : "en";
  const provider = new mod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const cred = await mod.signInWithPopup(auth, provider, mod.browserPopupRedirectResolver);
    return await cred.user.getIdToken();
  } finally {
    await mod.signOut(auth).catch(() => undefined);
  }
}

/** Preloads the SDK chunk (e.g. when the user starts typing a phone number). No-op without a Firebase config. */
export function preloadFirebase(): void {
  if (firebaseWebConfig()) void loadSdk().catch(() => undefined);
}
