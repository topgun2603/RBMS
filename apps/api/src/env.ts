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
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001,http://*.localhost:3001,http://localhost:3002,http://*.localhost:3002"),
  /** Billing app URL for invoice share links; {slug} is replaced with the shop's subdomain. */
  BILLING_PUBLIC_URL: z.string().default("BL=http://{slug}.localhost:3001,EC=http://{slug}.localhost:3002/billing"),
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  OTP_TTL_MINUTES: z.coerce.number().default(10),
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
})
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === "production" && (e.APP_SECRET.length < 32 || e.APP_SECRET.startsWith("dev-only"))) {
      ctx.addIssue({ code: "custom", path: ["APP_SECRET"], message: "Set a random 32+ character secret in production" });
    }
    if (e.STORAGE_DRIVER === "s3" && !e.S3_BUCKET) {
      ctx.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "Required when STORAGE_DRIVER=s3" });
    }
  });

export type Env = z.infer<typeof envSchema>;
export const env = loadEnv(envSchema);
