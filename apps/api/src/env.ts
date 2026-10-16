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
      "http://localhost:3000,http://localhost:3001,http://*.localhost:3001,http://localhost:3002,http://*.localhost:3002,http://localhost:3003,http://*.localhost:3003,http://localhost:3004,http://*.localhost:3004,http://localhost:3005",
    ),
  /** Billing app URL for invoice share links; {slug} is replaced with the shop's subdomain. */
  BILLING_PUBLIC_URL: z.string().default("BL=http://{slug}.localhost:3001,EC=http://{slug}.localhost:3002/billing"),
  /** Online store URL (sitemap, robots.txt); {slug} = shop subdomain. One template, or APP=template pairs. Verified custom domains win. */
  STORE_PUBLIC_URL: z.string().default("http://{slug}.localhost:3003"),
  /** Where shops point their custom domain (CNAME), shown in the DNS instructions. */
  CNAME_TARGET: z.string().default("stores.srikit.in"),
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  OTP_TTL_MINUTES: z.coerce.number().default(10),
  /**
   * Development/test only: a fixed OTP (4–10 digits) for the test identities in TEST_OTP_TARGETS (comma-separated exact
   * phones/emails or `*` patterns, e.g. "+9199990*,e2e-*@example.com"). Ignored when NODE_ENV=production. Unset = off.
   */
  TEST_OTP_CODE: optionalString(),
  TEST_OTP_TARGETS: optionalString(),
  GOOGLE_CLIENT_ID: optionalString(),
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
  APP_PUBLIC_URL: z.string().default("BL=http://{slug}.localhost:3001,EC=http://{slug}.localhost:3002"),
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
    if (e.STORAGE_DRIVER === "s3" && !e.S3_BUCKET) {
      ctx.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "Required when STORAGE_DRIVER=s3" });
    }
  });

export type Env = z.infer<typeof envSchema>;
export const env = loadEnv(envSchema);
