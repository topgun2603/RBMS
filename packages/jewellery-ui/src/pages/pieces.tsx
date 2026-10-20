"use client";

import * as React from "react";
import { GemIcon, PlusIcon } from "lucide-react";
import { Button, ChipGroup, DataTable, DataTableToolbar, EmptyState, type DataTableColumn } from "@srirealtime/ui";
import { Page, PageHeading, useI18n, usePermission, useQueryParams, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { PieceStatusPill, useMetalLabel } from "../components/bits";
import { PieceDialog } from "../components/piece-dialog";
import { PieceSheet } from "../components/piece-sheet";
import { JEWELLERY_PERMISSIONS } from "../lib/access";
import { grams, money } from "../lib/format";
import { METAL_PURITIES, METALS } from "../lib/pricing";
import { jk } from "../lib/queries";
import { PIECE_STATUSES, type Piece } from "../lib/types";

export default function PiecesPage() {
  return (
    <React.Suspense fallback={null}>
      <Pieces />
    </React.Suspense>
  );
}

function Pieces() {
  const { t } = useI18n();
  const metalLabel = useMetalLabel();
  const canManage = usePermission(JEWELLERY_PERMISSIONS.manage);
  const params = useQueryParams();
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<Piece | null>(null);
  const [viewing, setViewing] = React.useState<Piece | null>(null);

  // Quick action: /jewellery/pieces?add=1 opens the add dialog.
  React.useEffect(() => {
    if (params.get("add") === "1" && canManage) setAdding(true);
  }, [params, canManage]);

  const filters = React.useMemo(
    () =>
      ({
        metal: { kind: "options", label: t("jewellery.piece.metal"), options: METALS.map((m) => ({ value: m, label: metalLabel(m) })) },
        purity: {
          kind: "options",
          label: t("jewellery.piece.purity"),
          options: METAL_PURITIES.map((mp) => ({ value: mp.purity, label: metalLabel(mp.metal, mp.purity) })),
        },
        status: { kind: "options", label: t("jewellery.pieces.filterStatus"), options: PIECE_STATUSES.map((s) => ({ value: s, label: t(`jewellery.pieceStatus.${s}`) })) },
      }) satisfies ServerFilterDefs,
    [t, metalLabel],
  );

  const columns = React.useMemo<DataTableColumn<Piece>[]>(
    () => [
      { id: "tag", header: t("jewellery.pieces.col.tag"), sortable: true, card: "subtitle", cell: (r) => r.tagNo ?? "—" },
      { id: "huid", header: t("jewellery.pieces.col.huid"), hideBelow: "md", cell: (r) => (r.huid ? <span className="font-mono text-meta">{r.huid}</span> : "—") },
      { id: "name", header: t("jewellery.pieces.col.item"), sortable: true, hideable: false, card: "title", cell: (r) => <span className="font-medium">{r.name}</span> },
      { id: "metal", header: t("jewellery.pieces.col.metal"), card: "meta", cell: (r) => metalLabel(r.metal, r.purity) },
      { id: "gross", header: t("jewellery.pieces.col.gross"), sortable: true, numeric: true, cell: (r) => grams(r.grossWeight) },
      { id: "net", header: t("jewellery.pieces.col.net"), sortable: true, numeric: true, card: "meta", cell: (r) => grams(r.netWeight) },
      {
        id: "making",
        header: t("jewellery.pieces.col.making"),
        numeric: true,
        hideBelow: "lg",
        cell: (r) =>
          r.makingType === "per_gram" ? t("jewellery.making.perGramValue", { amount: money(r.makingValue) }) : r.makingType === "percent" ? `${r.makingValue / 100}%` : money(r.makingValue),
      },
      { id: "status", header: t("jewellery.pieces.filterStatus"), defaultHidden: true, cell: (r) => <PieceStatusPill status={r.status} /> },
      { id: "price", header: t("jewellery.pieces.col.price"), sortable: true, numeric: true, card: "right", cell: (r) => (r.lastPrice != null ? money(r.lastPrice) : "—") },
    ],
    [t, metalLabel],
  );

  const st = useServerTable<Piece, typeof filters>({
    queryKey: jk.pieces,
    path: "/jewellery/pieces",
    columns,
    filters,
    defaultSort: "name",
    search: t("jewellery.pieces.search"),
    storageKey: "jewellery-pieces",
  });

  const status = st.filters.status;
  return (
    <Page>
      <PageHeading
        title={t("jewellery.pieces.title")}
        description={st.total !== undefined ? t("jewellery.pieces.count", { count: st.total }) : t("jewellery.pieces.description")}
        actions={
          canManage && (
            <Button onClick={() => setAdding(true)}>
              <PlusIcon /> {t("jewellery.piece.addTitle")}
            </Button>
          )
        }
      />
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("jewellery.pieces.filterStatus")}
            value={status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : ""}
            onChange={(v) => status.set(v === "all" ? [] : [v as (typeof PIECE_STATUSES)[number]])}
            options={[
              { value: "all", label: t("jewellery.common.all") },
              ...PIECE_STATUSES.map((v) => ({ value: v, label: t(`jewellery.pieceStatus.${v}`), meta: st.facets?.status?.[v] })),
            ]}
          />
        }
      />
      <DataTable
        table={st.table}
        onRowClick={(r) => setViewing(r)}
        empty={<EmptyState icon={GemIcon} title={t("jewellery.pieces.emptyTitle")} description={t("jewellery.pieces.emptyBody")} />}
      />
      <PieceDialog open={adding || !!editing} onOpenChange={(o) => {
          if (!o) {
            setAdding(false);
            setEditing(null);
          }
        }} piece={editing} />
      <PieceSheet
        piece={viewing}
        canManage={canManage}
        onOpenChange={(o) => !o && setViewing(null)}
        onEdit={(p) => {
          setViewing(null);
          setEditing(p);
        }}
      />
    </Page>
  );
}
