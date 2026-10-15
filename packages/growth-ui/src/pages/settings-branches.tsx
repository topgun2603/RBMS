"use client";

import * as React from "react";
import { stateName } from "@srirealtime/gst";
import { ArchiveRestoreIcon, BanIcon, CrownIcon, MapPinIcon, MoreHorizontalIcon, NetworkIcon, PackageIcon, PencilIcon, PlusIcon, ReceiptTextIcon } from "lucide-react";
import {
  AnimatePresence,
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  motion,
  Skeleton,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, Page, PageHeading, QueryError, SettingsNav, useI18n, useModuleNavigate, useQueryParams } from "@srirealtime/web";
import { NoAccess, useCan } from "../components/bits";
import { BranchSheet } from "../components/branches/branch-dialog";
import { StaffTab } from "../components/branches/staff-tab";
import { SummaryTab } from "../components/branches/summary-tab";
import { sampleBillNumber } from "../lib/branches";
import { todayIST } from "../lib/format";
import { useBranches, useLocations, useSetBranchActive } from "../lib/queries/branches";
import type { Branch } from "../lib/types";
import { GROWTH_PERMISSIONS } from "../module";

const TABS = ["branches", "staff", "summary"] as const;
type Tab = (typeof TABS)[number];

export default function BranchesSettingsPage() {
  const { t } = useI18n();
  const allowed = useCan(GROWTH_PERMISSIONS.branches);
  return (
    <Page className="max-w-6xl">
      <SettingsNav />
      <PageHeading icon={NetworkIcon} title={t("growth.branches.title")} description={t("growth.branches.subtitle")} />
      {allowed ? (
        <React.Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
          <Branches />
        </React.Suspense>
      ) : (
        <NoAccess permission={GROWTH_PERMISSIONS.branches} />
      )}
    </Page>
  );
}

function Branches() {
  const { t } = useI18n();
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const list = useBranches();
  const p = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(p ?? "") ? (p as Tab) : "branches";
  const setTab = (v: string) => navigate(v === "branches" ? "?" : `?tab=${v}`, { replace: true, scroll: false });
  const [editing, setEditing] = React.useState<Branch | null | "new">(null);

  if (list.isError) return <QueryError error={list.error} onRetry={() => void list.refetch()} />;
  const branches = list.data?.items ?? [];

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabsList aria-label={t("growth.branches.tabs")} className="h-11 w-full rounded-xl p-1 sm:w-max">
          {TABS.map((x) => (
            <TabsTrigger key={x} value={x} className="h-full flex-1 rounded-lg px-4">
              {t(`growth.branches.tab.${x}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {tab === "branches" && (
          <Button onClick={() => setEditing("new")}>
            <PlusIcon /> {t("growth.branches.add")}
          </Button>
        )}
      </div>
      <TabsContent value="branches">{tab === "branches" && <BranchList loading={list.isPending} branches={branches} onEdit={setEditing} />}</TabsContent>
      <TabsContent value="staff">{tab === "staff" && (list.isPending ? <Skeleton className="h-64 rounded-2xl" /> : <StaffTab branches={branches} />)}</TabsContent>
      <TabsContent value="summary">{tab === "summary" && <SummaryTab />}</TabsContent>
      <BranchSheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} branch={editing === "new" ? null : editing} branches={branches} />
    </Tabs>
  );
}

function BranchList({ loading, branches, onEdit }: { loading: boolean; branches: Branch[]; onEdit: (b: Branch | "new") => void }) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const locations = useLocations(branches.length > 0);
  const setActive = useSetBranchActive();
  const [closing, setClosing] = React.useState<Branch | null>(null);
  const today = todayIST();

  if (loading) {
    return (
      <div className="grid gap-3 md:grid-cols-2" aria-busy="true">
        {Array.from({ length: 2 }, (_, i) => (
          <Skeleton key={i} className="h-44 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (branches.length === 0) {
    return <EmptyState icon={NetworkIcon} title={t("growth.branches.emptyTitle")} description={t("growth.branches.emptyBody")} action={<Button onClick={() => onEdit("new")}><PlusIcon /> {t("growth.branches.add")}</Button>} />;
  }
  const sorted = [...branches].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.active) - Number(a.active) || a.code.localeCompare(b.code));
  const locName = (id: string | null) => (id ? (locations.data?.find((l) => l.id === id)?.name ?? t("growth.branches.linkedLocation")) : t("growth.branches.locationNone"));

  const reopen = async (b: Branch) => {
    try {
      await setActive.mutateAsync({ id: b.id, active: true });
      toast.success(t("growth.branches.reopened", { name: b.name }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <>
      <ul className="grid gap-3 md:grid-cols-2">
        <AnimatePresence initial={false}>
          {sorted.map((b, i) => (
            <motion.li
              key={b.id}
              layout={!reduced}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduced ? 0 : Math.min(i, 6) * 0.04 }}
            >
              <Card className={`h-full gap-3 px-4 py-4 ${b.active ? "" : "opacity-70"}`}>
                <div className="flex items-start gap-3">
                  <span className="icon-chip size-11 shrink-0 rounded-xl font-mono text-xs font-semibold text-primary">{b.code.slice(0, 4)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-heading font-semibold">{b.name}</h3>
                      {b.isDefault && (
                        <StatusPill tone="brand" icon={CrownIcon}>
                          {t("growth.branches.main")}
                        </StatusPill>
                      )}
                      {!b.active && (
                        <StatusPill tone="neutral" icon={BanIcon}>
                          {t("growth.branches.closed")}
                        </StatusPill>
                      )}
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">{b.code}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={t("growth.common.actions")}>
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem className="h-10" onSelect={() => onEdit(b)}>
                        <PencilIcon /> {t("growth.common.edit")}
                      </DropdownMenuItem>
                      {b.active && !b.isDefault && (
                        <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => setClosing(b)}>
                          <BanIcon /> {t("growth.branches.close")}
                        </DropdownMenuItem>
                      )}
                      {!b.active && (
                        <DropdownMenuItem className="h-10" onSelect={() => void reopen(b)}>
                          <ArchiveRestoreIcon /> {t("growth.branches.reopen")}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <dl className="grid gap-1.5 text-sm">
                  <div className="flex items-start gap-2">
                    <MapPinIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <dd className="min-w-0 text-muted-foreground">
                      {[b.address, b.city, b.pincode].filter(Boolean).join(", ") || t("growth.branches.noAddress")}
                      {b.stateCode && <span> · {stateName(b.stateCode) ?? b.stateCode}</span>}
                    </dd>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ReceiptTextIcon className="size-4 shrink-0 text-muted-foreground" />
                    <dt className="sr-only">{t("growth.branches.prefix")}</dt>
                    <dd className="font-mono text-xs">{sampleBillNumber(b.invoicePrefix, today)}</dd>
                    {b.gstin ? <Badge variant="outline" className="font-mono">{b.gstin}</Badge> : <span className="text-xs text-muted-foreground">{t("growth.branches.shopGstin")}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <PackageIcon className="size-4 shrink-0 text-muted-foreground" />
                    <dd className="text-xs text-muted-foreground">{locName(b.stockLocationId)}</dd>
                  </div>
                </dl>
              </Card>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <ConfirmDialog
        open={!!closing}
        onOpenChange={(o) => !o && setClosing(null)}
        title={t("growth.branches.closeTitle", { name: closing?.name ?? "" })}
        description={t("growth.branches.closeBody")}
        confirmLabel={t("growth.branches.close")}
        onConfirm={async () => {
          try {
            await setActive.mutateAsync({ id: closing!.id, active: false });
            toast.success(t("growth.branches.closedToast", { name: closing!.name }));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </>
  );
}
