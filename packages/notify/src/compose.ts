import { htmlToText, looksLikeHtml, placeholders, render, renderEmailHtml, type TemplateVars } from "./render";
import type { TemplateContent } from "./templates";
import type { Channel, NotifyConfig, OutboundMessage } from "./types";

export interface ComposeInput {
  channel: Channel;
  to: string;
  template: TemplateContent | null;
  /** Raw subject/body, used when there is no template. */
  subject?: string;
  body?: string;
  vars: TemplateVars;
  locale: string;
  config: Pick<NotifyConfig, "whatsapp">;
}

export const stringifyVars = (vars: TemplateVars): Record<string, string> =>
  Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]));

/** Renders a template (or raw body) into a channel-ready message. Pure. */
export function composeMessage(input: ComposeInput): OutboundMessage {
  const { channel, template, locale } = input;
  const vars = stringifyVars(input.vars);
  const bodyTpl = template?.body ?? input.body ?? "";
  const subjectTpl = template?.subject ?? input.subject;
  const msg: OutboundMessage = {
    to: input.to,
    body: render(bodyTpl, vars),
    vars,
  };
  if (subjectTpl) msg.subject = render(subjectTpl, vars);
  if (template) msg.templateKey = template.key;

  if (channel === "email") {
    msg.html = renderEmailHtml(bodyTpl, vars);
    if (looksLikeHtml(bodyTpl)) msg.body = htmlToText(msg.html);
  }

  const ref = template?.providerRef ?? null;
  const params = () => (ref?.params ?? placeholders(bodyTpl)).map((p) => vars[p] ?? "");
  if (channel === "sms" && ref?.msg91FlowId) {
    msg.templateRef = { name: ref.msg91FlowId, language: locale, params: params() };
  }
  if (channel === "whatsapp") {
    const cfg = template ? input.config.whatsapp?.templates?.[template.key] : undefined;
    const name = ref?.waTemplate ?? cfg?.name;
    if (name) msg.templateRef = { name, language: ref?.waLanguage ?? cfg?.language ?? locale, params: params() };
  }
  if (channel === "push") msg.data = vars;
  return msg;
}
