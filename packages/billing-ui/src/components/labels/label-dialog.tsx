"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, Loader2Icon, PlugZapIcon, PrinterIcon, ScaleIcon, SearchIcon, Trash2Icon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@rbms/ui";
import { api, describeError, useDebounced, useI18n, useOptionalSession } from "@rbms/web";
import {
  expandLabels,
  LABEL_CSS,
  LABEL_FIELDS,
  LABEL_PRESETS,
  LABEL_SIZES,
  labelInner,
  labelSheetHtml,
  labelSize,
  labelsPerPage,
  layoutLabel,
  pairPrinter,
  paginateLabels,
  printLabelsDirect,
  resolveConfig,
  type LabelDesign,
  type LabelField,
  type LabelItem,
  type PrinterConfig,
} from "@rbms/receipt-print";
import {
  designFromPreset,
  printHtml,
  qrMatrix,
  qrSvg,
  readLabelPrinter,
  readTamilNames,
  rememberTamilName,
  saveLabelPrinter,
  saveLocalDesign,
  saveShopDesign,
  sourceFromVariant,
  toLabelItem,
  unitTextFor,
  useLabelVariants,
  useStartDesign,
  type LabelPrinterSettings,
  type LabelSource,
} from "../../lib/labels";
import { resolvePrices } from "../../lib/queries-pricing";
import { usePriceLists, usePriceListsOn } from "../../lib/queries-pricing";
import { useSellerProfile } from "../../lib/queries";
import type { Item } from "../../lib/types";

/** Starting point of a line: an item (catalogue variant id) and how many labels. */
export interface LabelSeed {
  itemId: string;
  copies?: number;
  batch?: string | null;
  expiry?: string | null;
}

export interface LabelDialogProps {
  open: boolean;
  onClose: () => void;
  seeds: LabelSeed[];
  /** Short note under the title (e.g. "from purchase P-12"). */
  note?: string;
}

const FONT_SCALES = { small: 0.85, normal: 1, large: 1.2 } as const;
const fontKey = (scale: number): keyof typeof FONT_SCALES => (scale < 0.93 ? "small" : scale > 1.1 ? "large" : "normal");
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/**
 * The label designer: a preset and size, a switch per field, the type size, a live preview of the first label, and
 * printing to the browser (A4 sheets, rolls, Save as PDF) or straight to a TSPL roll label printer.
 */
export function LabelDialog(props: LabelDialogProps) {
  const { t } = useI18n();
  const profile = useSellerProfile();
  // The shop's default design is a setting only owners and admins can write.
  const canShop = !!useOptionalSession()?.canManage;
  const start = useStartDesign();
  const [design, setDesign] = React.useState<LabelDesign>(start.design);
  const touched = React.useRef(false);
  React.useEffect(() => {
    if (!touched.current && start.ready) setDesign(start.design);
  }, [start.design, start.ready]);
  const change = (fn: (d: LabelDesign) => LabelDesign) => {
    touched.current = true;
    setDesign(fn);
  };

  // ---- the lines
  const [extra, setExtra] = React.useState<LabelSeed[]>([]);
  React.useEffect(() => {
    if (props.open) setExtra([]);
  }, [props.open]);
  const seeds = React.useMemo(() => [...props.seeds, ...extra], [props.seeds, extra]);
  const ids = React.useMemo(() => [...new Set(seeds.map((s) => s.itemId))], [seeds]);
  const variants = useLabelVariants(ids, props.open);
  const [rows, setRows] = React.useState<LabelSource[]>([]);
  React.useEffect(() => {
    if (!props.open) return setRows([]);
    if (!variants.data) return;
    const names = readTamilNames();
    setRows((cur) => {
      const have = new Set(cur.map((r) => r.key));
      const next = [...cur.filter((r) => seeds.some((s, i) => `${s.itemId}#${i}` === r.key))];
      seeds.forEach((s, i) => {
        const key = `${s.itemId}#${i}`;
        const v = variants.data.find((x) => x.id === s.itemId);
        if (!v || have.has(key)) return;
        const row = sourceFromVariant(v, { copies: s.copies ?? 1, batch: s.batch, expiry: s.expiry, key });
        row.tamil = names[s.itemId] ?? "";
        next.push(row);
      });
      return next;
    });
  }, [props.open, variants.data, seeds]);
  const edit = (key: string, patch: Partial<LabelSource>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // ---- other options
  const [packDate, setPackDate] = React.useState(today());
  const [skip, setSkip] = React.useState(0);
  const [outline, setOutline] = React.useState(false);
  const listsOn = usePriceListsOn();
  const lists = usePriceLists(props.open && design.fields.listPrice);
  const [listId, setListId] = React.useState("");
  const listPrices = useQuery({
    queryKey: ["labels", "list-prices", listId, ids.join(",")],
    enabled: props.open && design.fields.listPrice && !!listId && ids.length > 0,
    queryFn: async () => {
      const r = await resolvePrices({ priceListId: listId, lines: ids.map((itemId) => ({ itemId, qty: 1 })) });
      return { name: r.list?.name ?? "", byItem: new Map(r.lines.filter((l) => l.source !== "item").map((l) => [l.itemId, l.price])) };
    },
  });

  const shop = React.useMemo(() => ({ name: profile.data?.legalName ?? "", care: profile.data?.phone || null }), [profile.data]);
  const items = React.useMemo<LabelItem[]>(
    () =>
      rows.map((r) =>
        toLabelItem(r, {
          packDate: design.fields.packDate ? packDate : null,
          listPrice: design.fields.listPrice && listPrices.data ? { price: listPrices.data.byItem.get(r.itemId) ?? null, name: listPrices.data.name } : null,
        }),
      ),
    [rows, design.fields.packDate, design.fields.listPrice, packDate, listPrices.data],
  );
  const size = labelSize(design.sizeId);
  const first = items[0];
  const layout = React.useMemo(() => (first ? layoutLabel(first, shop, design, size) : null), [first, shop, design, size]);
  const entries = rows.map((r, i) => ({ item: items[i]!, copies: r.copies }));
  const total = expandLabels(entries).length;
  const pageCount = paginateLabels(size, total, size.kind === "sheet" ? skip : 0).length;
  const perPage = labelsPerPage(size);

  const printBrowser = () => {
    const sheet = labelSheetHtml(expandLabels(entries), shop, design, { qrSvg, skip, outline, title: t("billing.labels.title") });
    printHtml(sheet.html);
  };

  // ---- the label printer
  const [printer, setPrinter] = React.useState<LabelPrinterSettings>(() => readLabelPrinter());
  React.useEffect(() => {
    if (props.open) setPrinter(readLabelPrinter());
  }, [props.open]);
  const [busy, setBusy] = React.useState<"print" | "connect" | "shop" | null>(null);
  const printerConfig = (p: LabelPrinterSettings): PrinterConfig =>
    resolveConfig({}, { transport: p.transport, baudRate: p.baudRate, bridgeUrl: p.bridgeUrl, bridgeToken: p.bridgeToken, bridgePrinter: p.bridgePrinter, deviceHint: p.deviceHint, deviceName: p.deviceName });
  const setP = (patch: Partial<LabelPrinterSettings>) =>
    setPrinter((p) => {
      const next = { ...p, ...patch };
      saveLabelPrinter(next);
      return next;
    });
  const connect = async () => {
    setBusy("connect");
    try {
      const res = await pairPrinter(printerConfig(printer), { interactive: true });
      if (res.ok) {
        if (res.paired) setP({ deviceHint: res.paired.id, deviceName: res.paired.name });
        toast.success(t("billing.labels.connected", { name: res.paired?.name ?? printer.transport }));
      } else toast.error(t("billing.labels.printFailed", { code: res.code }));
    } finally {
      setBusy(null);
    }
  };
  const printRoll = async () => {
    setBusy("print");
    try {
      const res = await printLabelsDirect(printerConfig(printer), expandLabels(entries), shop, design, {
        interactive: true,
        raster: { qr: qrMatrix },
        tspl: { gapMm: printer.gapMm, density: printer.density },
      });
      if (res.ok) toast.success(t("billing.labels.printed", { count: res.labels ?? total }));
      else toast.error(t("billing.labels.printFailed", { code: res.code }));
    } finally {
      setBusy(null);
    }
  };

  // ---- adding items
  const [q, setQ] = React.useState("");
  const dq = useDebounced(q, 250);
  const found = useQuery({
    queryKey: ["labels", "search", dq],
    enabled: props.open && dq.trim().length >= 2,
    queryFn: () => api.get<{ items: Item[] }>("/invoices/items", { q: dq.trim(), limit: 6 }).then((r) => r.items),
  });

  const saveHere = () => {
    saveLocalDesign(design);
    toast.success(t("billing.labels.savedHere"));
  };
  const saveShop = async () => {
    setBusy("shop");
    try {
      await saveShopDesign(design);
      toast.success(t("billing.labels.savedShop"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const legal = design.fields.mrp || design.fields.packDate || design.fields.expiry || design.fields.care;
  const scale = Math.min(2.4, 330 / (size.kind === "roll" ? size.across * size.widthMm : size.widthMm));
  const previewHtml = layout ? labelInner(layout, { qrSvg }) : "";

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("billing.labels.title")}</DialogTitle>
          <DialogDescription>{props.note ?? t("billing.labels.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="grid content-start gap-4">
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">{t("billing.labels.items")}</h3>
              {variants.isPending && ids.length > 0 ? (
                <Skeleton className="h-24 rounded-xl" />
              ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("billing.labels.noItems")}</p>
              ) : (
                <ul className="grid gap-2">
                  {rows.map((r) => (
                    <li key={r.key} className="grid gap-2 rounded-xl border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 break-words text-sm font-medium">{r.name}</p>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={999}
                          value={r.copies}
                          onChange={(e) => edit(r.key, { copies: Math.min(999, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
                          className="h-9 w-20 text-right tabular-nums"
                          aria-label={t("billing.labels.copies")}
                        />
                        <Button type="button" variant="ghost" size="icon" aria-label={t("billing.labels.remove")} onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}>
                          <Trash2Icon />
                        </Button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {design.fields.nameTa && (
                          <Field>
                            <FieldLabel>{t("billing.labels.tamilName")}</FieldLabel>
                            <Input
                              value={r.tamil}
                              lang="ta"
                              onChange={(e) => {
                                edit(r.key, { tamil: e.target.value });
                                rememberTamilName(r.itemId, e.target.value);
                              }}
                            />
                          </Field>
                        )}
                        {r.choices.length > 1 && (
                          <Field>
                            <FieldLabel>{t("billing.labels.unitChoice")}</FieldLabel>
                            <Select value={String(r.choice)} onValueChange={(v) => edit(r.key, { choice: Number(v), unitText: "" })}>
                              <SelectTrigger aria-label={t("billing.labels.unitChoice")}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {r.choices.map((c, i) => (
                                  <SelectItem key={c.unit} value={String(i)}>
                                    {unitTextFor({ choices: r.choices, choice: i, baseUnit: r.baseUnit })}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                        )}
                        {design.fields.unit && (
                          <Field>
                            <FieldLabel>{t("billing.labels.unitText")}</FieldLabel>
                            <Input value={r.unitText} placeholder={unitTextFor(r)} maxLength={24} onChange={(e) => edit(r.key, { unitText: e.target.value })} />
                          </Field>
                        )}
                        {design.fields.batch && (
                          <Field>
                            <FieldLabel>{t("billing.labels.batch")}</FieldLabel>
                            <Input value={r.batch} maxLength={20} onChange={(e) => edit(r.key, { batch: e.target.value })} />
                          </Field>
                        )}
                        {design.fields.expiry && (
                          <Field>
                            <FieldLabel>{t("billing.labels.expiry")}</FieldLabel>
                            <Input type="date" value={r.expiry} onChange={(e) => edit(r.key, { expiry: e.target.value })} />
                          </Field>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("billing.labels.searchItem")} className="pl-9" aria-label={t("billing.labels.addItem")} />
              </div>
              {(found.data ?? []).length > 0 && (
                <ul className="grid gap-1 rounded-xl border p-1">
                  {found.data!.map((it) => (
                    <li key={it.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                        onClick={() => {
                          setExtra((e) => [...e, { itemId: it.id, copies: 1 }]);
                          setQ("");
                        }}
                      >
                        <span className="truncate">{it.name}</span>
                        <span className="text-xs text-muted-foreground">{t("billing.labels.addItem")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {legal && (
              <Alert>
                <ScaleIcon />
                <AlertTitle>{t("billing.labels.legal.title")}</AlertTitle>
                <AlertDescription>{t("billing.labels.legal.body")}</AlertDescription>
              </Alert>
            )}

            <section className="grid gap-3 rounded-xl border p-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <PrinterIcon className="size-4" /> {t("billing.labels.printerTitle")}
              </h3>
              <p className="text-xs text-muted-foreground">{t("billing.labels.printerHint")}</p>
              <Field>
                <FieldLabel>{t("billing.labels.transport")}</FieldLabel>
                <Select value={printer.transport} onValueChange={(v) => setP({ transport: v as LabelPrinterSettings["transport"] })}>
                  <SelectTrigger aria-label={t("billing.labels.transport")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["none", "usb", "serial", "bridge"] as const).map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`billing.labels.transport.${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {printer.transport === "serial" && (
                <Field>
                  <FieldLabel>{t("billing.labels.baud")}</FieldLabel>
                  <Input type="number" value={printer.baudRate} onChange={(e) => setP({ baudRate: Number(e.target.value) || 9600 })} />
                </Field>
              )}
              {printer.transport === "bridge" && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <Field>
                    <FieldLabel>{t("billing.labels.bridgeUrl")}</FieldLabel>
                    <Input value={printer.bridgeUrl} onChange={(e) => setP({ bridgeUrl: e.target.value })} />
                  </Field>
                  <Field>
                    <FieldLabel>{t("billing.labels.bridgeToken")}</FieldLabel>
                    <Input type="password" value={printer.bridgeToken} autoComplete="off" onChange={(e) => setP({ bridgeToken: e.target.value })} />
                  </Field>
                  <Field>
                    <FieldLabel>{t("billing.labels.bridgePrinter")}</FieldLabel>
                    <Input value={printer.bridgePrinter} onChange={(e) => setP({ bridgePrinter: e.target.value })} />
                  </Field>
                </div>
              )}
              {printer.transport !== "none" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field>
                    <FieldLabel>{t("billing.labels.gap")}</FieldLabel>
                    <Input type="number" step="0.5" min={0} max={10} value={printer.gapMm} onChange={(e) => setP({ gapMm: Math.max(0, Number(e.target.value) || 0) })} />
                  </Field>
                  <Field>
                    <FieldLabel>{t("billing.labels.density")}</FieldLabel>
                    <Input type="number" min={0} max={15} value={printer.density} onChange={(e) => setP({ density: Math.min(15, Math.max(0, Number(e.target.value) || 0)) })} />
                  </Field>
                </div>
              )}
              {printer.transport !== "none" && printer.transport !== "bridge" && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void connect()} disabled={busy === "connect"}>
                    {busy === "connect" ? <Loader2Icon className="animate-spin" /> : <PlugZapIcon />} {t("billing.labels.connect")}
                  </Button>
                  {printer.deviceName && <span className="text-xs text-muted-foreground">{t("billing.labels.connected", { name: printer.deviceName })}</span>}
                </div>
              )}
            </section>
          </div>

          <div className="grid content-start gap-4">
            <Field>
              <FieldLabel>{t("billing.labels.size")}</FieldLabel>
              <Select value={design.sizeId} onValueChange={(v) => change((d) => ({ ...d, sizeId: v }))}>
                <SelectTrigger aria-label={t("billing.labels.size")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LABEL_SIZES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {t(`billing.labels.sizeName.${s.id}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t("billing.labels.preset")}</FieldLabel>
              <Select value={LABEL_PRESETS.find((p) => p.style === design.style && LABEL_FIELDS.every((f) => design.fields[f] === p.fields.includes(f)))?.id ?? ""} onValueChange={(v) => change((d) => ({ ...designFromPreset(v, d.sizeId), fontScale: d.fontScale, barcode: d.barcode, captions: d.captions }))}>
                <SelectTrigger aria-label={t("billing.labels.preset")}>
                  <SelectValue placeholder={t("billing.labels.preset")} />
                </SelectTrigger>
                <SelectContent>
                  {LABEL_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {t(`billing.labels.preset.${p.id}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid gap-1.5">
              <p className="text-sm font-medium">{t("billing.labels.fields")}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {LABEL_FIELDS.filter((f) => f !== "listPrice" || listsOn).map((f: LabelField) => (
                  <label key={f} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm">
                    <Checkbox checked={design.fields[f]} onCheckedChange={(v) => change((d) => ({ ...d, fields: { ...d.fields, [f]: v === true } }))} />
                    <span className="truncate">{t(`billing.labels.field.${f}`)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={null}>{t("billing.labels.fontSize")}</FieldLabel>
                <ToggleGroup type="single" variant="outline" size="sm" value={fontKey(design.fontScale)} onValueChange={(v) => v && change((d) => ({ ...d, fontScale: FONT_SCALES[v as keyof typeof FONT_SCALES] }))}>
                  {(["small", "normal", "large"] as const).map((k) => (
                    <ToggleGroupItem key={k} value={k} className="px-2.5 text-xs">
                      {t(`billing.labels.font.${k}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <Field>
                <FieldLabel>{t("billing.labels.barcodeType")}</FieldLabel>
                <Select value={design.barcode} onValueChange={(v) => change((d) => ({ ...d, barcode: v as LabelDesign["barcode"] }))}>
                  <SelectTrigger aria-label={t("billing.labels.barcodeType")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["auto", "code128", "ean13"] as const).map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`billing.labels.barcode.${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={null}>{t("billing.labels.captions")}</FieldLabel>
                <ToggleGroup type="single" variant="outline" size="sm" value={design.captions} onValueChange={(v) => v && change((d) => ({ ...d, captions: v as "en" | "ta" }))}>
                  <ToggleGroupItem value="en" className="px-2.5 text-xs">
                    English
                  </ToggleGroupItem>
                  <ToggleGroupItem value="ta" className="px-2.5 text-xs">
                    தமிழ்
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
              {design.fields.packDate && (
                <Field>
                  <FieldLabel>{t("billing.labels.packDate")}</FieldLabel>
                  <Input type="date" value={packDate} onChange={(e) => setPackDate(e.target.value)} />
                </Field>
              )}
              {design.fields.listPrice && listsOn && (
                <Field className="sm:col-span-2">
                  <FieldLabel>{t("billing.labels.priceList")}</FieldLabel>
                  <Select value={listId || "none"} onValueChange={(v) => setListId(v === "none" ? "" : v)}>
                    <SelectTrigger aria-label={t("billing.labels.priceList")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("billing.labels.priceList.none")}</SelectItem>
                      {(lists.data?.items ?? []).map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {size.kind === "sheet" && (
                <Field>
                  <FieldLabel>{t("billing.labels.skip")}</FieldLabel>
                  <Input type="number" min={0} max={perPage - 1} value={skip} onChange={(e) => setSkip(Math.min(perPage - 1, Math.max(0, Math.round(Number(e.target.value) || 0))))} />
                </Field>
              )}
            </div>
            {size.kind === "sheet" && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={outline} onCheckedChange={(v) => setOutline(v === true)} />
                {t("billing.labels.outline")}
              </label>
            )}

            <section className="grid gap-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">{t("billing.labels.preview")}</h3>
                <span className="text-xs text-muted-foreground">{t("billing.labels.previewHint")}</span>
              </div>
              <div className="overflow-hidden rounded-xl border bg-muted/40 p-3">
                {layout ? (
                  <div style={{ width: `${size.widthMm * scale}mm`, height: `${size.heightMm * scale}mm` }} className="relative mx-auto bg-white shadow-sm" aria-label={t("billing.labels.preview")}>
                    <style>{LABEL_CSS}</style>
                    <div style={{ width: `${size.widthMm}mm`, height: `${size.heightMm}mm`, transform: `scale(${scale})`, transformOrigin: "0 0", position: "relative", color: "#000", background: "#fff", fontFamily: '"Noto Sans Tamil","Noto Sans",system-ui,sans-serif' }} dangerouslySetInnerHTML={{ __html: previewHtml }} />
                  </div>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">{t("billing.labels.noItems")}</p>
                )}
              </div>
              {layout && layout.dropped.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-warning-ink">
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" /> {t("billing.labels.warn.dropped", { fields: layout.dropped.map((f) => t(`billing.labels.field.${f}`)).join(", ") })}
                </p>
              )}
              {layout && layout.missing.length > 0 && <p className="text-xs text-muted-foreground">{t("billing.labels.warn.missing", { fields: [...new Set(layout.missing)].map((f) => t(`billing.labels.field.${f}`)).join(", ") })}</p>}
              {layout?.barcodeSmall && <p className="text-xs text-warning-ink">{t("billing.labels.warn.barcodeSmall")}</p>}
            </section>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={saveHere}>
                {t("billing.labels.saveHere")}
              </Button>
              {canShop ? (
                <Button type="button" variant="outline" size="sm" onClick={() => void saveShop()} disabled={busy === "shop"}>
                  {busy === "shop" && <Loader2Icon className="animate-spin" />} {t("billing.labels.saveShop")}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">{t("billing.labels.shopOnly")}</span>
              )}
            </div>

            <div className="grid gap-2 border-t pt-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{t("billing.labels.total", { count: total })}</Badge>
                {total > 0 && <Badge variant="outline">{t(size.kind === "sheet" ? "billing.labels.pages" : "billing.labels.rows", { pages: pageCount })}</Badge>}
              </div>
              <Button type="button" size="lg" disabled={total === 0} onClick={printBrowser}>
                <PrinterIcon /> {t("billing.labels.printBrowser")}
              </Button>
              <Button type="button" variant="outline" size="lg" disabled={total === 0 || size.kind !== "roll" || printer.transport === "none" || busy === "print"} onClick={() => void printRoll()}>
                {busy === "print" ? <Loader2Icon className="animate-spin" /> : <PrinterIcon />} {t("billing.labels.printRoll")}
              </Button>
              {size.kind !== "roll" ? <p className="text-xs text-muted-foreground">{t("billing.labels.rollOnly")}</p> : printer.transport === "none" ? <p className="text-xs text-muted-foreground">{t("billing.labels.noPrinter")}</p> : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
