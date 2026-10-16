"use client";

import * as React from "react";
import { GripVerticalIcon } from "lucide-react";
import { AnimatePresence, Card, cn, motion, Skeleton } from "@srirealtime/ui";
import { ModuleLink, QueryError, useI18n } from "@srirealtime/web";
import { money } from "../lib/format";
import { useOrderBoard } from "../lib/queries";
import { canDrop, KANBAN_COLUMNS } from "../lib/status";
import type { OrderListFilters, OrderStatus, OrderSummary } from "../lib/types";
import { PaymentPill, StatusDot } from "./pills";
import type { MovableOrder } from "./status-actions";

/**
 * Desktop board: one column per flow status; drag a card to a later column to move it (only moves the order machine
 * allows; the column lights up while it accepts the card). Keyboard users use the list's quick actions.
 */
export function KanbanBoard({
  filters,
  returnsEnabled,
  onMove,
  canMove,
}: {
  filters: OrderListFilters;
  returnsEnabled: boolean;
  onMove: (o: MovableOrder, to: OrderStatus) => void;
  canMove: (to: OrderStatus) => boolean;
}) {
  const { t, formatDate } = useI18n();
  const board = useOrderBoard(filters, true);
  const [dragging, setDragging] = React.useState<OrderSummary | null>(null);
  const [over, setOver] = React.useState<OrderStatus | null>(null);

  const byStatus = React.useMemo(() => {
    const m = new Map<OrderStatus, OrderSummary[]>(KANBAN_COLUMNS.map((s) => [s, []]));
    for (const o of board.data?.items ?? []) m.get(o.status)?.push(o);
    return m;
  }, [board.data]);

  if (board.isError) return <QueryError error={board.error} onRetry={() => void board.refetch()} />;

  const accepts = (to: OrderStatus) => !!dragging && canDrop(dragging.status, to, { returnsEnabled }) && canMove(to);

  return (
    <div className="grid grid-cols-5 gap-3" aria-label={t("orders.board.label")}>
      {KANBAN_COLUMNS.map((status) => {
        const items = byStatus.get(status) ?? [];
        const ok = accepts(status);
        const total = items.reduce((s, o) => s + o.total, 0);
        return (
          <section
            key={status}
            aria-label={t(`orders.status.${status}`)}
            onDragOver={(e) => {
              if (!ok) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (over !== status) setOver(status);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((s) => (s === status ? null : s));
            }}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              if (dragging && ok) onMove(dragging, status);
              setDragging(null);
            }}
            className={cn(
              "flex min-h-96 min-w-0 flex-col rounded-2xl border bg-muted/30 p-2 transition-[background-color,border-color,box-shadow]",
              dragging && ok && "border-primary/40 border-dashed bg-primary/5",
              over === status && ok && "bg-primary/10 shadow-[0_0_0_3px] shadow-primary/20",
              dragging && !ok && dragging.status !== status && "opacity-60",
            )}
          >
            <header className="mb-2 flex items-center gap-2 px-1.5 pt-1">
              <StatusDot status={status} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{t(`orders.status.${status}`)}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{money(total)}</p>
              </div>
              <span className="rounded-full bg-card px-2 text-xs font-medium tabular-nums ring-1 ring-border">{items.length}</span>
            </header>
            <div className="grid gap-2">
              {board.isPending ? (
                Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
              ) : items.length === 0 ? (
                <p className="px-2 py-6 text-center text-meta text-muted-foreground">{t("orders.board.empty")}</p>
              ) : (
                <AnimatePresence initial={false}>
                  {items.map((o) => (
                    <motion.div key={o.id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}>
                      <Card
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", o.id);
                          setDragging(o);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        className={cn(
                          "group cursor-grab gap-1.5 rounded-xl p-2.5 active:cursor-grabbing",
                          dragging?.id === o.id && "opacity-50 ring-2 ring-primary/40",
                        )}
                      >
                        <div className="flex items-center gap-1">
                          <GripVerticalIcon className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
                          <ModuleLink to={`orders/${o.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold outline-none hover:text-primary focus-visible:underline" draggable={false}>
                            {o.number}
                          </ModuleLink>
                        </div>
                        <p className="mt-0.5 truncate text-meta text-muted-foreground">{o.customerName}</p>
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-sm font-semibold tabular-nums">{money(o.total)}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(o.placedAt, { day: "numeric", month: "short" })}</span>
                        </div>
                        <PaymentPill status={o.paymentStatus} className="h-5 px-1.5 text-xs" />
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </section>
        );
      })}
      {(board.data?.total ?? 0) > (board.data?.items.length ?? 0) && (
        <p className="col-span-5 text-center text-meta text-muted-foreground">{t("orders.board.limited", { shown: board.data?.items.length ?? 0, total: board.data?.total ?? 0 })}</p>
      )}
    </div>
  );
}
