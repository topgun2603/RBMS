"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ModuleLink, Page, PageHeading, useFeature, useI18n, useModuleNavigate, useServerTable, describeError, type ServerFilterDefs } from "@rbms/web";
import { ClipboardCheckIcon, Loader2Icon, PlusIcon } from "lucide-react";
import {
  Button,
  Checkbox,
  DataTable,
  DataTableToolbar,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  type DataTableColumn,
} from "@rbms/ui";
import { BoxIllustration } from "../components/illustrations";
import { AuditStatusPill } from "../components/inventory/audit-bits";
import { fmtStamp } from "../components/inventory/batch-bits";
import { useHasPermission } from "../lib/access";
import { money } from "../lib/format";
import { useCreateAudit } from "../lib/queries-stock";
import type { StockListResponse } from "../lib/types";
import type { AuditStatus, StockAudit } from "../lib/types-stock";

const STATUSES: AuditStatus[] = ["draft", "counting", "review", "approved", "cancelled"];

export default function StockAuditsPage() {
  return (
    <React.Suspense fallback={null}>
      <Audits />
    </React.Suspense>
  );
}

function Audits() {
  const { t } = useI18n();
  const canAudit = useHasPermission("inventory.audit");
  const [creating, setCreating] = React.useState(false);

  const filters = React.useMemo(
    () => ({ status: { kind: "options", label: t("billing.audit.col.status"), options: STATUSES.map((s) => ({ value: s, label: t(`billing.audit.status.${s}`) })) } }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<StockAudit>[]>(
    () => [
      {
        id: "number",
        header: t("billing.audit.col.number"),
        hideable: false,
        card: "title",
        cell: (r) => (
          <ModuleLink to={`stock-audit/${r.id}`} className="font-medium hover:underline">
            {r.number}
          </ModuleLink>
        ),
        cardCell: (r) => r.number,
      },
      { id: "title", header: t("billing.audit.col.title"), hideBelow: "md", card: "subtitle", cell: (r) => <span className="text-muted-foreground">{r.title || r.locationName}</span>, cardCell: (r) => r.title || r.locationName },
      { id: "location", header: t("billing.audit.col.location"), hideBelow: "lg", cell: (r) => r.locationName },
      { id: "date", header: t("billing.audit.col.date"), hideBelow: "md", cell: (r) => <span className="tabular-nums">{fmtStamp(r.createdAt)}</span> },
      { id: "lines", header: t("billing.audit.col.lines"), numeric: true, hideBelow: "lg", cell: (r) => `${r.totals.counted}/${r.totals.lines}` },
      {
        id: "variance",
        header: t("billing.audit.col.variance"),
        numeric: true,
        card: "meta",
        cell: (r) => (r.totals.varianceLines ? <span className={r.totals.netValue < 0 ? "text-danger-ink" : "text-success-ink"}>{money(r.totals.netValue)}</span> : <span className="text-muted-foreground">—</span>),
      },
      { id: "status", header: t("billing.audit.col.status"), card: "right", cell: (r) => <AuditStatusPill status={r.status} /> },
    ],
    [t],
  );

  const st = useServerTable<StockAudit, typeof filters>({
    queryKey: ["audits", "table"],
    path: "/inventory/audits",
    columns,
    filters,
    search: t("billing.audit.search"),
    storageKey: "billing-audits",
    getRowId: (r) => r.id,
  });

  return (
    <Page>
      <PageHeading
        icon={ClipboardCheckIcon}
        title={t("billing.audit.title")}
        description={t("billing.audit.subtitle")}
        actions={
          canAudit ? (
            <Button size="lg" onClick={() => setCreating(true)}>
              <PlusIcon /> {t("billing.audit.new")}
            </Button>
          ) : undefined
        }
      />
      <DataTableToolbar table={st.table} />
      <DataTable
        table={st.table}
        empty={
          st.table.activeFilterCount > 0 ? undefined : (
            <EmptyState
              className="border-0 bg-transparent"
              illustration={<BoxIllustration />}
              title={t("billing.audit.emptyTitle")}
              description={t("billing.audit.emptyBody")}
              action={
                canAudit ? (
                  <Button size="lg" onClick={() => setCreating(true)}>
                    <PlusIcon /> {t("billing.audit.new")}
                  </Button>
                ) : undefined
              }
            />
          )
        }
      />
      <NewAuditDialog open={creating} onOpenChange={setCreating} />
    </Page>
  );
}

/** Pick the place and (optionally) the categories to count; the system quantities are frozen when it is created. */
function NewAuditDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const go = useModuleNavigate();
  const create = useCreateAudit();
  const multiLocation = useFeature("inventory.locations");
  const locs = useQuery({
    queryKey: ["stock", "locations"],
    queryFn: () => api.get<{ items: { id: string; name: string; isDefault?: boolean }[] }>("/inventory/locations", { includeInactive: false }).then((r) => r.items),
    enabled: open && multiLocation,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const cats = useQuery({
    queryKey: ["stock", "categories"],
    queryFn: () => api.get<StockListResponse>("/inventory/stock", { limit: 1 }).then((r) => r.categories ?? []),
    enabled: open,
    staleTime: 60_000,
  });
  const [location, setLocation] = React.useState<string>("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [title, setTitle] = React.useState("");
  const [zero, setZero] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLocation("");
    setPicked([]);
    setTitle("");
    setZero(false);
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const a = await create.mutateAsync({ ...(location ? { locationId: location } : {}), categoryIds: picked, ...(title.trim() ? { title: title.trim() } : {}), includeZero: zero });
      toast.success(t("billing.audit.created", { number: a.number, count: a.totals.lines }));
      onOpenChange(false);
      go(`stock-audit/${a.id}`);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("billing.audit.new")}</DialogTitle>
          <DialogDescription>{t("billing.audit.newBody")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="na-title">
              {t("billing.audit.col.title")} <span className="font-normal text-muted-foreground">({t("billing.common.optional")})</span>
            </Label>
            <Input id="na-title" value={title} maxLength={120} placeholder={t("billing.audit.titlePlaceholder")} onChange={(e) => setTitle(e.target.value)} />
          </div>
          {multiLocation && (locs.data?.length ?? 0) > 1 && (
            <div className="grid gap-1.5">
              <Label htmlFor="na-loc">{t("billing.audit.col.location")}</Label>
              <Select value={location || "default"} onValueChange={(v) => setLocation(v === "default" ? "" : v)}>
                <SelectTrigger id="na-loc">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(locs.data ?? []).map((l) => (
                    <SelectItem key={l.id} value={l.isDefault ? "default" : l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {(cats.data?.length ?? 0) > 0 && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t("billing.audit.categories")}</legend>
              <p className="-mt-1 text-xs text-muted-foreground">{t("billing.audit.categoriesHint")}</p>
              <div className="grid max-h-44 gap-1 overflow-y-auto rounded-xl border p-2 sm:grid-cols-2">
                {(cats.data ?? []).map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
                    <Checkbox checked={picked.includes(c.id)} onCheckedChange={() => toggle(c.id)} />
                    <span className="truncate">{c.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={zero} onCheckedChange={(v) => setZero(v === true)} />
            {t("billing.audit.includeZero")}
          </label>
          <p className="rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{t("billing.audit.freezeNote")}</p>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={create.isPending}>
              {create.isPending && <Loader2Icon className="animate-spin" />}
              {t("billing.audit.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
