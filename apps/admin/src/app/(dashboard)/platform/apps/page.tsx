"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, useReducedMotion } from "motion/react";
import {
  AppWindowIcon,
  Building2Icon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  StoreIcon,
  ToggleRightIcon,
  Trash2Icon,
  LayersIcon,
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
  Input,
  PageHeader,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FeatureMatrix, FeatureMatrixSkeleton } from "@/components/features/feature-matrix";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { SuperAdminOnly } from "@/components/superadmin-only";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { api } from "@/lib/api";
import { expandGrants, explicitGrants, featureKeys, groupByModule, moduleLabel, useAppProfiles, useFeatureRegistry } from "@/lib/features";
import { describeError, useI18n } from "@/lib/i18n";
import type { AppProfile, FeatureDef } from "@/lib/types";

const EASE = [0.16, 1, 0.3, 1] as const;

const appSchema = z.object({
  appId: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9]{1,7}$/, "admin.featuresUi.appIdInvalid"),
  name: z.string().trim().min(1, "admin.validation.required").max(80, "admin.validation.tooLong"),
});
type AppValues = z.infer<typeof appSchema>;

type Editing = { mode: "create" } | { mode: "edit"; profile: AppProfile } | null;

export default function PlatformAppsPage() {
  return (
    <SuperAdminOnly>
      <AppsList />
    </SuperAdminOnly>
  );
}

function AppsList() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const reduced = useReducedMotion() ?? false;
  const apps = useAppProfiles();
  const registry = useFeatureRegistry();
  const [editing, setEditing] = React.useState<Editing>(null);
  const [deleting, setDeleting] = React.useState<AppProfile | null>(null);

  const remove = useMutation({
    mutationFn: (p: AppProfile) => api.delete(`/features/apps/${encodeURIComponent(p.appId)}`, undefined, { tenant: null }),
    onSuccess: (_d, p) => {
      toast.success(t("admin.featuresUi.appDeleted", { name: p.name }));
      void qc.invalidateQueries({ queryKey: featureKeys.all });
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const newButton = (
    <Button onClick={() => setEditing({ mode: "create" })}>
      <PlusIcon /> {t("admin.featuresUi.newApp")}
    </Button>
  );

  return (
    <Page>
      <PageHeader
        eyebrow={t("admin.nav.platform")}
        title={t("admin.featuresUi.appsTitle")}
        description={t("admin.featuresUi.appsSubtitle")}
        actions={apps.data?.length ? newButton : undefined}
      />

      <LevelsStrip />

      {apps.isError ? (
        <QueryError error={apps.error} onRetry={() => void apps.refetch()} />
      ) : apps.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : !apps.data?.length ? (
        <EmptyState
          icon={AppWindowIcon}
          title={t("admin.featuresUi.appsEmptyTitle")}
          description={t("admin.featuresUi.appsEmptyDescription")}
          action={newButton}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {apps.data.map((p, i) => (
            <motion.div
              key={p.appId}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: EASE, delay: reduced ? 0 : Math.min(i, 10) * 0.04 }}
            >
              <AppCard profile={p} defs={registry.data} onEdit={() => setEditing({ mode: "edit", profile: p })} onDelete={() => setDeleting(p)} />
            </motion.div>
          ))}
        </div>
      )}

      <AppEditorSheet editing={editing} existing={apps.data ?? []} onClose={() => setEditing(null)} />

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

/** "App → Plan → Shop switch" explainer above the list. */
function LevelsStrip() {
  const { t } = useI18n();
  const steps = [
    { icon: AppWindowIcon, title: t("admin.featuresUi.levelApp"), hint: t("admin.featuresUi.levelAppHint") },
    { icon: LayersIcon, title: t("admin.featuresUi.levelPlan"), hint: t("admin.featuresUi.levelPlanHint") },
    { icon: ToggleRightIcon, title: t("admin.featuresUi.levelShop"), hint: t("admin.featuresUi.levelShopHint") },
  ];
  return (
    <div className="mb-6 grid gap-2 rounded-xl border bg-muted/30 p-3 sm:grid-cols-3 sm:gap-0 sm:p-0">
      {steps.map((s, i) => (
        <div key={s.title} className={cn("flex items-start gap-3 sm:p-3", i > 0 && "sm:border-l")}>
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background text-primary ring-1 ring-border">
            <s.icon className="size-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-sm font-medium">
              <span className="text-xs text-muted-foreground tabular-nums">{i + 1}.</span> {s.title}
            </div>
            <p className="text-xs text-muted-foreground">{s.hint}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function AppCard({ profile, defs, onEdit, onDelete }: { profile: AppProfile; defs?: FeatureDef[]; onEdit: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  const selected = React.useMemo(() => (defs ? expandGrants(profile.features, defs).selected : null), [profile.features, defs]);
  const total = defs?.length ?? 0;
  const on = selected?.size ?? profile.features.length;
  const pct = total ? Math.round((on / total) * 100) : 0;
  const modules = React.useMemo(() => (defs ? groupByModule(defs) : []), [defs]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit();
        }
      }}
      className="group flex h-full cursor-pointer flex-col gap-4 rounded-2xl border border-card-ring bg-card p-5 text-card-foreground shadow-elevated transition-[box-shadow,border-color] outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-mono text-sm font-semibold text-primary">
          {profile.appId.slice(0, 3)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-heading font-semibold">{profile.name}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <code className="font-mono">{profile.appId}</code>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <Building2Icon className="size-3" />
              {t("admin.featuresUi.tenantCount", { count: profile.tenantCount })}
            </span>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("admin.common.actions")} onClick={(e) => e.stopPropagation()}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
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

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">{t("admin.featuresUi.featuresOn")}</span>
          <span className="font-medium tabular-nums">{total ? `${on} / ${total}` : on}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5, ease: EASE }}
          />
        </div>
      </div>

      {modules.length > 0 && selected && (
        <div className="mt-auto flex flex-wrap gap-1">
          {modules.map((g) => {
            const n = g.items.filter((i) => selected.has(i.key)).length;
            return (
              <Badge
                key={g.module}
                variant={n === g.items.length ? "secondary" : n > 0 ? "outline" : "muted"}
                className={cn("font-normal", n === 0 && "line-through opacity-70")}
              >
                {moduleLabel(t, g.module, g.items)}
                {n > 0 && n < g.items.length && <span className="tabular-nums text-muted-foreground">{`${n}/${g.items.length}`}</span>}
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AppEditorSheet({ editing, existing, onClose }: { editing: Editing; existing: AppProfile[]; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const registry = useFeatureRegistry();
  const defs = registry.data;
  const profile = editing?.mode === "edit" ? editing.profile : null;

  const form = useForm<AppValues>({ resolver: zodResolver(appSchema), defaultValues: { appId: "", name: "" } });
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dirtyFeatures, setDirtyFeatures] = React.useState(false);

  // Reset when the target changes (and once the registry arrives for a new profile).
  React.useEffect(() => {
    if (!editing) return;
    form.reset(profile ? { appId: profile.appId, name: profile.name } : { appId: "", name: "" });
    setDirtyFeatures(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the sheet target changes
  }, [editing]);
  React.useEffect(() => {
    if (!editing || !defs) return;
    // New profiles start with everything on; switch off what this product doesn't offer.
    setSelected(profile ? expandGrants(profile.features, defs).selected : new Set(defs.map((d) => d.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, defs]);

  const save = useMutation({
    mutationFn: (v: AppValues) =>
      api.put<AppProfile>(
        `/features/apps/${encodeURIComponent(v.appId)}`,
        { name: v.name, features: explicitGrants(selected, defs ?? []) },
        { tenant: null },
      ),
    onSuccess: (_r, v) => {
      toast.success(t("admin.featuresUi.appSaved", { name: v.name }));
      void qc.invalidateQueries({ queryKey: featureKeys.all });
      onClose();
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const submit = form.handleSubmit((v) => {
    if (!profile && existing.some((p) => p.appId === v.appId)) {
      form.setError("appId", { message: "admin.featuresUi.appIdTaken" });
      return;
    }
    save.mutate(v);
  });

  const total = defs?.length ?? 0;

  return (
    <Sheet open={editing !== null} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-3xl" closeLabel={t("admin.common.close")}>
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{profile ? t("admin.featuresUi.editApp") : t("admin.featuresUi.newApp")}</SheetTitle>
          <SheetDescription>{t("admin.featuresUi.editorHint")}</SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
              <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("admin.common.name")}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={t("admin.featuresUi.namePlaceholder")} autoFocus={!profile} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="appId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("admin.featuresUi.appId")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          onChange={(e) => field.onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                          readOnly={!!profile}
                          disabled={!!profile}
                          placeholder="EC"
                          className="font-mono uppercase"
                          autoCapitalize="characters"
                          spellCheck={false}
                        />
                      </FormControl>
                      <FormDescription>{t("admin.featuresUi.appIdHint")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">{t("admin.platform.features")}</h3>
                    <p className="text-xs text-muted-foreground">
                      {total ? t("admin.featuresUi.selectedCount", { on: selected.size, total }) : t("admin.featuresUi.matrixHint")}
                    </p>
                  </div>
                  {defs && defs.length > 0 && (
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelected(new Set(defs.map((d) => d.key)));
                          setDirtyFeatures(true);
                        }}
                      >
                        {t("admin.featuresUi.allOn")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelected(new Set());
                          setDirtyFeatures(true);
                        }}
                      >
                        {t("admin.featuresUi.allOff")}
                      </Button>
                    </div>
                  )}
                </div>
                {registry.isError ? (
                  <QueryError compact error={registry.error} onRetry={() => void registry.refetch()} />
                ) : !defs ? (
                  <FeatureMatrixSkeleton />
                ) : (
                  <FeatureMatrix
                    defs={defs}
                    value={selected}
                    disabled={save.isPending}
                    onChange={(next) => {
                      setSelected(next);
                      setDirtyFeatures(true);
                    }}
                  />
                )}
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t bg-background p-4 sm:flex-row sm:items-center">
              {profile && profile.tenantCount > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground sm:mr-auto">
                  <StoreIcon className="size-3.5" />
                  {t("admin.featuresUi.affects", { count: profile.tenantCount })}
                </p>
              )}
              <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row">
                <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
                  {t("admin.common.cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={save.isPending || !defs || (!!profile && !form.formState.isDirty && !dirtyFeatures)}
                >
                  {save.isPending && <Loader2Icon className="animate-spin" />}
                  {t("admin.common.save")}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
