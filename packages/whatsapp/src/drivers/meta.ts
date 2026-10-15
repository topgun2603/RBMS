import { waId } from "../logic";
import type { TemplateComponent } from "../template";
import { WhatsAppProviderError, type DriverAccount, type FetchFn, type OutboundPayload, type RemoteTemplate, type WhatsAppDriver } from "./types";

export const GRAPH_BASE = "https://graph.facebook.com/v21.0";

/** Cloud API request body for `POST /{phone-number-id}/messages`. Pure (tested). */
export function buildMessagePayload(to: string, p: OutboundPayload): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: waId(to) };
  switch (p.type) {
    case "text":
      return {
        ...base,
        type: "text",
        text: { body: p.body, preview_url: p.previewUrl ?? false },
        ...(p.replyTo ? { context: { message_id: p.replyTo } } : {}),
      };
    case "template":
      return {
        ...base,
        type: "template",
        template: { name: p.name, language: { code: p.language }, ...(p.components.length ? { components: p.components } : {}) },
      };
    case "image":
      return { ...base, type: "image", image: { link: p.link, ...(p.caption ? { caption: p.caption } : {}) } };
    case "document":
      return {
        ...base,
        type: "document",
        document: { link: p.link, ...(p.caption ? { caption: p.caption } : {}), ...(p.filename ? { filename: p.filename } : {}) },
      };
  }
}

/** WhatsApp Cloud API (Graph API v21.0) with the shop's own system-user token. */
export class MetaDriver implements WhatsAppDriver {
  readonly name = "meta" as const;

  constructor(
    private readonly account: Pick<DriverAccount, "phoneNumberId" | "wabaId" | "token">,
    private readonly fetchFn: FetchFn = fetch,
    private readonly base = GRAPH_BASE,
  ) {}

  private async request<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(url, {
      method,
      headers: { authorization: `Bearer ${this.account.token}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // keep text
    }
    if (!res.ok) {
      const code = (parsed as { error?: { code?: unknown } } | null)?.error?.code;
      throw new WhatsAppProviderError(res.status, parsed, typeof code === "number" ? code : null);
    }
    return parsed as T;
  }

  async send(to: string, payload: OutboundPayload): Promise<{ providerId: string }> {
    const res = await this.request<{ messages?: { id: string }[] }>(
      "POST",
      `${this.base}/${encodeURIComponent(this.account.phoneNumberId)}/messages`,
      buildMessagePayload(to, payload),
    );
    const id = res?.messages?.[0]?.id;
    if (!id) throw new WhatsAppProviderError(502, res, null);
    return { providerId: id };
  }

  async markRead(providerId: string): Promise<void> {
    await this.request("POST", `${this.base}/${encodeURIComponent(this.account.phoneNumberId)}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: providerId,
    });
  }

  async listTemplates(): Promise<RemoteTemplate[]> {
    const out: RemoteTemplate[] = [];
    let url: string | null =
      `${this.base}/${encodeURIComponent(this.account.wabaId)}/message_templates?fields=id,name,language,status,category,components,parameter_format&limit=100`;
    for (let page = 0; url && page < 50; page++) {
      const res: { data?: Record<string, unknown>[]; paging?: { next?: string } } = await this.request("GET", url);
      for (const t of res?.data ?? []) {
        if (typeof t.name !== "string" || typeof t.language !== "string") continue;
        out.push({
          id: typeof t.id === "string" ? t.id : null,
          name: t.name,
          language: t.language,
          status: typeof t.status === "string" ? t.status : "UNKNOWN",
          category: typeof t.category === "string" ? t.category : null,
          parameterFormat: typeof t.parameter_format === "string" ? t.parameter_format : null,
          components: Array.isArray(t.components) ? (t.components as TemplateComponent[]) : [],
        });
      }
      // Only follow Graph's own paging links.
      const next: string | undefined = res?.paging?.next;
      url = next && next.startsWith(this.base.replace(/\/v[\d.]+$/, "")) ? next : null;
    }
    return out;
  }
}
