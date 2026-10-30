"use client";

import * as React from "react";
import { BarcodeIcon, DownloadIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button, cn, DataTable, DataTableToolbar, InputGroup, InputGroupAddon, InputGroupInput, StatusPill, toast, type DataTableColumn } from "@rbms/ui";
import { ConfirmDialog, describeError, Page, PageHeading, useI18n, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { ItemDialog } from "../components/item-dialog";
import { LabelDialog } from "../components/label-dialog";
import { paiseToInput, rupeesToPaise } from "../lib/format";
import { downloadPluFile, sk, useRemoveScaleItem, useSavePrices } from "../lib/queries";
import { SOLD_BY, type ScaleItem } from "../lib/types";

type Drafts = Record<string, { text: string; original: number | null; name: string }>;

const DraftsContext = React.createContext<{ drafts: Drafts; setDraft: (row: ScaleItem, text: string) => void }>({ drafts: {}, setDraft: () => {} });

/** The inline ₹ price box; typed prices live in the page (kept across pages) until "Save prices". */
function PriceCell({ row }: { row: ScaleItem }) {
  const { t } = useI18n();
  const { drafts, setDraft } = React.useContext(DraftsContext);
  if (row.missing) return <>—</>;
  const d = drafts[row.itemId];
  const text = d?.text ?? paiseToInput(row.price);
  const bad = d !== undefined && rupeesToPaise(d.text) === null;
  return (
    <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <InputGroup size="sm" className={cn("w-32", d && !bad && "border-primary")}>
        <InputGroupAddon>₹</InputGroupAddon>
        <InputGroupInput
          inputMode="decimal"
          aria-label={t("scales.items.priceFor", { name: row.name })}
          aria-invalid={bad || undefined}
          className="text-right tabular-nums"
          value={text}
          onChange={(e) => setDraft(row, e.target.value)}
        />
      </InputGroup>
      <span className="text-meta text-muted-foreground">/{row.unitLabel}</span>
    </span>
  );
}

export default function ItemsPage() {
  return (
    <React.Suspense fallback={null}>
      <Items />
    </React.Suspense>
  );
}

/** Weighed items with their PLU and today's price, edited inline and saved together. */
function Items() {
  const { t, formatDate } = useI18n();
  const savePrices = useSavePrices();
  const remove = useRemoveScaleItem();
  const [editing, setEditing] = React.useState<ScaleItem | null | undefined>(undefined);
  const [labelFor, setLabelFor] = React.useState<ScaleItem | null>(null);
  const [removing, setRemoving] = React.useState<ScaleItem | null>(null);
  const [downloading, setDownloading] = React.useState(false);
  /** Typed prices by item id (₹ text); only changed ones are kept. */
  const [drafts, setDrafts] = React.useState<Drafts>({});

  const setDraft = React.useCallback((row: ScaleItem, text: string) => {
    setDrafts((d) => {
      const next = { ...d };
      if (rupeesToPaise(text) === row.price && text.trim() !== "") delete next[row.itemId];
      else next[row.itemId] = { text, original: row.price, name: row.name };
      return next;
    });
  }, []);

  const changed = Object.entries(drafts);
  const invalid = changed.filter(([, d]) => rupeesToPaise(d.text) === null);

  const filters = React.useMemo(
    () =>
      ({
        soldBy: { kind: "options", label: t("scales.item.soldBy"), options: SOLD_BY.map((s) => ({ value: s, label: t(`scales.soldBy.${s}`) })) },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<ScaleItem>[]>(
    () => [
      { id: "plu", header: t("scales.items.col.plu"), sortable: true, hideable: false, width: "90px", card: "meta", cell: (r) => <span className="font-mono tabular-nums">{r.plu}</span> },
      {
        id: "name",
        header: t("scales.items.col.item"),
        sortable: true,
        hideable: false,
        card: "title",
        cell: (r) => (
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{r.name}</span>
            {!r.active && <StatusPill tone="neutral">{t("scales.items.off")}</StatusPill>}
            {r.missing && <StatusPill tone="danger">{t("scales.items.missing")}</StatusPill>}
          </span>
        ),
      },
      {
        id: "price",
        header: t("scales.items.col.price"),
        card: "right",
        width: "170px",
        cell: (r) => <PriceCell row={r} />,
      },
      { id: "soldBy", header: t("scales.item.soldBy"), hideBelow: "sm", card: "subtitle", cell: (r) => t(`scales.soldBy.${r.soldBy}`) },
      { id: "tare", header: t("scales.items.col.tare"), numeric: true, hideBelow: "md", cell: (r) => (r.soldBy === "weight" && r.tareGrams > 0 ? `${r.tareGrams} g` : "—") },
      {
        id: "priced",
        header: t("scales.items.col.priced"),
        sortable: true,
        hideBelow: "lg",
        cell: (r) => (r.priceUpdatedAt ? formatDate(r.priceUpdatedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—"),
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("scales.common.actions")}</span>,
        label: t("scales.common.actions"),
        hideable: false,
        align: "right",
        cell: (r) => (
          <span className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
            <Button size="icon" variant="ghost" className="size-8" aria-label={t("scales.label.title")} onClick={() => setLabelFor(r)}>
              <BarcodeIcon />
            </Button>
            <Button size="icon" variant="ghost" className="size-8" aria-label={t("scales.common.edit")} onClick={() => setEditing(r)}>
              <PencilIcon />
            </Button>
            <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label={t("scales.common.remove")} onClick={() => setRemoving(r)}>
              <Trash2Icon />
            </Button>
          </span>
        ),
      },
    ],
    [t, formatDate],
  );

  const st = useServerTable<ScaleItem, typeof filters>({
    queryKey: sk.items,
    path: "/scales/items",
    columns,
    filters,
    defaultSort: "plu",
    defaultPageSize: 50,
    pageSizes: [25, 50, 100, 200],
    search: t("scales.items.search"),
    storageKey: "scales-items",
    getRowId: (r) => r.itemId,
  });

  const submitPrices = async () => {
    if (invalid.length || changed.length === 0) return;
    try {
      const r = await savePrices.mutateAsync(changed.map(([itemId, d]) => ({ itemId, price: rupeesToPaise(d.text)! })));
      toast.success(t("scales.items.pricesSaved", { count: r.items.length }));
      setDrafts({});
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      await downloadPluFile();
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setDownloading(false);
    }
  };

  const draftsValue = React.useMemo(() => ({ drafts, setDraft }), [drafts, setDraft]);

  return (
    <DraftsContext.Provider value={draftsValue}>
      <Page>
        <PageHeading
          title={t("scales.items.title")}
          description={t("scales.items.description")}
          actions={
            <>
              <Button variant="outline" onClick={download} disabled={downloading}>
                {downloading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} {t("scales.items.download")}
              </Button>
              <Button onClick={() => setEditing(null)}>
                <PlusIcon /> {t("scales.items.add")}
              </Button>
            </>
          }
        />
        <DataTableToolbar table={st.table} />
        <DataTable table={st.table} />

        {changed.length > 0 && (
          <div className="sticky bottom-20 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/90 p-3 shadow-[0_8px_24px_-12px_oklch(0_0_0/0.25)] backdrop-blur-md md:bottom-4">
            <span className="text-sm">
              {invalid.length > 0 ? (
                <span className="text-destructive">{t("scales.items.pricesInvalid", { count: invalid.length })}</span>
              ) : (
                t("scales.items.pricesChanged", { count: changed.length })
              )}
            </span>
            <span className="flex gap-2">
              <Button variant="ghost" onClick={() => setDrafts({})} disabled={savePrices.isPending}>
                {t("scales.items.discard")}
              </Button>
              <Button onClick={submitPrices} disabled={savePrices.isPending || invalid.length > 0}>
                {savePrices.isPending && <Loader2Icon className="animate-spin" />}
                {t("scales.items.savePrices")}
              </Button>
            </span>
          </div>
        )}

        <ItemDialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} item={editing ?? null} />
        <LabelDialog item={labelFor} onOpenChange={(o) => !o && setLabelFor(null)} />
        <ConfirmDialog
          open={!!removing}
          onOpenChange={(o) => !o && setRemoving(null)}
          title={t("scales.items.removeTitle", { name: removing?.name ?? "" })}
          description={t("scales.items.removeBody", { plu: removing?.plu ?? "" })}
          confirmLabel={t("scales.common.remove")}
          onConfirm={async () => {
            if (!removing) return;
            try {
              await remove.mutateAsync(removing.itemId);
              setDrafts((d) => {
                const { [removing.itemId]: _gone, ...rest } = d;
                return rest;
              });
              toast.success(t("scales.items.removed", { name: removing.name }));
              setRemoving(null);
            } catch (err) {
              toast.error(describeError(err, t));
            }
          }}
        />
      </Page>
    </DraftsContext.Provider>
  );
}
