"use client";

import * as React from "react";
import {
  BellRingIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  Loader2Icon,
  MessageCircleIcon,
  MessageSquareTextIcon,
  ReceiptIcon,
  SendIcon,
  Share2Icon,
} from "lucide-react";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Stagger,
  StaggerItem,
  toast,
} from "@srirealtime/ui";
import { normalizeTarget } from "../../lib/format";
import { describeError, useFeature, useI18n } from "@srirealtime/web";
import { useSendInvoice } from "../../lib/queries-v2";
import type { Invoice, InvoiceMessage, Payment } from "../../lib/types";

type Channel = "whatsapp" | "sms";

/**
 * "Send on WhatsApp" split button: sends through the shop's notifier (POST /invoices/:id/send).
 * The menu offers SMS and the manual wa.me share (`onManual`). Asks for a number when the bill's
 * customer has none, and offers the manual route when sending fails (e.g. notifier not set up).
 * When the shop has WhatsApp/SMS sending off (feature invoices.whatsapp) it is a plain "Share link" button.
 */
export function SendInvoiceButton({
  invoice,
  onManual,
  variant = "default",
  className,
  full,
}: {
  invoice: Invoice;
  onManual: () => void;
  variant?: "default" | "outline";
  className?: string;
  full?: boolean;
}) {
  const { t } = useI18n();
  const whatsapp = useFeature("invoices.whatsapp");
  const send = useSendInvoice();
  const [ask, setAsk] = React.useState<Channel | null>(null);
  const hasPhone = !!invoice.customer.phone?.trim();

  const run = async (channel: Channel, to?: string) => {
    try {
      await send.mutateAsync({ id: invoice.id, channel, to });
      toast.success(t(channel === "sms" ? "billing.send.sentSms" : "billing.send.sentWhatsapp", { name: invoice.customer.name }));
      return true;
    } catch (err) {
      toast.error(describeError(err, t), {
        description: t("billing.send.failedHint"),
        action: { label: t("billing.send.manual"), onClick: onManual },
        duration: 10_000,
      });
      return false;
    }
  };

  const start = (channel: Channel) => {
    if (!hasPhone) setAsk(channel);
    else void run(channel);
  };

  const busy = send.isPending;
  const outline = variant === "outline";

  if (!whatsapp) {
    return (
      <Button size="lg" variant={variant} className={cn("h-11", full && "w-full", className)} onClick={onManual}>
        <Share2Icon /> {t("billing.billDetail.shareLink")}
      </Button>
    );
  }

  return (
    <>
      <div className={cn("inline-flex", full && "w-full", className)}>
        <Button
          size="lg"
          variant={variant}
          className={cn("h-11 rounded-r-none", full && "flex-1")}
          disabled={busy}
          onClick={() => start("whatsapp")}
        >
          {busy ? <Loader2Icon className="animate-spin" /> : <MessageCircleIcon />}
          {t("billing.send.whatsapp")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="lg"
              variant={variant}
              disabled={busy}
              className={cn("h-11 rounded-l-none px-2.5", outline ? "border-l-0" : "border-l border-primary-foreground/25")}
              aria-label={t("billing.send.moreOptions")}
            >
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem className="h-11" onSelect={() => start("sms")}>
              <MessageSquareTextIcon /> {t("billing.send.sms")}
            </DropdownMenuItem>
            <DropdownMenuItem className="h-11" onSelect={onManual}>
              <ExternalLinkIcon /> {t("billing.send.manual")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AskNumberDialog
        channel={ask}
        name={invoice.customer.name}
        busy={busy}
        onOpenChange={(o) => !o && setAsk(null)}
        onSubmit={async (to) => {
          if (ask && (await run(ask, to))) setAsk(null);
        }}
      />
    </>
  );
}

function AskNumberDialog({
  channel,
  name,
  busy,
  onOpenChange,
  onSubmit,
}: {
  channel: Channel | null;
  name: string;
  busy: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (to: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [value, setValue] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => {
    if (channel) {
      setValue("");
      setTouched(false);
    }
  }, [channel]);
  const parsed = normalizeTarget(value);
  const invalid = parsed.kind !== "phone";

  return (
    <Dialog open={!!channel} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("billing.send.askTitle")}</DialogTitle>
          <DialogDescription>{t("billing.send.askBody", { name })}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!invalid) void onSubmit(parsed.target);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="send-to">{channel === "sms" ? t("billing.send.smsNumber") : t("billing.share.whatsappTo")}</Label>
            <Input
              id="send-to"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              placeholder="98765 43210"
              value={value}
              aria-invalid={touched && invalid}
              aria-describedby={touched && invalid ? "send-to-err" : undefined}
              onChange={(e) => setValue(e.target.value)}
            />
            {touched && invalid && <p id="send-to-err" className="text-xs text-destructive">{t("billing.validation.phone")}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="lg" disabled={busy} onClick={() => onOpenChange(false)}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
              {t("billing.send.send")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const TEMPLATES: Record<string, { key: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  "invoice.issued": { key: "billing.timeline.issued", icon: SendIcon, tone: "text-primary" },
  "invoice.reminder": { key: "billing.timeline.reminder", icon: BellRingIcon, tone: "text-warning-ink" },
  "payment.received": { key: "billing.timeline.receipt", icon: ReceiptIcon, tone: "text-success-ink" },
};

/** "5 min ago" / "yesterday" style label; falls back to the absolute date after a week. */
function useRelativeTime() {
  const { locale, formatDate } = useI18n();
  return React.useCallback(
    (iso: string) => {
      const d = new Date(iso);
      const diff = (d.getTime() - Date.now()) / 1000;
      const abs = Math.abs(diff);
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      if (Number.isNaN(d.getTime())) return iso;
      if (abs < 60) return rtf.format(Math.round(diff), "second");
      if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
      if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
      if (abs < 7 * 86_400) return rtf.format(Math.round(diff / 86_400), "day");
      return formatDate(d, { day: "numeric", month: "short", year: "numeric" });
    },
    [formatDate, locale],
  );
}

/** WhatsApp / SMS messages sent for a bill (newest first). */
export function MessagesTimeline({ messages }: { messages: InvoiceMessage[] | undefined }) {
  const { t, formatDate } = useI18n();
  const rel = useRelativeTime();
  const list = [...(messages ?? [])].sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));
  if (list.length === 0) {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
        <MessageCircleIcon className="mt-0.5 size-4 shrink-0" />
        {t("billing.timeline.empty")}
      </p>
    );
  }
  return (
    <Stagger className="relative grid gap-0">
      <span className="absolute top-3 bottom-3 left-[1.0625rem] w-px bg-border" aria-hidden />
      {list.map((m, i) => {
        const tpl = TEMPLATES[m.template];
        const Icon = tpl?.icon ?? MessageCircleIcon;
        const ChannelIcon = m.channel === "sms" ? MessageSquareTextIcon : MessageCircleIcon;
        return (
          <StaggerItem key={`${m.sentAt}-${i}`} className="relative flex items-start gap-3 py-2">
            <span className={cn("icon-chip relative size-9 rounded-full bg-card", tpl?.tone ?? "text-muted-foreground")}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{tpl ? t(tpl.key) : m.template}</p>
              <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <ChannelIcon className="size-3.5" aria-hidden />
                <span>{t(m.channel === "sms" ? "billing.timeline.viaSms" : "billing.timeline.viaWhatsapp")}</span>
                {m.to && <span className="font-mono tabular-nums">· {m.to}</span>}
              </p>
            </div>
            <time
              dateTime={m.sentAt}
              title={formatDate(m.sentAt, { dateStyle: "medium", timeStyle: "short" })}
              className="shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums"
            >
              {rel(m.sentAt)}
            </time>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

/**
 * The contract has no explicit "online" marker on invoice payments: treat a payment as online when the
 * API says so (`source`/`provider`) or the reference looks like a Razorpay / mock payment id.
 */
export function isOnlinePayment(p: Payment): boolean {
  return p.source === "online" || !!p.provider || /^(pay_|mock_)/.test(p.reference ?? "");
}
