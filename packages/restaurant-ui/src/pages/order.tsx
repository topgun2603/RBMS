"use client";

import * as React from "react";
import {
  ArrowRightLeftIcon,
  BanIcon,
  ChefHatIcon,
  Loader2Icon,
  MinusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  ReceiptIcon,
  SearchIcon,
  StickyNoteIcon,
  Trash2Icon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import {
  Button,
  Card,
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Skeleton,
  toast,
} from "@srirealtime/ui";
import { describeError, ModuleLink, Page, PageHeading, useDebounced, useI18n, useModuleNavigate, usePermission, useRouteParams } from "@srirealtime/web";
import { BillDialog } from "../components/bill-dialog";
import { InlineError, KotPill, ReasonDialog, VegMark } from "../components/bits";
import { RESTAURANT_PERMISSIONS } from "../lib/access";
import { elapsed, minutesSince, money, qty } from "../lib/format";
import { useFloor, useMenuSettings, useOrder, useOrderActions, useShopItems, type LineBody } from "../lib/queries";
import type { MenuSetting, Order, OrderLine, ShopItem } from "../lib/types";

interface Draft extends LineBody {
  key: string;
  name: string;
  rate: number;
}

/** One order: the menu to add from, the ticket (sent and new lines), send to kitchen, bill. */
export default function OrderPage() {
  const { id } = useRouteParams<{ id: string }>();
  const { t } = useI18n();
  const q = useOrder(id);
  if (q.isError) return <Page><InlineError title={describeError(q.error, t)} /></Page>;
  if (!q.data) return <Page><Skeleton className="h-96" /></Page>;
  return <OrderScreen order={q.data} />;
}

function OrderScreen({ order }: { order: Order }) {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const actions = useOrderActions(order.id);
  const canBill = usePermission(RESTAURANT_PERMISSIONS.bill);
  const menu = useMenuSettings();
  const flags = React.useMemo(() => new Map((menu.data?.items ?? []).map((m) => [m.itemId, m])), [menu.data]);
  const [draft, setDraft] = React.useState<Draft[]>([]);
  const [billing, setBilling] = React.useState(false);
  const [moving, setMoving] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [voiding, setVoiding] = React.useState<OrderLine | null>(null);
  const [noteFor, setNoteFor] = React.useState<string | null>(null);
  const open = order.status === "open";

  const add = (item: ShopItem) =>
    setDraft((d) => {
      const same = d.find((x) => x.itemId === item.id && !x.note);
      if (same) return d.map((x) => (x === same ? { ...x, qty: x.qty + 1 } : x));
      return [...d, { key: `${item.id}-${Date.now()}`, itemId: item.id, name: item.name, rate: item.rate, qty: 1, note: null }];
    });
  const setQty = (key: string, n: number) => setDraft((d) => (n <= 0 ? d.filter((x) => x.key !== key) : d.map((x) => (x.key === key ? { ...x, qty: n } : x))));

  const pendingServer = order.items.filter((l) => l.status === "pending");
  const toSend = draft.length + pendingServer.length;
  const send = async () => {
    try {
      if (draft.length) await actions.addItems.mutateAsync({ lines: draft.map(({ itemId, qty, note }) => ({ itemId, qty, note })), send: true });
      else await actions.sendKot.mutateAsync();
      setDraft([]);
      toast.success(t("restaurant.order.sent"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const title = order.tableName ? t("restaurant.order.tableTitle", { table: order.tableName, number: order.number }) : t("restaurant.order.otherTitle", { type: t(`restaurant.type.${order.type}`), number: order.number });
  const sent = order.items.filter((l) => l.status !== "pending");
  const draftTotal = draft.reduce((s, l) => s + Math.round(l.qty * l.rate), 0);

  return (
    <Page width="full">
      <PageHeading
        back={{ href: "", label: t("restaurant.nav.floor") }}
        title={title}
        description={[
          order.guests ? t("restaurant.order.guests", { count: order.guests }) : null,
          order.customerName,
          elapsed(minutesSince(order.createdAt)),
          order.status !== "open" ? t(`restaurant.order.status.${order.status}`) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          open && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t("restaurant.common.more")}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {order.type === "dine_in" && (
                  <DropdownMenuItem onSelect={() => setMoving(true)}>
                    <ArrowRightLeftIcon /> {t("restaurant.order.moveOrMerge")}
                  </DropdownMenuItem>
                )}
                {canBill && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onSelect={() => setCancelling(true)}>
                      <BanIcon /> {t("restaurant.order.cancelOrder")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />
      <div className={cn("grid gap-section", open && "lg:grid-cols-[minmax(0,1fr)_380px]")}>
        {open && <MenuPanel flags={flags} onAdd={add} />}
        <Card className="h-fit p-4 lg:sticky lg:top-4">
          <h2 className="mb-3 text-sm font-semibold">{t("restaurant.order.ticket")}</h2>
          {sent.length === 0 && draft.length === 0 && pendingServer.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("restaurant.order.empty")}</p>
          ) : (
            <ul className="grid gap-1">
              {sent.map((l) => {
                const kot = order.kots.find((k) => k.id === l.kotId);
                return (
                  <li key={l.id} className={cn("grid gap-0.5 rounded-md px-2 py-1.5", l.status === "cancelled" && "opacity-60")}>
                    <div className="flex items-start justify-between gap-2">
                      <span className={cn("min-w-0 text-sm", l.status === "cancelled" && "line-through")}>
                        <span className="font-semibold tabular-nums">{qty(l.qty)}×</span> {l.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <span className="text-sm tabular-nums">{money(l.amount)}</span>
                        {open && canBill && l.status === "sent" && (
                          <Button size="icon" variant="ghost" className="size-7" aria-label={t("restaurant.order.voidItem")} onClick={() => setVoiding(l)}>
                            <XIcon />
                          </Button>
                        )}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
                      {l.note && <span>“{l.note}”</span>}
                      {l.status === "cancelled" ? <span className="text-destructive">{l.cancelReason}</span> : kot && <KotPill status={kot.status} number={kot.number} />}
                    </div>
                  </li>
                );
              })}
              {pendingServer.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-2 rounded-md border border-dashed px-2 py-1.5">
                  <span className="min-w-0 text-sm">
                    <span className="font-semibold tabular-nums">{qty(l.qty)}×</span> {l.name}
                    {l.note && <span className="block text-meta text-muted-foreground">“{l.note}”</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="text-sm tabular-nums">{money(l.amount)}</span>
                    <Button size="icon" variant="ghost" className="size-7" aria-label={t("restaurant.common.remove")} onClick={() => actions.deleteLine.mutate(l.id)}>
                      <Trash2Icon />
                    </Button>
                  </span>
                </li>
              ))}
              {draft.map((l) => (
                <li key={l.key} className="grid gap-1 rounded-md bg-primary/5 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">{l.name}</span>
                    <span className="text-sm tabular-nums">{money(Math.round(l.qty * l.rate))}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="size-7" aria-label={t("restaurant.common.less")} onClick={() => setQty(l.key, l.qty - 1)}>
                        <MinusIcon />
                      </Button>
                      <span className="w-7 text-center text-sm font-semibold tabular-nums">{l.qty}</span>
                      <Button size="icon" variant="outline" className="size-7" aria-label={t("restaurant.common.more")} onClick={() => setQty(l.key, l.qty + 1)}>
                        <PlusIcon />
                      </Button>
                    </span>
                    {noteFor === l.key ? (
                      <Input
                        autoFocus
                        className="h-7 max-w-44 text-meta"
                        placeholder={t("restaurant.order.notePlaceholder")}
                        defaultValue={l.note ?? ""}
                        maxLength={200}
                        onBlur={(e) => {
                          const note = e.target.value.trim() || null;
                          setDraft((d) => d.map((x) => (x.key === l.key ? { ...x, note } : x)));
                          setNoteFor(null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      />
                    ) : (
                      <Button size="sm" variant="ghost" className="h-7 text-meta" onClick={() => setNoteFor(l.key)}>
                        <StickyNoteIcon /> {l.note ? `“${l.note}”` : t("restaurant.order.addNote")}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 grid gap-3 border-t pt-3">
            <p className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">{t("restaurant.order.totalBeforeGst")}</span>
              <span className="text-xl font-semibold tabular-nums">{money(order.amount + draftTotal)}</span>
            </p>
            {open && (
              <div className="grid grid-cols-2 gap-2">
                <Button size="lg" variant={toSend ? "default" : "outline"} disabled={!toSend || actions.addItems.isPending || actions.sendKot.isPending} onClick={send}>
                  {actions.addItems.isPending || actions.sendKot.isPending ? <Loader2Icon className="animate-spin" /> : <ChefHatIcon />}
                  {toSend ? t("restaurant.order.sendN", { count: toSend }) : t("restaurant.order.allSent")}
                </Button>
                {order.taxByOperator ? (
                  // GST paid by the platform (section 9(5)): no tax bill; it closes from Online orders.
                  <Button size="lg" variant="outline" asChild>
                    <ModuleLink to="online">{t("restaurant.online.title")}</ModuleLink>
                  </Button>
                ) : canBill && (
                  <Button size="lg" variant={toSend ? "outline" : "default"} disabled={draft.length > 0 || order.items.every((l) => l.status === "cancelled")} onClick={() => setBilling(true)}>
                    <ReceiptIcon /> {t("restaurant.order.bill")}
                  </Button>
                )}
              </div>
            )}
            {open && draft.length > 0 && canBill && <p className="text-meta text-muted-foreground">{t("restaurant.order.sendBeforeBill")}</p>}
            {order.taxByOperator && <p className="text-meta text-muted-foreground">{t("restaurant.online.noBill95")}</p>}
          </div>
        </Card>
      </div>
      {billing && <BillDialog open onOpenChange={(o) => !o && setBilling(false)} order={order} />}
      {moving && <MoveDialog order={order} onClose={() => setMoving(false)} />}
      <ReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t("restaurant.order.cancelOrder")}
        description={t("restaurant.order.cancelBody")}
        confirm={t("restaurant.order.cancelOrder")}
        onConfirm={async (reason) => {
          await actions.cancel.mutateAsync(reason);
          navigate("");
        }}
      />
      <ReasonDialog
        open={!!voiding}
        onOpenChange={(o) => !o && setVoiding(null)}
        title={t("restaurant.order.voidTitle", { item: voiding?.name ?? "" })}
        description={t("restaurant.order.voidBody")}
        confirm={t("restaurant.order.voidItem")}
        onConfirm={(reason) => actions.cancelLine.mutateAsync({ lineId: voiding!.id, reason })}
      />
    </Page>
  );
}

/** Search + a tap-to-add grid of menu items (sold-out items greyed out). */
function MenuPanel({ flags, onAdd }: { flags: Map<string, MenuSetting>; onAdd: (i: ShopItem) => void }) {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const term = useDebounced(q, 200);
  const items = useShopItems(term);
  const list = items.data?.items ?? [];
  return (
    <div className="grid content-start gap-3">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-11 pl-9" placeholder={t("restaurant.order.searchMenu")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {items.isPending ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={SearchIcon} title={t("restaurant.order.noItems")} />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {list.map((item) => {
            const f = flags.get(item.id);
            const soldOut = f?.available === false;
            return (
              <button
                key={item.id}
                type="button"
                disabled={soldOut}
                onClick={() => onAdd(item)}
                className="grid min-h-20 content-between gap-1 rounded-lg border bg-card p-3 text-left transition-colors outline-none hover:border-primary/60 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex items-start gap-1.5 text-sm font-medium leading-snug">
                  <VegMark veg={f?.veg} className="mt-0.5" />
                  <span className="line-clamp-2">{item.name}</span>
                </span>
                <span className="text-meta tabular-nums text-muted-foreground">{soldOut ? t("restaurant.menu.soldOut") : money(item.rate)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Move the order to a free table, or merge another table's order into this one. */
function MoveDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t } = useI18n();
  const floor = useFloor();
  const { update, merge } = useOrderActions(order.id);
  const [error, setError] = React.useState<string | null>(null);
  const tables = (floor.data?.tables ?? []).filter((x) => x.id !== order.tableId);
  const run = async (p: Promise<unknown>) => {
    setError(null);
    try {
      await p;
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t("restaurant.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("restaurant.order.moveOrMerge")}</DialogTitle>
        </DialogHeader>
        {error && <InlineError title={error} />}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {tables.map((x) => (
            <button
              key={x.id}
              type="button"
              disabled={update.isPending || merge.isPending}
              onClick={() => run(x.order ? merge.mutateAsync(x.order.id) : update.mutateAsync({ tableId: x.id }))}
              className={cn("grid gap-0.5 rounded-lg border p-2 text-left hover:bg-accent", x.order ? "border-primary/40 bg-primary/10" : "border-dashed")}
            >
              <span className="font-semibold">{x.name}</span>
              <span className="inline-flex items-center gap-1 text-meta text-muted-foreground">
                {x.order ? (
                  t("restaurant.order.mergeHere", { number: x.order.number })
                ) : (
                  <>
                    <UsersIcon className="size-3" /> {x.seats}
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
        <p className="text-meta text-muted-foreground">{t("restaurant.order.moveHint")}</p>
      </DialogContent>
    </Dialog>
  );
}
