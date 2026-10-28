import { aiEnvShape } from "@srirealtime/ai";
import { loadEnv, optionalString } from "@srirealtime/core";
import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  APP_NAME: z.string().default("Srirealtime"),
  /** Public URL of this API, used in signed local-upload URLs. */
  API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  /** Secret for HMAC-signed URLs. Must be set (32+ chars) in production. */
  APP_SECRET: z.string().min(16).default("dev-only-secret-change-me"),
  /** Phone or email made super-admin by `pnpm seed`. */
  SEED_SUPERADMIN: optionalString(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  ROOT_DOMAIN: z.string().default("localhost"),
  /** Comma-separated. Entries may use a "*." wildcard for tenant subdomains, e.g. http://*.localhost:3001 */
  CORS_ORIGINS: z
    .string()
    .default(
      "http://localhost:3000,http://localhost:3001,http://*.localhost:3001,http://localhost:3002,http://*.localhost:3002,http://localhost:3003,http://*.localhost:3003,http://localhost:3004,http://*.localhost:3004,http://localhost:3005,http://localhost:3006,http://*.localhost:3006,http://localhost:3007,http://*.localhost:3007,http://localhost:3008,http://*.localhost:3008,http://localhost:3009,http://*.localhost:3009",
    ),
  /** Billing app URL for invoice share links; {slug} is replaced with the shop's subdomain. */
  BILLING_PUBLIC_URL: z.string().default("BL=http://{slug}.localhost:3001,EC=http://{slug}.localhost:3002/billing,PH=http://{slug}.localhost:3006,RS=http://{slug}.localhost:3007/billing,SV=http://{slug}.localhost:3008"),
  /** Online store URL (sitemap, robots.txt); {slug} = shop subdomain. One template, or APP=template pairs. Verified custom domains win. */
  STORE_PUBLIC_URL: z.string().default("http://{slug}.localhost:3003"),
  /** Where shops point their custom domain (CNAME), shown in the DNS instructions. */
  CNAME_TARGET: z.string().default("stores.srikit.in"),
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  /** Sessions of the srikit mobile apps (`x-client` header): days, sliding with use. */
  MOBILE_SESSION_TTL_DAYS: z.coerce.number().default(90),
  /** Lowest app versions allowed to call the API, e.g. "business=1.0.0,shops=1.0.0" (older apps get 426). */
  MOBILE_MIN_VERSIONS: optionalString(),
  /** Newest app versions in the stores, same format (apps offer an update when older). */
  MOBILE_LATEST_VERSIONS: optionalString(),
  OTP_TTL_MINUTES: z.coerce.number().default(10),
  /**
   * Development/test only: a fixed OTP (4–10 digits) for the test identities in TEST_OTP_TARGETS (comma-separated exact
   * phones/emails or `*` patterns, e.g. "+9199990*,e2e-*@example.com"). Ignored when NODE_ENV=production. Unset = off.
   */
  TEST_OTP_CODE: optionalString(),
  TEST_OTP_TARGETS: optionalString(),
  /** Shop slugs (comma-separated) that offer the read-only live demo, `POST /v1/auth/demo` (docs/demo-access.md). Unset = no demo sign-in. */
  DEMO_SHOPS: optionalString(),
  GOOGLE_CLIENT_ID: optionalString(),
  /**
   * Firebase project id for phone sign-in (docs/firebase-auth.md): `POST /v1/auth/firebase` accepts its Phone
   * Authentication ID tokens and `GET /v1/auth/config` tells clients to verify phones with Firebase. Only the id is
   * needed (no service account). Unset = phones use the OTP flow.
   */
  FIREBASE_PROJECT_ID: optionalString(),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".uploads"),
  S3_ENDPOINT: optionalString(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: optionalString(),
  S3_ACCESS_KEY_ID: optionalString(),
  S3_SECRET_ACCESS_KEY: optionalString(),
  /** CDN or public-bucket base for public files; leave blank to use the storage default. */
  PUBLIC_UPLOAD_BASE_URL: optionalString(),
  MSG91_AUTH_KEY: optionalString(),
  MSG91_SENDER_ID: optionalString(),
  /** DLT-approved MSG91 flow id for the OTP template. */
  MSG91_OTP_FLOW_ID: optionalString(),
  RESEND_API_KEY: optionalString(),
  EMAIL_FROM: z.string().default("no-reply@srirealtime.com"),
  WHATSAPP_TOKEN: optionalString(),
  WHATSAPP_PHONE_NUMBER_ID: optionalString(),
  FCM_SERVICE_ACCOUNT_JSON: optionalString(),
  /** Signs chat (and live WhatsApp inbox) stream tokens; share it between API instances. Must be set in production. */
  CHAT_STREAM_SECRET: z.string().min(16).default("dev-only-chat-stream-secret"),
  /** KYC provider (Surepass/IDfy-like HTTP API, platform-wide). Unset = the mock provider (development only). */
  KYC_BASE_URL: optionalString(),
  KYC_TOKEN: optionalString(),
  /** Name stored on each check, e.g. "surepass". */
  KYC_PROVIDER_NAME: optionalString(),
  /** Encrypts shops' WhatsApp tokens/app secrets. Default: derived from APP_SECRET. */
  WHATSAPP_SECRET_KEY: optionalString(),
  /** GSP (e-invoice) REST base URLs and the platform's ASP client credentials. Unset = mock only (development). */
  EINVOICE_GSP_BASE_URL: optionalString(),
  EINVOICE_GSP_SANDBOX_URL: optionalString(),
  EINVOICE_GSP_CLIENT_ID: optionalString(),
  EINVOICE_GSP_CLIENT_SECRET: optionalString(),
  /**
   * GSTIN lookup (docs/recurring-export-gstin.md). Unset = offline only (checksum, State and PAN from the number).
   * "gstn-search": an HTTP endpoint answering the GSTN taxpayer-search JSON (a GSP's or a public search API);
   * GSTIN_LOOKUP_URL has `{gstin}` where the number goes; the key is sent in GSTIN_LOOKUP_HEADER (default Authorization).
   */
  GSTIN_LOOKUP_PROVIDER: z.enum(["gstn-search"]).optional().catch(undefined),
  GSTIN_LOOKUP_URL: optionalString(),
  GSTIN_LOOKUP_KEY: optionalString(),
  GSTIN_LOOKUP_HEADER: optionalString(),
  /** Provider calls per shop per hour / day (cache hits are free) and the cache life in days. */
  GSTIN_LOOKUP_PER_HOUR: z.coerce.number().int().min(1).max(10_000).default(30),
  GSTIN_LOOKUP_PER_DAY: z.coerce.number().int().min(1).max(100_000).default(200),
  GSTIN_LOOKUP_CACHE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  // ---- Batch 5: plan subscriptions (docs/batch5.md)
  /** The platform's own Razorpay account for plan subscriptions. All three unset = the mock provider (development only). */
  PLATFORM_RAZORPAY_KEY_ID: optionalString(),
  PLATFORM_RAZORPAY_KEY_SECRET: optionalString(),
  PLATFORM_RAZORPAY_WEBHOOK_SECRET: optionalString(),
  /** The platform as the seller on its plan invoices (18% GST). */
  PLATFORM_LEGAL_NAME: z.string().default("Srirealtime"),
  PLATFORM_GSTIN: optionalString(),
  /** 2-digit GST state code of the platform: CGST+SGST for shops in this state, IGST otherwise. Default 33 (Tamil Nadu). */
  PLATFORM_STATE_CODE: z.string().regex(/^\d{2}$/, "2-digit GST state code").default("33"),
  PLATFORM_ADDRESS: optionalString(),
  /** Platform invoice number prefix: SR/2026-27/00001. */
  PLATFORM_INVOICE_PREFIX: z.string().regex(/^[A-Z]{1,4}$/, "1–4 capital letters").default("SR"),
  /** The public landing site (sign-up, pricing). */
  WWW_PUBLIC_URL: z.string().url().default("http://localhost:3005"),
  /** Where each app opens a shop ({slug} = shop subdomain): sign-up's `appUrl` and handoff links. APP=template pairs. */
  APP_PUBLIC_URL: z.string().default("BL=http://{slug}.localhost:3001,EC=http://{slug}.localhost:3002,PH=http://{slug}.localhost:3006,RS=http://{slug}.localhost:3007,SV=http://{slug}.localhost:3008,SC=http://{slug}.localhost:3009"),
  // ---- Batch 6: operational safety net (docs/ops.md)
  /** Sentry-compatible DSN; set = 5xx errors and final job failures are sent there (otherwise only logged). */
  SENTRY_DSN: optionalString(),
  /** Environment tag on error reports. Default NODE_ENV. */
  SENTRY_ENVIRONMENT: optionalString(),
  /** Bearer token for GET /metrics (Prometheus). Unset = /metrics is disabled (404). 16+ chars. */
  METRICS_TOKEN: optionalString(),
  /** Build info for GET /version and error-report releases, set by the image build (batch 7). */
  GIT_SHA: optionalString(),
  BUILD_TIME: optionalString(),
  /** Per-dependency timeout of GET /ready. */
  READY_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(2000),
  /**
   * Run the background job workers and register the cron schedules in this process (default true). Set false on the
   * API service when a separate worker service (same image, JOBS_WORKERS=true) processes the jobs (docs/deploy-aws.md).
   */
  JOBS_WORKERS: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  /** Log level (pino). Default debug in development, info otherwise. */
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  // ---- HTTP hardening (apps/api/src/http-guard.ts)
  /** Global HTTP rate limit (fixed windows; Redis-shared when REDIS_URL is set). Default on. */
  RATE_LIMIT_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
  /** Per client IP, all routes. Default 600 (10x in development, where one machine runs every app and e2e). */
  RATE_LIMIT_IP_MAX: z.coerce.number().int().min(1).optional(),
  /** Per signed-in user. */
  RATE_LIMIT_USER_MAX: z.coerce.number().int().min(1).optional(),
  /** Per shop (all its users together). */
  RATE_LIMIT_TENANT_MAX: z.coerce.number().int().min(1).optional(),
  /** Per client IP on the sign-in routes (OTP, Google, Firebase, 2FA). */
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).optional(),
  /** Largest JSON request body in bytes (routes with their own bodyLimit, e.g. imports and webhooks, keep theirs). */
  BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).default(1_048_576),
  // ---- AI foundation (docs/ai.md): ANTHROPIC_API_KEY, AI_ENABLED, AI_PROVIDER, AI_MODEL_LIGHT / _STANDARD / _VISION, AI_USD_INR
  ...aiEnvShape,
})
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === "production" && (e.APP_SECRET.length < 32 || e.APP_SECRET.startsWith("dev-only"))) {
      ctx.addIssue({ code: "custom", path: ["APP_SECRET"], message: "Set a random 32+ character secret in production" });
    }
    if (e.NODE_ENV === "production" && e.CHAT_STREAM_SECRET.startsWith("dev-only")) {
      ctx.addIssue({ code: "custom", path: ["CHAT_STREAM_SECRET"], message: "Set a random secret in production" });
    }
    if (e.TEST_OTP_CODE && !/^\d{4,10}$/.test(e.TEST_OTP_CODE)) {
      ctx.addIssue({ code: "custom", path: ["TEST_OTP_CODE"], message: "Use 4–10 digits" });
    }
    const rzp = [e.PLATFORM_RAZORPAY_KEY_ID, e.PLATFORM_RAZORPAY_KEY_SECRET, e.PLATFORM_RAZORPAY_WEBHOOK_SECRET].filter(Boolean).length;
    if (rzp > 0 && rzp < 3) {
      ctx.addIssue({ code: "custom", path: ["PLATFORM_RAZORPAY_KEY_ID"], message: "Set all three PLATFORM_RAZORPAY_* variables, or none (mock)" });
    }
    if (e.PLATFORM_GSTIN && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(e.PLATFORM_GSTIN)) {
      ctx.addIssue({ code: "custom", path: ["PLATFORM_GSTIN"], message: "Invalid GSTIN" });
    } else if (e.PLATFORM_GSTIN && e.PLATFORM_GSTIN.slice(0, 2) !== e.PLATFORM_STATE_CODE) {
      ctx.addIssue({ code: "custom", path: ["PLATFORM_GSTIN"], message: "GSTIN state differs from PLATFORM_STATE_CODE" });
    }
    if (e.FIREBASE_PROJECT_ID && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(e.FIREBASE_PROJECT_ID)) {
      ctx.addIssue({ code: "custom", path: ["FIREBASE_PROJECT_ID"], message: "Use the Firebase project id (e.g. srikit-prod), not the name or number" });
    }
    if (e.METRICS_TOKEN && e.METRICS_TOKEN.length < 16) {
      ctx.addIssue({ code: "custom", path: ["METRICS_TOKEN"], message: "Use a random token of 16+ characters" });
    }
    if (e.STORAGE_DRIVER === "s3" && !e.S3_BUCKET) {
      ctx.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "Required when STORAGE_DRIVER=s3" });
    }
  });

export type Env = z.infer<typeof envSchema>;
export const env = loadEnv(envSchema);
