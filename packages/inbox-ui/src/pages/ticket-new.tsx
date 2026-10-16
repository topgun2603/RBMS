"use client";

import * as React from "react";
import { LifeBuoyIcon, Loader2Icon, PhoneIcon, SaveIcon, UserRoundIcon } from "lucide-react";
import {
  Button,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@srirealtime/ui";
import { describeError, Page, PageHeading, useFeature, useI18n, useModuleNavigate } from "@srirealtime/web";
import { Section, TagEditor } from "../components/bits";
import { AutoTextarea } from "../components/composer";
import { StaffSelect } from "../components/staff-select";
import { FEATURES } from "../lib/access";
import { useCreateTicket } from "../lib/queries";
import { TICKET_CHANNELS, TICKET_PRIORITIES, type TicketChannel, type TicketPriority } from "../lib/types";

const NONE = "__none";

/** "98765 43210" / "+91 98765 43210" → "+919876543210"; null when it isn't an Indian mobile. */
export function toIndianMobile(v: string): string | null {
  const d = v.replace(/\D/g, "");
  const ten = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 11 && d.startsWith("0") ? d.slice(1) : d;
  return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null;
}

export default function TicketNewPage() {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const create = useCreateTicket();
  const ordersOn = useFeature(FEATURES.orders);
  const invoicesOn = useFeature(FEATURES.invoices);
  const [tried, setTried] = React.useState(false);
  const [f, setF] = React.useState({
    subject: "",
    body: "",
    name: "",
    phone: "",
    email: "",
    priority: "normal" as TicketPriority,
    channel: "phone" as TicketChannel,
    assigneeId: null as string | null,
    tags: [] as string[],
    relatedType: NONE as "order" | "invoice" | typeof NONE,
    relatedId: "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const phone = f.phone.trim() ? toIndianMobile(f.phone) : null;
  const errors = {
    subject: f.subject.trim().length < 3 ? t("inbox.newTicket.err.subject") : null,
    body: !f.body.trim() ? t("inbox.newTicket.err.body") : null,
    name: !f.name.trim() ? t("inbox.newTicket.err.name") : null,
    phone: f.phone.trim() && !phone ? t("inbox.newTicket.err.phone") : null,
    email: f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim()) ? t("inbox.newTicket.err.email") : null,
    contact: !f.phone.trim() && !f.email.trim() ? t("inbox.newTicket.err.contact") : null,
    related: f.relatedType !== NONE && !f.relatedId.trim() ? t("inbox.newTicket.err.related") : null,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const err = (k: keyof typeof errors) => (tried ? errors[k] : null);

  const submit = async () => {
    setTried(true);
    if (hasErrors) return;
    try {
      const r = await create.mutateAsync({
        subject: f.subject.trim(),
        body: f.body.trim(),
        name: f.name.trim(),
        ...(phone ? { phone } : {}),
        ...(f.email.trim() ? { email: f.email.trim() } : {}),
        priority: f.priority,
        channel: f.channel,
        assigneeId: f.assigneeId,
        tags: f.tags,
        related: f.relatedType !== NONE ? { type: f.relatedType, id: f.relatedId.trim() } : null,
      });
      toast.success(t("inbox.newTicket.created", { number: r.ticket.number }));
      navigate(`support/${r.ticket.id}`, { replace: true });
    } catch (e) {
      toast.error(describeError(e, t));
    }
  };

  return (
    <Page width="narrow">
      <PageHeading icon={LifeBuoyIcon} title={t("inbox.ticket.new")} description={t("inbox.newTicket.subtitle")} back={{ href: "support", label: t("inbox.ticket.title") }} />
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Section icon={UserRoundIcon} title={t("inbox.newTicket.customer")} description={t("inbox.newTicket.customerHint")}>
          <Field invalid={!!err("name")}>
            <FieldLabel>{t("inbox.newTicket.name")}</FieldLabel>
            <FieldControl>
              <Input value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={120} autoComplete="off" />
            </FieldControl>
            <FieldError>{err("name")}</FieldError>
          </Field>
          <FieldRow cols={2}>
            <Field invalid={!!err("phone") || !!err("contact")}>
              <FieldLabel>{t("inbox.newTicket.phone")}</FieldLabel>
              <FieldControl>
                <InputGroup>
                  <InputGroupAddon>
                    <PhoneIcon />
                  </InputGroupAddon>
                  <InputGroupInput type="tel" inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="98765 43210" />
                </InputGroup>
              </FieldControl>
              <FieldError>{err("phone") ?? err("contact")}</FieldError>
            </Field>
            <Field invalid={!!err("email")}>
              <FieldLabel optional={t("inbox.common.optional")}>{t("inbox.newTicket.email")}</FieldLabel>
              <FieldControl>
                <Input type="email" inputMode="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
              </FieldControl>
              <FieldError>{err("email")}</FieldError>
            </Field>
          </FieldRow>
        </Section>

        <Section icon={LifeBuoyIcon} title={t("inbox.newTicket.request")}>
          <Field invalid={!!err("subject")}>
            <FieldLabel>{t("inbox.newTicket.subject")}</FieldLabel>
            <FieldControl>
              <Input value={f.subject} onChange={(e) => set("subject", e.target.value)} maxLength={200} />
            </FieldControl>
            <FieldError>{err("subject")}</FieldError>
          </Field>
          <Field invalid={!!err("body")}>
            <FieldLabel>{t("inbox.newTicket.body")}</FieldLabel>
            <FieldControl>
              <AutoTextarea value={f.body} onChange={(e) => set("body", e.target.value)} maxLength={10_000} maxRows={12} className="min-h-28" />
            </FieldControl>
            <FieldHint>{t("inbox.newTicket.bodyHint")}</FieldHint>
            <FieldError>{err("body")}</FieldError>
          </Field>
          <FieldRow cols={3}>
            <Field>
              <FieldLabel>{t("inbox.newTicket.channel")}</FieldLabel>
              <Select value={f.channel} onValueChange={(v) => set("channel", v as TicketChannel)}>
                <FieldControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {TICKET_CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`inbox.ticket.channel.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t("inbox.ticket.priority")}</FieldLabel>
              <Select value={f.priority} onValueChange={(v) => set("priority", v as TicketPriority)}>
                <FieldControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {TICKET_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`inbox.ticket.priority.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t("inbox.ticket.assignee")}</FieldLabel>
              <FieldControl>
                <StaffSelect value={f.assigneeId} onChange={(v) => set("assigneeId", v)} />
              </FieldControl>
            </Field>
          </FieldRow>
          <Field>
            <FieldLabel htmlFor={null} optional={t("inbox.common.optional")}>
              {t("inbox.ticket.tags")}
            </FieldLabel>
            <TagEditor value={f.tags} onChange={(v) => set("tags", v)} label={t("inbox.ticket.tags")} placeholder={t("inbox.wa.addTag")} />
          </Field>
          {(ordersOn || invoicesOn) && (
            <FieldRow cols={2}>
              <Field>
                <FieldLabel optional={t("inbox.common.optional")}>{t("inbox.newTicket.relatedTo")}</FieldLabel>
                <Select value={f.relatedType} onValueChange={(v) => set("relatedType", v as typeof f.relatedType)}>
                  <FieldControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FieldControl>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("inbox.newTicket.relatedNone")}</SelectItem>
                    {ordersOn && <SelectItem value="order">{t("inbox.ticket.related.order")}</SelectItem>}
                    {invoicesOn && <SelectItem value="invoice">{t("inbox.ticket.related.invoice")}</SelectItem>}
                  </SelectContent>
                </Select>
              </Field>
              {f.relatedType !== NONE && (
                <Field invalid={!!err("related")}>
                  <FieldLabel>{t("inbox.newTicket.relatedId")}</FieldLabel>
                  <FieldControl>
                    <Input value={f.relatedId} onChange={(e) => set("relatedId", e.target.value)} maxLength={64} className="font-mono" />
                  </FieldControl>
                  <FieldHint>{t("inbox.newTicket.relatedIdHint")}</FieldHint>
                  <FieldError>{err("related")}</FieldError>
                </Field>
              )}
            </FieldRow>
          )}
        </Section>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="lg" onClick={() => navigate("support")}>
            {t("inbox.common.cancel")}
          </Button>
          <Button type="submit" size="lg" disabled={create.isPending}>
            {create.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            {t("inbox.newTicket.create")}
          </Button>
        </div>
      </form>
    </Page>
  );
}
