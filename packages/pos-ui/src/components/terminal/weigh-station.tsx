"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lineAmount } from "@srirealtime/gst";
import {
  CableIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  LockIcon,
  PackageSearchIcon,
  PlusIcon,
  PrinterIcon,
  ReceiptTextIcon,
  ScaleIcon,
  SearchIcon,
  Trash2Icon,
  UnplugIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  ChipGroup,
  cn,
  EmptyState,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, ThemeToggle, useDebounced, useI18n, useSession } from "@srirealtime/web";
import { POS_PERMISSIONS } from "../../lib/access";
import { findByCode, findByPlu, fromPosItem, searchCatalog } from "../../lib/catalog-sync";
import { money, moneyShort, timeShort } from "../../lib/format";
import { printReceiptInPage } from "../../lib/print";
import { BAUD_RATES, connectSerialScale, DEFAULT_BAUD, netWeight, parseManualWeight, serialSupported, type ScaleReading, type SerialScale } from "../../lib/scale-serial";
import { readJson, storageKey, writeJson } from "../../lib/storage";
import { cancelWeighTicket, createWeighTicket, listWeighTickets, newIdempotencyKey, type TicketLineInput } from "../../lib/terminal-api";
import type { PosItem, WeighTicket } from "../../lib/terminal-types";
import { useCounterKeys } from "../../lib/use-keys";
import { useCatalog } from "../catalog-provider";
import { useTerminal } from "./terminal-context";
import { Code128Svg, formatQty3, TicketPrint } from "./ticket-print";

interface PendingLine {
  key: string;
  item: PosItem;
  grossKg?: number;
  tareKg?: number;
  netKg?: number;
  qty?: number;
}

const ALL = "__all";
const ticketsKey = ["pos", "weigh", "tickets"] as const;

/**
 * Weighing station (terminal role `weighing`, feature pos.weighing, permission pos.weigh): pick an item (search,
 * category, PLU or scan; by-weight items first), read the weight from a Web Serial scale or type it, tare, add lines,
 * issue a ticket and print it with its Code 128 barcode. Today's tickets of this terminal with cancel.
 */
export function WeighStation() {
  const term = useTerminal()!;
  const { t } = useI18n();
  const { can } = useSession();
  const allowed = can(POS_PERMISSIONS.weigh);
  const { device, session } = term;
  const terminal = device.terminal;

  if (!allowed) {
    return (
      <Frame>
        <div className="grid flex-1 place-items-center p-6">
          <Alert variant="destructive" className="max-w-md">
            <LockIcon />
            <AlertTitle>{t("pos.weigh.noAccess")}</AlertTitle>
            <AlertDescription>{t("pos.weigh.noAccessBody", { name: session.user.name || t("pos.lock.unnamed") })}</AlertDescription>
          </Alert>
        </div>
      </Frame>
    );
  }
  return (
    <Frame>
      <Station paperMm={terminal.settings.printerWidth === 58 ? 58 : 80} />
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const term = useTerminal()!;
  const { t } = useI18n();
  const { device, session } = term;
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background text-foreground" data-pos-root="" data-pos-weigh="">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-2 sm:px-3">
        <span className="truncate text-sm font-semibold sm:text-base">{device.shop.name}</span>
        <Badge variant="muted" className="gap-1">
          <ScaleIcon /> {device.terminal.name}
        </Badge>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
            <UserRoundIcon className="size-3.5" /> {session.user.name || t("pos.lock.unnamed")}
          </span>
          <ThemeToggle />
          <Button type="button" variant="outline" size="sm" onClick={() => term.lock("locked")}>
            <LockIcon /> {t("pos.terminal.lock")}
          </Button>
        </div>
      </header>
      {children}
    </div>
  );
}

function Station({ paperMm }: { paperMm: 58 | 80 }) {
  const term = useTerminal()!;
  const { t } = useI18n();
  const qc = useQueryClient();
  const catalog = useCatalog();
  const terminal = term.device.terminal;

  const [query, setQuery] = React.useState("");
  const q = useDebounced(query.trim(), 120);
  const [category, setCategory] = React.useState<string>(ALL);
  const [plu, setPlu] = React.useState("");
  const [item, setItem] = React.useState<PosItem | null>(null);
  const [lines, setLines] = React.useState<PendingLine[]>([]);
  const [note, setNote] = React.useState("");
  const [tab, setTab] = React.useState("weigh");
  const [printing, setPrinting] = React.useState<WeighTicket | null>(null);
  const [lastTicket, setLastTicket] = React.useState<WeighTicket | null>(null);
  const [cancelling, setCancelling] = React.useState<WeighTicket | null>(null);

  // ---------------------------------------------------------------- scale
  const baudKey = storageKey("scale-baud", term.device.shop.slug, terminal.id);
  const [baud, setBaud] = React.useState<number>(DEFAULT_BAUD);
  React.useEffect(() => setBaud(readJson<number>(baudKey, DEFAULT_BAUD) || DEFAULT_BAUD), [baudKey]);
  const [reading, setReading] = React.useState<ScaleReading | null>(null);
  const [scale, setScale] = React.useState<SerialScale | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [manual, setManual] = React.useState("");
  const [tare, setTare] = React.useState(0);
  const [count, setCount] = React.useState("1");
  React.useEffect(() => () => void scale?.close(), [scale]);

  const connect = async () => {
    setConnecting(true);
    try {
      const s = await connectSerialScale(
        baud,
        (r) => setReading(r),
        (err) => {
          setScale(null);
          setReading(null);
          if (err) toast.error(t("pos.weigh.scale.lost"));
        },
      );
      setScale(s);
      toast.success(t("pos.weigh.scale.connected"));
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "NotFoundError")) toast.error(t("pos.weigh.scale.failed"));
    } finally {
      setConnecting(false);
    }
  };
  const disconnect = async () => {
    await scale?.close();
    setScale(null);
    setReading(null);
  };

  const manualKg = manual.trim() ? parseManualWeight(manual) : null;
  const gross = manual.trim() ? manualKg : (reading?.kg ?? null);
  const net = gross === null ? null : netWeight(gross, tare);
  const byWeight = item?.soldBy === "weight";
  const countQty = Number(count);
  const countOk = Number.isInteger(countQty) && countQty > 0 && countQty <= 9999;
  const canAdd = !!item && (byWeight ? net !== null : countOk);

  // ---------------------------------------------------------------- items
  const results = React.useMemo(() => {
    if (!catalog.index) return [];
    return searchCatalog(catalog.index, q, { categoryId: category === ALL ? null : category, weightFirst: true, limit: 120 });
  }, [catalog.index, q, category]);
  const usedCats = React.useMemo(() => new Set(catalog.index?.list.map((l) => l.item.categoryId).filter(Boolean)), [catalog.index]);
  const chips = [
    { value: ALL, label: t("pos.weigh.all") },
    ...catalog.categories.filter((c) => usedCats.has(c.id)).map((c) => ({ value: c.id, label: c.name })),
  ];

  const pick = (it: PosItem) => {
    setItem(it);
    setCount("1");
  };

  const pickByPlu = () => {
    if (!catalog.index || !plu.trim()) return;
    const it = findByPlu(catalog.index, plu) ?? findByCode(catalog.index, plu);
    if (it) {
      pick(it);
      setPlu("");
    } else toast.error(t("pos.weigh.pluNotFound", { plu }));
  };

  useCounterKeys({
    enabled: !cancelling,
    onScan: (code) => {
      const it = catalog.index ? findByCode(catalog.index, code) : null;
      if (it) pick(it);
      else toast.error(t("pos.scan.notFound", { code }));
    },
    onShortcut: () => undefined,
  });

  const addLine = () => {
    if (!item || !canAdd) return;
    const key = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    setLines((l) => [...l, byWeight ? { key, item, grossKg: gross!, tareKg: tare || undefined, netKg: net! } : { key, item, qty: countQty }]);
    setManual("");
    setCount("1");
  };

  const estimate = (l: PendingLine) => lineAmount(l.netKg ?? l.qty ?? 0, l.item.price);
  const estTotal = lines.reduce((s, l) => s + estimate(l), 0);

  // ---------------------------------------------------------------- tickets
  const tickets = useQuery({ queryKey: ticketsKey, queryFn: () => listWeighTickets({ limit: 100 }), staleTime: 15_000, refetchInterval: 60_000 });
  const issue = useMutation({
    mutationFn: (key: string) =>
      createWeighTicket(
        {
          lines: lines.map<TicketLineInput>((l) => (l.netKg !== undefined ? { itemId: l.item.itemId, weightKg: l.grossKg!, ...(l.tareKg ? { tareKg: l.tareKg } : {}) } : { itemId: l.item.itemId, qty: l.qty! })),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        key,
      ),
    onSuccess: (ticket) => {
      setLines([]);
      setNote("");
      setLastTicket(ticket);
      setPrinting(ticket);
      void qc.invalidateQueries({ queryKey: ticketsKey });
      toast.success(t("pos.weigh.issued", { code: ticket.code }));
    },
    onError: (err) => toast.error(describeError(err, t)),
  });
  const issueKey = React.useRef(newIdempotencyKey());

  // Print once the ticket is in the page.
  React.useEffect(() => {
    if (!printing) return;
    const id = window.setTimeout(() => printReceiptInPage(), 50);
    return () => window.clearTimeout(id);
  }, [printing]);

  const cancel = useMutation({
    mutationFn: (id: string) => cancelWeighTicket(id),
    onSuccess: (tk) => {
      void qc.invalidateQueries({ queryKey: ticketsKey });
      toast.success(t("pos.weigh.cancelled", { code: tk.code }));
    },
  });

  return (
    <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_420px]">
      {/* items */}
      <section className="flex min-h-0 flex-col gap-3 p-3">
        <div className="flex gap-2">
          <InputGroup size="lg" className="flex-1 bg-card">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              data-scan-target=""
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("pos.weigh.search")}
              aria-label={t("pos.weigh.search")}
              autoComplete="off"
              className="text-base"
            />
            {query && (
              <InputGroupAddon>
                <button type="button" className="rounded p-1 hover:bg-accent" aria-label={t("pos.common.clear")} onClick={() => setQuery("")}>
                  <XIcon />
                </button>
              </InputGroupAddon>
            )}
          </InputGroup>
          <form
            className="w-32"
            onSubmit={(e) => {
              e.preventDefault();
              pickByPlu();
            }}
          >
            <Input value={plu} onChange={(e) => setPlu(e.target.value)} inputMode="numeric" placeholder={t("pos.weigh.plu")} aria-label={t("pos.weigh.plu")} className="h-11 text-center font-mono" />
          </form>
        </div>
        {chips.length > 1 && <ChipGroup aria-label={t("pos.products.categories")} value={category} onChange={setCategory} options={chips} />}
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          {!catalog.ready ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : results.length === 0 ? (
            <EmptyState compact icon={PackageSearchIcon} title={q ? t("pos.products.noMatch", { q }) : t("pos.weigh.noItems")} />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {results.map((it) => (
                <button
                  key={it.itemId}
                  type="button"
                  onClick={() => pick(it)}
                  aria-pressed={item?.itemId === it.itemId}
                  className={cn(
                    "flex min-h-24 flex-col justify-between gap-2 rounded-xl border bg-card p-3 text-left shadow-xs transition-[border-color,background-color] outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    item?.itemId === it.itemId && "border-primary ring-2 ring-primary/25",
                  )}
                >
                  <span className="line-clamp-2 text-sm leading-snug font-medium">{fromPosItem(it).name}</span>
                  <span className="flex items-end justify-between gap-2">
                    <span className="text-base font-semibold tabular-nums">
                      {moneyShort(it.price)}
                      <span className="text-xs font-normal text-muted-foreground">/{it.unit}</span>
                    </span>
                    {it.plu && <span className="font-mono text-[0.6875rem] text-muted-foreground">PLU {Number(it.plu)}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* weigh + ticket */}
      <aside className="flex min-h-0 flex-col border-t bg-card/50 lg:border-t-0 lg:border-l">
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
          <TabsList className="m-3 mb-0 grid h-10 grid-cols-2">
            <TabsTrigger value="weigh">
              <ScaleIcon /> {t("pos.weigh.tab.weigh")}
            </TabsTrigger>
            <TabsTrigger value="today">
              <ReceiptTextIcon /> {t("pos.weigh.tab.today")}
              {tickets.data && <Badge variant="muted">{tickets.data.items.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="weigh" className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="grid gap-3">
              {/* scale reading */}
              <div className="rounded-2xl border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("pos.weigh.weight")}</span>
                  {scale ? (
                    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", reading?.stable === false ? "text-warning-ink" : "text-success-ink")} role="status">
                      {reading?.stable === false ? <CircleDashedIcon className="size-3.5 animate-spin" /> : <CheckCircle2Icon className="size-3.5" />}
                      {reading ? (reading.stable === false ? t("pos.weigh.scale.unstable") : t("pos.weigh.scale.stable")) : t("pos.weigh.scale.waiting")}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("pos.weigh.scale.manual")}</span>
                  )}
                </div>
                <p className="mt-1 text-right font-mono text-5xl font-semibold tabular-nums" aria-live="polite" data-weight="">
                  <span className={cn(gross === null && "text-muted-foreground/50")}>{formatQty3(gross ?? 0)}</span>
                  <span className="ml-1 text-xl text-muted-foreground">kg</span>
                </p>
                <div className="mt-2 flex items-center justify-between gap-2 text-sm text-muted-foreground tabular-nums">
                  <span>{t("pos.weigh.tare", { kg: formatQty3(tare) })}</span>
                  <span>{t("pos.weigh.net", { kg: net === null ? "—" : formatQty3(net) })}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" onClick={() => setTare(gross !== null && gross > 0 ? gross : 0)} disabled={gross === null || gross <= 0}>
                    {t("pos.weigh.setTare")}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setTare(0)} disabled={tare === 0}>
                    {t("pos.weigh.clearTare")}
                  </Button>
                </div>
                <Field className="mt-3">
                  <FieldLabel>{t("pos.weigh.manualLabel")}</FieldLabel>
                  <Input value={manual} onChange={(e) => setManual(e.target.value)} inputMode="decimal" placeholder="0.000" className="h-11 text-right font-mono text-lg" />
                  <FieldHint>{t("pos.weigh.manualHint")}</FieldHint>
                </Field>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {serialSupported() ? (
                    scale ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => void disconnect()}>
                        <UnplugIcon /> {t("pos.weigh.scale.disconnect")}
                      </Button>
                    ) : (
                      <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => void connect()} disabled={connecting}>
                          <CableIcon /> {t("pos.weigh.scale.connect")}
                        </Button>
                        <Select
                          value={String(baud)}
                          onValueChange={(v) => {
                            setBaud(Number(v));
                            writeJson(baudKey, Number(v));
                          }}
                        >
                          <SelectTrigger className="h-8 w-auto text-xs" aria-label={t("pos.weigh.scale.baud")}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {BAUD_RATES.map((b) => (
                              <SelectItem key={b} value={String(b)}>
                                {t("pos.weigh.scale.baudValue", { baud: b })}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </>
                    )
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("pos.weigh.scale.unsupported")}</p>
                  )}
                </div>
              </div>

              {/* selected item */}
              <div className="rounded-2xl border bg-card p-4">
                {item ? (
                  <div className="grid gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{fromPosItem(item).name}</p>
                        <p className="text-sm text-muted-foreground tabular-nums">
                          {money(item.price)} / {item.unit}
                        </p>
                      </div>
                      <Button type="button" variant="ghost" size="icon" aria-label={t("pos.common.clear")} onClick={() => setItem(null)}>
                        <XIcon />
                      </Button>
                    </div>
                    {!byWeight && (
                      <Field>
                        <FieldLabel>{t("pos.weigh.count")}</FieldLabel>
                        <Input value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="h-11 text-right font-mono text-lg" />
                      </Field>
                    )}
                    <p className="text-right text-lg font-semibold tabular-nums">
                      {byWeight ? (net !== null ? money(lineAmount(net, item.price)) : "—") : countOk ? money(lineAmount(countQty, item.price)) : "—"}
                    </p>
                    <Button type="button" size="lg" onClick={addLine} disabled={!canAdd}>
                      <PlusIcon /> {t("pos.weigh.addLine")}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("pos.weigh.pickItem")}</p>
                )}
              </div>

              {/* pending ticket */}
              <div className="rounded-2xl border bg-card p-4">
                <h2 className="mb-2 text-sm font-semibold">{t("pos.weigh.ticketLines")}</h2>
                {lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("pos.weigh.noLines")}</p>
                ) : (
                  <ul className="grid gap-1.5">
                    {lines.map((l) => (
                      <li key={l.key} className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{l.item.name}</span>
                          <span className="block text-xs text-muted-foreground tabular-nums">
                            {l.netKg !== undefined ? `${formatQty3(l.netKg)} kg${l.tareKg ? ` (${t("pos.weigh.tareShort", { kg: formatQty3(l.tareKg) })})` : ""}` : `${l.qty} ${l.item.unit}`}
                          </span>
                        </span>
                        <span className="font-semibold tabular-nums">{money(estimate(l))}</span>
                        <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label={t("pos.cart.remove", { name: l.item.name })} onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))}>
                          <Trash2Icon />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("pos.weigh.note")} aria-label={t("pos.weigh.note")} className="mt-3" maxLength={120} />
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("pos.weigh.estimate")}</span>
                  <span className="text-lg font-semibold tabular-nums">{money(estTotal)}</span>
                </div>
                <Button
                  type="button"
                  size="lg"
                  className="mt-3 h-14 w-full text-base"
                  disabled={lines.length === 0 || issue.isPending}
                  onClick={() => {
                    const key = issueKey.current;
                    issue.mutate(key, { onSettled: () => (issueKey.current = newIdempotencyKey()) });
                  }}
                >
                  <PrinterIcon /> {t("pos.weigh.issue")}
                </Button>
              </div>

              {lastTicket && (
                <div className="grid justify-items-center gap-2 rounded-2xl border bg-card p-4 text-center" data-last-ticket="">
                  <p className="text-sm text-muted-foreground">{t("pos.weigh.last")}</p>
                  <Code128Svg value={lastTicket.code} height={52} />
                  <p className="font-mono font-semibold tracking-widest">{lastTicket.code}</p>
                  <p className="text-lg font-semibold tabular-nums">{money(lastTicket.total)}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => printReceiptInPage()}>
                    <PrinterIcon /> {t("pos.weigh.reprint")}
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="today" className="min-h-0 flex-1 overflow-y-auto p-3">
            {tickets.isPending ? (
              <Skeleton className="h-40 rounded-xl" />
            ) : !tickets.data || tickets.data.items.length === 0 ? (
              <EmptyState compact icon={ReceiptTextIcon} title={t("pos.weigh.noTickets")} />
            ) : (
              <ul className="grid gap-1.5">
                {tickets.data.items.map((tk) => (
                  <li key={tk.id} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono font-medium">{tk.code}</span>
                      <span className="block text-xs text-muted-foreground">
                        {timeShort(tk.createdAt)} · {t("pos.weigh.lines", { count: tk.lines.length })}
                      </span>
                    </span>
                    <TicketStatus status={tk.status} />
                    <span className="w-20 text-right font-semibold tabular-nums">{money(tk.total)}</span>
                    <Button type="button" variant="ghost" size="icon" aria-label={t("pos.weigh.reprint")} onClick={() => setPrinting({ ...tk })}>
                      <PrinterIcon />
                    </Button>
                    {tk.status === "open" ? (
                      <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label={t("pos.weigh.cancel", { code: tk.code })} onClick={() => setCancelling(tk)}>
                        <XIcon />
                      </Button>
                    ) : (
                      <span className="size-9" aria-hidden />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </aside>

      <TicketPrint ticket={printing} shop={term.device.shop.name} terminal={terminal.name} paperMm={paperMm} />
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={t("pos.weigh.cancelTitle", { code: cancelling?.code ?? "" })}
        description={t("pos.weigh.cancelBody")}
        confirmLabel={t("pos.weigh.cancelConfirm")}
        onConfirm={async () => {
          if (!cancelling) return;
          try {
            await cancel.mutateAsync(cancelling.id);
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </div>
  );
}

function TicketStatus({ status }: { status: WeighTicket["status"] }) {
  const { t } = useI18n();
  return <Badge variant={status === "open" ? "success" : status === "used" ? "muted" : "warning"}>{t(`pos.weigh.status.${status}`)}</Badge>;
}
