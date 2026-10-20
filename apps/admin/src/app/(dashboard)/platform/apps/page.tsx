"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import {
  AppWindowIcon,
  Building2Icon,
  ChevronRightIcon,
  LayersIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  ToggleRightIcon,
  Trash2Icon,
} from "lucide-react";
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  PageHeader,
  Skeleton,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AppEditorSheet, type AppEditing } from "@/components/features/app-editor-sheet";
import { SolutionPresetSheet, Swatch } from "@/components/features/solution-preset-sheet";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { SuperAdminOnly } from "@/components/superadmin-only";
import { api } from "@/lib/api";
import { expandGrants, featureKeys, groupByModule, moduleLabel, useAppProfiles, useFeatureRegistry } from "@/lib/features";
import { describeError, useI18n } from "@/lib/i18n";
import { useSolutions, type Solution } from "@/lib/solutions";
import type { AppProfile, FeatureDef } from "@/lib/types";

const EASE = [0.16, 1, 0.3, 1] as const;

export default function PlatformAppsPage() {
  return (
    <SuperAdminOnly>
      <AppsAndSolutions />
    </SuperAdminOnly>
  );
}

/**
 * Platform → Apps & features. Pick an app (a product: Billing, Ecommerce, Pharmacy …); see what it offers and the
 * solutions (trades) built on it. Each solution has its own feature preset: the app's optional features a new shop of
 * that trade starts with. Plans and the shop owner narrow it further.
 */
function AppsAndSolutions() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const apps = useAppProfiles();
  const registry = useFeatureRegistry();
  const solutions = useSolutions();
  const [current, setCurrent] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<AppEditing>(null);
  const [deleting, setDeleting] = React.useState<AppProfile | null>(null);
  const [preset, setPreset] = React.useState<Solution | null>(null);

  const list = apps.data ?? [];
  const selected = list.find((p) => p.appId === current) ?? list[0] ?? null;
  const byApp = React.useMemo(() => {
    const m = new Map<string, Solution[]>();
    for (const s of solutions.data ?? []) m.set(s.appId, [...(m.get(s.appId) ?? []), s]);
    return m;
  }, [solutions.data]);

  const remove = useMutation({
    mutationFn: (p: AppProfile) => api.delete(`/features/apps/${encodeURIComponent(p.appId)}`, undefined, { tenant: null }),
    onSuccess: (_d, p) => {
      toast.success(t("admin.featuresUi.appDeleted", { name: p.name }));
      setCurrent(null);
      void qc.invalidateQueries({ queryKey: featureKeys.all });
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const newButton = (
    <Button variant="outline" onClick={() => setEditing({ mode: "create" })}>
      <PlusIcon /> {t("admin.featuresUi.newApp")}
    </Button>
  );

  return (
    <Page>
      <PageHeader eyebrow={t("admin.nav.platform")} title={t("admin.featuresUi.appsTitle")} description={t("admin.appsUi.subtitle")} actions={list.length ? newButton : undefined} />

      <LevelsStrip />

      {apps.isError ? (
        <QueryError error={apps.error} onRetry={() => void apps.refetch()} />
      ) : apps.isLoading ? (
        <div className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[4.5rem] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : !selected ? (
        <EmptyState icon={AppWindowIcon} title={t("admin.featuresUi.appsEmptyTitle")} description={t("admin.featuresUi.appsEmptyDescription")} action={newButton} />
      ) : (
        <div className="grid gap-5">
          <div role="tablist" aria-label={t("admin.appsUi.apps")} className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {list.map((p) => {
              const active = p.appId === selected.appId;
              const n = byApp.get(p.appId)?.length ?? 0;
              return (
                <button
                  key={p.appId}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCurrent(p.appId)}
                  className={cn(
                    "relative flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition-[border-color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    active ? "border-primary/50 shadow-elevated" : "hover:border-primary/30",
                  )}
                >
                  {active && <motion.span layoutId="sr-app-tab" className="absolute inset-0 rounded-xl ring-2 ring-primary/30" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                  <AppMark appId={p.appId} active={active} />
                  <span className="relative min-w-0">
                    <span className="block truncate font-heading font-semibold">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {n > 0 ? t("admin.appsUi.solutionCount", { count: n }) : t("admin.appsUi.noSolutionsShort")} · {t("admin.featuresUi.tenantCount", { count: p.tenantCount })}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <AppPanel
            key={selected.appId}
            profile={selected}
            defs={registry.data}
            solutions={byApp.get(selected.appId) ?? []}
            solutionsLoading={solutions.isLoading}
            onEdit={() => setEditing({ mode: "edit", profile: selected })}
            onDelete={() => setDeleting(selected)}
            onOpenSolution={setPreset}
          />
        </div>
      )}

      <AppEditorSheet editing={editing} existing={list} onClose={() => setEditing(null)} />
      <SolutionPresetSheet solution={preset} appName={list.find((p) => p.appId === preset?.appId)?.name ?? preset?.appId ?? ""} onClose={() => setPreset(null)} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("admin.featuresUi.deleteAppTitle", { name: deleting?.name ?? "" })}
        description={t("admin.featuresUi.deleteAppDescription", { count: deleting?.tenantCount ?? 0 })}
        confirmLabel={t("admin.common.delete")}
        onConfirm={() => (deleting ? remove.mutateAsync(deleting) : undefined)}
      />
    </Page>
  );
}

/** How a shop's features are decided: app → solution → plan → owner. */
function LevelsStrip() {
  const { t } = useI18n();
  const steps = [
    { icon: AppWindowIcon, title: t("admin.featuresUi.levelApp"), hint: t("admin.appsUi.levelAppHint") },
    { icon: SparklesIcon, title: t("admin.appsUi.levelSolution"), hint: t("admin.appsUi.levelSolutionHint") },
    { icon: LayersIcon, title: t("admin.featuresUi.levelPlan"), hint: t("admin.featuresUi.levelPlanHint") },
    { icon: ToggleRightIcon, title: t("admin.appsUi.levelOwner"), hint: t("admin.appsUi.levelOwnerHint") },
  ];
  return (
    <ol className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {steps.map((s, i) => (
        <li key={s.title} className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <s.icon className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              {s.title}
            </span>
            <span className="block text-xs leading-relaxed text-muted-foreground">{s.hint}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function AppMark({ appId, active, large }: { appId: string; active?: boolean; large?: boolean }) {
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-lg font-mono font-semibold transition-colors",
        large ? "size-12 text-base" : "size-10 text-sm",
        active || large ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
      )}
    >
      {appId.slice(0, 3)}
    </span>
  );
}

function AppPanel({
  profile,
  defs,
  solutions,
  solutionsLoading,
  onEdit,
  onDelete,
  onOpenSolution,
}: {
  profile: AppProfile;
  defs?: FeatureDef[];
  solutions: Solution[];
  solutionsLoading: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onOpenSolution: (s: Solution) => void;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion() ?? false;
  const selected = React.useMemo(() => (defs ? expandGrants(profile.features, defs).selected : null), [profile.features, defs]);
  const modules = React.useMemo(() => (defs ? groupByModule(defs) : []), [defs]);
  const offered = selected ? modules.filter((g) => g.items.some((i) => selected.has(i.key))) : [];
  const notOffered = selected ? modules.filter((g) => !g.items.some((i) => selected.has(i.key))) : [];

  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: EASE }}
      className="overflow-hidden rounded-2xl border border-card-ring bg-card shadow-elevated"
    >
      <header className="flex flex-wrap items-center gap-4 border-b p-5 sm:p-6">
        <AppMark appId={profile.appId} large />
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-xl font-semibold">{profile.name}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <code className="font-mono text-xs">{profile.appId}</code>
            <span aria-hidden>·</span>
            {selected && defs ? t("admin.appsUi.offers", { on: selected.size, total: defs.length, modules: offered.length }) : "…"}
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <Building2Icon className="size-3.5" />
              {t("admin.featuresUi.tenantCount", { count: profile.tenantCount })}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" onClick={onEdit}>
            <PencilIcon /> {t("admin.appsUi.editApp")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t("admin.common.actions")}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={onEdit}>
                <PencilIcon /> {t("admin.common.edit")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2Icon /> {t("admin.common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="grid gap-8 p-5 sm:p-6">
        <div className="grid gap-4">
          <div>
            <h3 className="font-heading text-base font-semibold">{t("admin.appsUi.solutionsTitle", { app: profile.name })}</h3>
            <p className="text-sm text-muted-foreground">{t("admin.appsUi.solutionsHint")}</p>
          </div>
          {solutionsLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-44 rounded-xl" />
              ))}
            </div>
          ) : solutions.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("admin.appsUi.noSolutions")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {solutions.map((s, i) => (
                <motion.div
                  key={s.id}
                  initial={reduced ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: EASE, delay: reduced ? 0 : Math.min(i, 8) * 0.03 }}
                >
                  <SolutionCard solution={s} onOpen={() => onOpenSolution(s)} />
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="font-heading text-base font-semibold">{t("admin.appsUi.offersTitle")}</h3>
              <p className="text-sm text-muted-foreground">{t("admin.appsUi.offersHint")}</p>
            </div>
            <Button variant="link" className="h-auto px-0" onClick={onEdit}>
              {t("admin.appsUi.change")} <ChevronRightIcon />
            </Button>
          </div>
          {!selected ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : (
            <>
              <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
                {offered.map((g) => {
                  const n = g.items.filter((i) => selected.has(i.key)).length;
                  const full = n === g.items.length;
                  return (
                    <li key={g.module} className="flex items-center justify-between gap-3 border-b border-dashed py-2 text-sm last:border-b-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={cn("size-1.5 shrink-0 rounded-full", full ? "bg-success" : "bg-warning")} aria-hidden />
                        <span className="truncate">{moduleLabel(t, g.module, g.items)}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{full ? t("admin.appsUi.all") : `${n} / ${g.items.length}`}</span>
                    </li>
                  );
                })}
              </ul>
              {notOffered.length > 0 && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground/70">{t("admin.appsUi.notOffered")}</span> {notOffered.map((g) => moduleLabel(t, g.module, g.items)).join(" · ")}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </motion.section>
  );
}

function SolutionCard({ solution: s, onOpen }: { solution: Solution; onOpen: () => void }) {
  const { t } = useI18n();
  const f = s.features;
  const pct = f && f.switchable ? Math.round((f.on / f.switchable) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full w-full flex-col overflow-hidden rounded-xl border bg-background text-left transition-[border-color,box-shadow,transform] outline-none hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevated focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:hover:translate-y-0"
    >
      <Swatch solution={s} className="h-16 w-full rounded-none ring-0" />
      <span className="flex flex-1 flex-col gap-1 p-4">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate font-heading font-semibold">{s.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{s.nameTa}</span>
          </span>
          {f?.customised && (
            <Badge variant="secondary" className="shrink-0 font-normal">
              {t("admin.appsUi.customised")}
            </Badge>
          )}
        </span>
        <span className="line-clamp-2 text-sm text-muted-foreground">{s.tagline}</span>
        <span className="mt-auto grid gap-1.5 pt-3">
          <span className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{f ? t("admin.appsUi.onCount", { on: f.on, total: f.switchable }) : ""}</span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Building2Icon className="size-3" />
              {t("admin.featuresUi.tenantCount", { count: s.shops })}
            </span>
          </span>
          <span className="h-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary/70 transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </span>
          <span className="flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {t("admin.appsUi.editPreset")} <ChevronRightIcon className="size-3.5" />
          </span>
        </span>
      </span>
    </button>
  );
}
