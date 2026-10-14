import { importPKCS8, SignJWT } from "jose";
import { ProviderError, type ChannelDriver, type FcmConfig, type OutboundMessage } from "../types";
import { requestJson, type FetchFn } from "./http";

export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const fcmSendUrl = (projectId: string) => `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

export function parseServiceAccount(json: string): ServiceAccount {
  const sa = JSON.parse(json) as Partial<ServiceAccount>;
  if (!sa.project_id || !sa.client_email || !sa.private_key) {
    throw new Error("FCM service account JSON must contain project_id, client_email and private_key");
  }
  return sa as ServiceAccount;
}

/** True when FCM says the device token is no longer valid and should be deleted. */
export function isUnregisteredTokenError(err: unknown): boolean {
  if (!(err instanceof ProviderError) || err.provider !== "fcm") return false;
  const e = (err.body as { error?: { status?: string; details?: Array<{ errorCode?: string }> } } | null)?.error;
  if (e?.details?.some((d) => d.errorCode === "UNREGISTERED")) return true;
  return err.status === 404 && e?.status === "NOT_FOUND";
}

/** Push through FCM HTTP v1, authenticating with a service-account JWT exchanged for an OAuth access token. */
export class FcmDriver implements ChannelDriver {
  readonly channel = "push" as const;
  private readonly sa: ServiceAccount;
  private cached: { token: string; expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    config: FcmConfig,
    private readonly fetchFn: FetchFn = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.sa = parseServiceAccount(config.serviceAccountJson);
  }

  async send(msg: OutboundMessage): Promise<{ providerId?: string }> {
    const accessToken = await this.accessToken();
    const res = await requestJson<{ name?: string }>(this.fetchFn, "fcm", fcmSendUrl(this.sa.project_id), {
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          token: msg.to,
          notification: { title: msg.subject ?? "", body: msg.body },
          ...(msg.data && Object.keys(msg.data).length ? { data: msg.data } : {}),
        },
      }),
    });
    return { providerId: res?.name };
  }

  /** Access token, cached until 60s before expiry. Concurrent callers share one exchange. */
  async accessToken(): Promise<string> {
    if (this.cached && this.now() < this.cached.expiresAt) return this.cached.token;
    if (!this.pending) {
      this.pending = this.exchange().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  private async exchange(): Promise<string> {
    const key = await importPKCS8(this.sa.private_key, "RS256");
    const iat = Math.floor(this.now() / 1000);
    const assertion = await new SignJWT({ scope: FCM_SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT", ...(this.sa.private_key_id ? { kid: this.sa.private_key_id } : {}) })
      .setIssuer(this.sa.client_email)
      .setSubject(this.sa.client_email)
      .setAudience(GOOGLE_TOKEN_URL)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(key);
    const res = await requestJson<{ access_token: string; expires_in: number }>(this.fetchFn, "google-oauth", GOOGLE_TOKEN_URL, {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    this.cached = { token: res.access_token, expiresAt: this.now() + (res.expires_in - 60) * 1000 };
    return res.access_token;
  }
}
