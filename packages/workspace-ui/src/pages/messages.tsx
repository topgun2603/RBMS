"use client";

import * as React from "react";
import { HistoryIcon, Loader2Icon, MessageSquareTextIcon, MoonIcon, SendIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { useMessagesSettings, useSaveMessagesSettings, useSendTestMessage, useSentMessages } from "../lib/queries";
import type { MessageChannelMode, MessageEventInfo, MessageGroup, MessagesSettings, SentMessage } from "../lib/types";

const GROUPS: MessageGroup[] = ["bookings", "jobcards", "memberships", "orders", "store"];
const MODES: MessageChannelMode[] = ["whatsapp", "sms", "both"];

/** The number setting shown under each group, with its allowed range. */
const GROUP_NUMBER: Partial<Record<MessageGroup, { key: "bookingReminderHours" | "membershipRenewalDays" | "abandonedCartHours"; label: string; min: number; max: number; hint?: string }>> = {
  bookings: { key: "bookingReminderHours", label: "workspace.messages.reminderHours", min: 1, max: 72 },
  memberships: { key: "membershipRenewalDays", label: "workspace.messages.renewalDays", min: 1, max: 30 },
  store: { key: "abandonedCartHours", label: "workspace.messages.cartHours", min: 1, max: 72, hint: "workspace.messages.cartHint" },
};

/** Settings → Customer messages: per event on/off and channel, the reminder timings, a test send and the sent log. */
export default function CustomerMessagesPage() {
  return (
    <div className="grid gap-section">
      <SettingsCard />
      <SentCard />
    </div>
  );
}

function SettingsCard() {
  const { t } = useI18n();
  const q = useMessagesSettings();
  const save = useSaveMessagesSettings();
  const [draft, setDraft] = React.useState<MessagesSettings | null>(null);
  const [numbers, setNumbers] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!q.data) return;
    setDraft(q.data.values);
    setNumbers({
      bookingReminderHours: String(q.data.values.bookingReminderHours),
      membershipRenewalDays: String(q.data.values.membershipRenewalDays),
      abandonedCartHours: String(q.data.values.abandonedCartHours),
    });
  }, [q.data]);

  if (q.isError) return <EmptyState icon={MessageSquareTextIcon} title={describeError(q.error, t)} />;
  if (q.isPending || !draft) return <Skeleton className="h-96" />;

  const events = q.data.events.filter((e) => e.available);
  const numberError = (g: MessageGroup) => {
    const spec = GROUP_NUMBER[g];
    if (!spec) return null;
    const n = Number(numbers[spec.key]);
    return Number.isInteger(n) && n >= spec.min && n <= spec.max ? null : t("workspace.messages.invalidNumber", { min: spec.min, max: spec.max });
  };
  const groups = GROUPS.filter((g) => events.some((e) => e.group === g));
  const invalid = groups.some((g) => numberError(g));
  const setEvent = (key: string, patch: Partial<MessagesSettings["events"][string]>) =>
    setDraft((d) => (d ? { ...d, events: { ...d.events, [key]: { ...d.events[key]!, ...patch } } } : d));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    try {
      await save.mutateAsync({
        language: draft.language,
        email: draft.email,
        events: draft.events,
        bookingReminderHours: Number(numbers.bookingReminderHours),
        membershipRenewalDays: Number(numbers.membershipRenewalDays),
        abandonedCartHours: Number(numbers.abandonedCartHours),
      });
      toast.success(t("workspace.messages.saved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-section">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareTextIcon className="size-4 text-primary" /> {t("workspace.messages.title")}
          </CardTitle>
          <CardDescription>{t("workspace.messages.intro")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <p className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-meta text-muted-foreground">
            <MoonIcon className="mt-0.5 size-4 shrink-0" />
            {t("workspace.messages.quiet", { from: q.data.quietHours.from, to: q.data.quietHours.to })}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>{t("workspace.messages.language")}</FieldLabel>
              <FieldControl>
                <Select value={draft.language} onValueChange={(v) => setDraft({ ...draft, language: v as "en" | "ta" })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">{t("workspace.messages.lang.en")}</SelectItem>
                    <SelectItem value="ta">{t("workspace.messages.lang.ta")}</SelectItem>
                  </SelectContent>
                </Select>
              </FieldControl>
              <FieldHint>{t("workspace.messages.languageHint")}</FieldHint>
            </Field>
            <Label className="flex items-start gap-3 self-center font-normal">
              <Switch checked={draft.email} onCheckedChange={(v) => setDraft({ ...draft, email: v })} />
              <span className="grid gap-0.5">
                <span className="font-medium">{t("workspace.messages.email")}</span>
                <span className="text-meta text-muted-foreground">{t("workspace.messages.emailHint")}</span>
              </span>
            </Label>
          </div>
          {groups.length === 0 && <EmptyState compact icon={MessageSquareTextIcon} title={t("workspace.messages.noEvents")} />}
        </CardContent>
      </Card>

      {groups.map((g) => {
        const spec = GROUP_NUMBER[g];
        const err = numberError(g);
        return (
          <Card key={g}>
            <CardHeader>
              <CardTitle>{t(`workspace.messages.group.${g}`)}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {spec && (
                <Field invalid={!!err} className="max-w-xs">
                  <FieldLabel>{t(spec.label)}</FieldLabel>
                  <FieldControl>
                    <Input inputMode="numeric" value={numbers[spec.key] ?? ""} onChange={(e) => setNumbers({ ...numbers, [spec.key]: e.target.value.replace(/\D/g, "") })} />
                  </FieldControl>
                  {spec.hint && <FieldHint>{t(spec.hint)}</FieldHint>}
                  <FieldError>{err}</FieldError>
                </Field>
              )}
              <ul className="grid gap-2">
                {events
                  .filter((e) => e.group === g)
                  .map((e) => (
                    <EventRow key={e.key} event={e} value={draft.events[e.key]!} onChange={(p) => setEvent(e.key, p)} />
                  ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}

      {groups.length > 0 && (
        <Button type="submit" className="justify-self-start" disabled={save.isPending || invalid}>
          {save.isPending && <Loader2Icon className="animate-spin" />}
          {t("workspace.messages.save")}
        </Button>
      )}
    </form>
  );
}

function EventRow({ event, value, onChange }: { event: MessageEventInfo; value: { on: boolean; channel: MessageChannelMode }; onChange: (p: Partial<{ on: boolean; channel: MessageChannelMode }>) => void }) {
  const { t } = useI18n();
  const test = useSendTestMessage();
  const label = t(`workspace.messages.event.${event.key}`);

  const sendTest = async () => {
    try {
      const { results } = await test.mutateAsync({ event: event.key });
      const ok = results.filter((r) => r.status === "sent" || r.status === "queued");
      if (ok.length) toast.success(t("workspace.messages.testSent", { to: ok.map((r) => r.to).join(", ") }));
      else if (results.some((r) => r.reason === "no_contact")) toast.error(t("workspace.messages.testNoContact"));
      else toast.error(t("workspace.messages.testFailed"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <li className="grid gap-2 rounded-md px-2 py-3 odd:bg-muted/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label className="flex min-w-0 items-center gap-3 font-normal">
          <Switch checked={value.on} onCheckedChange={(on) => onChange({ on })} aria-label={`${t("workspace.messages.on")}: ${label}`} />
          <span className="font-medium">{label}</span>
        </Label>
        <span className="flex flex-wrap items-center gap-2">
          <Select value={value.channel} onValueChange={(v) => onChange({ channel: v as MessageChannelMode })} disabled={!value.on}>
            <SelectTrigger className="w-44" aria-label={`${t("workspace.messages.channel")}: ${label}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {t(`workspace.messages.channel.${m}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="ghost" onClick={sendTest} disabled={test.isPending}>
            {test.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
            {t("workspace.messages.test")}
          </Button>
        </span>
      </div>
      {event.preview && (
        <p className="whitespace-pre-line break-words text-meta text-muted-foreground">
          <span className="sr-only">{t("workspace.messages.preview")}: </span>
          {event.preview}
        </p>
      )}
      {event.marketing && <p className="text-meta text-muted-foreground">{t("workspace.messages.marketing")}</p>}
    </li>
  );
}

const STATUS_TONE: Record<SentMessage["status"], "success" | "warning" | "danger"> = { sent: "success", queued: "warning", failed: "danger" };

function SentCard() {
  const { t, formatDate } = useI18n();
  const [limit, setLimit] = React.useState(50);
  const q = useSentMessages(limit);
  const items = q.data ?? [];
  const channelName = (c: SentMessage["channel"]) => (c === "whatsapp" ? "WhatsApp" : c === "sms" ? "SMS" : t(`workspace.messages.channelName.${c}`));
  const eventName = (key: string | null) => (key && t.has(`workspace.messages.event.${key}`) ? t(`workspace.messages.event.${key}`) : (key ?? "-"));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HistoryIcon className="size-4 text-primary" /> {t("workspace.messages.sentTitle")}
        </CardTitle>
        <CardDescription>{t("workspace.messages.sentBody")}</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isError ? (
          <EmptyState compact icon={HistoryIcon} title={describeError(q.error, t)} />
        ) : q.isPending ? (
          <Skeleton className="h-40" />
        ) : items.length === 0 ? (
          <EmptyState compact icon={HistoryIcon} title={t("workspace.messages.sentEmpty")} />
        ) : (
          <div className="grid gap-3">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("workspace.messages.col.time")}</TableHead>
                    <TableHead>{t("workspace.messages.col.message")}</TableHead>
                    <TableHead>{t("workspace.messages.col.channel")}</TableHead>
                    <TableHead>{t("workspace.messages.col.to")}</TableHead>
                    <TableHead>{t("workspace.messages.col.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-meta">{formatDate(m.sentAt ?? m.createdAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</TableCell>
                      <TableCell>{eventName(m.templateKey)}</TableCell>
                      <TableCell>{channelName(m.channel)}</TableCell>
                      <TableCell className="font-mono text-meta">{m.to}</TableCell>
                      <TableCell>
                        <StatusPill tone={STATUS_TONE[m.status]} title={m.error ?? undefined}>
                          {t(`workspace.messages.status.${m.status}`)}
                        </StatusPill>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {items.length >= limit && limit < 200 && (
              <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setLimit(Math.min(200, limit + 50))}>
                {t("workspace.common.loadMore")}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
