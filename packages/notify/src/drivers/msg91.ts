import { ProviderError, type ChannelDriver, type Msg91Config, type OutboundMessage } from "../types";
import { digitsOnly, requestJson, type FetchFn } from "./http";

export const MSG91_FLOW_URL = "https://control.msg91.com/api/v5/flow";

/**
 * SMS through MSG91 Flow API. Indian DLT rules require every SMS to use an approved template,
 * so a flow id is mandatory: from the template's provider_ref (passed as `templateRef.name`)
 * or `config.flowIds[templateKey]`. Template variables are sent as flow variables.
 */
export class Msg91Driver implements ChannelDriver {
  readonly channel = "sms" as const;

  constructor(
    private readonly config: Msg91Config,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(msg: OutboundMessage): Promise<{ providerId?: string }> {
    const flowId = msg.templateRef?.name ?? (msg.templateKey ? this.config.flowIds[msg.templateKey] : undefined);
    if (!flowId) {
      throw new Error(
        `MSG91: no DLT flow id for template "${msg.templateKey ?? "(raw body)"}"; set msg91.flowIds or the template's provider_ref.msg91FlowId`,
      );
    }
    const recipient: Record<string, string> = { mobiles: digitsOnly(msg.to), ...(msg.vars ?? {}) };
    const res = await requestJson<{ type?: string; message?: string; request_id?: string }>(this.fetchFn, "msg91", MSG91_FLOW_URL, {
      headers: { authkey: this.config.authKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ template_id: flowId, sender: this.config.senderId, short_url: "0", recipients: [recipient] }),
    });
    // MSG91 can answer 200 with { type: "error" }.
    if (res && res.type === "error") throw new ProviderError("msg91", 200, res);
    return { providerId: res?.request_id ?? res?.message };
  }
}
