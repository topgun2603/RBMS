"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  FileTextIcon,
  HandCoinsIcon,
  HistoryIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SendIcon,
  TruckIcon,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, Button, cn, motion, Textarea, toast } from "@srirealtime/ui";
import { describeError, tOr, useI18n } from "@srirealtime/web";
import { PERMS, usePermissions } from "../../lib/access";
import { money } from "../../lib/format";
import { useOrderAction } from "../../lib/queries";
import type { Order, OrderEvent } from "../../lib/types";
import { Section } from "../bits";
import { ORDER_STATUS_META } from "../pills";

/** Everything that happened to the order, newest first; failed side effects stand out (invoice: with a retry). */
export function TimelineCard({ order }: { order: Order }) {
  const { t, formatDate } = useI18n();
  const { can } = usePermissions();
  const canManage = can(PERMS.manage);
  const action = useOrderAction();
  const events = React.useMemo(() => [...order.events].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [order.events]);
  const [note, setNote] = React.useState("");

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = note.trim();
    if (!message) return;
    try {
      await action.mutateAsync({ id: order.id, action: "notes", body: { message } });
      setNote("");
      toast.success(t("orders.timeline.noteAdded"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const retryInvoice = async () => {
    try {
      const o = await action.mutateAsync({ id: order.id, action: "invoice" });
      toast.success(o.invoiceNumber ? t("orders.invoice.created", { number: o.invoiceNumber }) : t("orders.invoice.retried"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Section icon={HistoryIcon} title={t("orders.timeline.title")} description={t("orders.timeline.hint")}>
      {canManage && (
        <form onSubmit={addNote} className="grid gap-2">
          <Textarea
            rows={2}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("orders.timeline.notePlaceholder")}
            aria-label={t("orders.timeline.addNote")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void addNote(e);
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{t("orders.timeline.noteInternal")}</p>
            <Button type="submit" size="sm" disabled={!note.trim() || (action.isPending && action.variables?.action === "notes")}>
              {action.isPending && action.variables?.action === "notes" ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
              {t("orders.timeline.addNote")}
            </Button>
          </div>
        </form>
      )}
      <ol className="relative grid gap-0">
        <AnimatePresence initial={false}>
          {events.map((e, i) => {
            const v = describe(e, t);
            const retry = v.failed && (e.data as { effect?: string }).effect === "invoice.create" && !order.invoiceId && canManage;
            return (
              <motion.li
                key={e.id}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative flex gap-3 pb-4 last:pb-0"
              >
                {i < events.length - 1 && <span aria-hidden className="absolute top-8 bottom-0 left-4 w-px bg-border" />}
                <span className={cn("icon-chip relative z-10 size-8 shrink-0 rounded-full", v.tone)}>
                  <v.icon className="size-4" />
                </span>
                <div
                  className={cn(
                    "min-w-0 flex-1 pt-0.5",
                    v.failed && "rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2",
                    v.note && "rounded-xl bg-warning/10 px-3 py-2 ring-1 ring-warning/25 ring-inset",
                  )}
                >
                  <p className={cn("text-sm font-medium", v.failed && "text-danger-ink")}>{v.title}</p>
                  {v.body && <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">{v.body}</p>}
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {formatDate(e.createdAt, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
                    {" · "}
                    {e.actorUserId ? t("orders.timeline.byStaff") : t("orders.timeline.bySystem")}
                  </p>
                  {retry && (
                    <Button size="sm" variant="outline" className="mt-2" disabled={action.isPending} onClick={() => void retryInvoice()}>
                      {action.isPending && action.variables?.action === "invoice" ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                      {t("orders.invoice.retry")}
                    </Button>
                  )}
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </Section>
  );
}

type T = ReturnType<typeof useI18n>["t"];

function describe(e: OrderEvent, t: T): { icon: LucideIcon; tone: string; title: string; body?: string | null; failed?: boolean; note?: boolean } {
  const d = e.data as { amount?: number; method?: string; kind?: string; effect?: string; error?: string; number?: string; path?: string[]; reason?: string };
  switch (e.type) {
    case "status": {
      const to = e.toStatus ?? "placed";
      const meta = ORDER_STATUS_META[to];
      if (!e.fromStatus) return { icon: meta.icon, tone: meta.ink, title: t("orders.timeline.placed", { channel: t(`orders.channel.${(e.data as { channel?: string }).channel ?? "manual"}`) }) };
      const skipped = Array.isArray(d.path) && d.path.length > 1;
      return {
        icon: meta.icon,
        tone: meta.ink,
        title: t("orders.timeline.status", { status: t(`orders.status.${to}`) }),
        body: [skipped ? t("orders.timeline.skipped", { steps: d.path!.slice(0, -1).map((s) => t(`orders.status.${s}`)).join(", ") }) : null, e.message].filter(Boolean).join("\n") || null,
      };
    }
    case "payment":
      return {
        icon: HandCoinsIcon,
        tone: "text-success-ink",
        title: t("orders.timeline.payment", { amount: money(d.amount ?? 0) }),
        body: d.method ? tOr(t, `orders.method.${d.method}`, d.method) : null,
      };
    case "refund":
      return { icon: RotateCcwIcon, tone: "text-danger-ink", title: t("orders.timeline.refund", { amount: money(d.amount ?? 0) }), body: d.reason ?? null };
    case "fulfillment":
      return { icon: TruckIcon, tone: "text-info-ink", title: t("orders.timeline.fulfillment"), body: e.message && e.message !== "Shipping details updated" ? e.message : null };
    default: {
      if (d.kind === "effect_failed") {
        const what = d.effect ? tOr(t, `orders.timeline.effect.${d.effect}`, d.effect) : "";
        return { icon: AlertTriangleIcon, tone: "text-danger-ink", title: t("orders.timeline.failed", { what }), body: d.error ?? null, failed: true };
      }
      if (d.kind === "invoice") return { icon: FileTextIcon, tone: "text-primary", title: t("orders.timeline.invoice", { number: d.number ?? "" }) };
      if (d.kind === "invoice_cancelled") return { icon: FileTextIcon, tone: "text-muted-foreground", title: t("orders.timeline.invoiceCancelled") };
      return { icon: MessageSquareTextIcon, tone: "text-warning-ink", title: t("orders.timeline.note"), body: e.message, note: true };
    }
  }
}
