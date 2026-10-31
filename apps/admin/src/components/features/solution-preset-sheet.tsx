"use client";

import * as React from "react";
import { CheckIcon, Loader2Icon, RotateCcwIcon, SearchIcon, SparklesIcon, StoreIcon } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  cn,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Switch,
  toast,
} from "@rbms/ui";
import { QueryError } from "@/components/query-state";
import { buildGraph, featureLabel, groupByModule, moduleLabel, switchOff, switchOn } from "@/lib/features";
import { describeError, useI18n } from "@/lib/i18n";
import { useSaveSolutionPreset, useSolutionPreset, type Solution, type SolutionPreset } from "@/lib/solutions";

type Filter = "all" | "on" | "changed";

/**
 * A solution's feature preset: which of its app's optional features a new shop of this trade starts with. Features
 * are grouped by module with a plain description; anything that differs from the solution's default is marked.
 * Saving can also apply the preset now to the shops already running the solution.
 */
export function SolutionPresetSheet({ solution, appName, onClose }: { solution: Solution | null; appName: string; onClose: () => void }) {
  const { t } = useI18n();
  const preset = useSolutionPreset(solution?.id ?? null);
  return (
    <Sheet open={solution !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-2xl" closeLabel={t("admin.common.close")}>
        {solution && (
          <>
            <SheetHeader className="gap-3 border-b pr-12">
              <div className="flex items-center gap-3">
                <Swatch solution={solution} className="size-11 rounded-xl" />
                <div className="min-w-0">
                  <SheetTitle className="font-heading text-lg">{solution.name}</SheetTitle>
                  <SheetDescription className="truncate">
                    {solution.nameTa} · {t("admin.appsUi.onApp", { app: appName })}
                  </SheetDescription>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{t("admin.appsUi.presetHint")}</p>
            </SheetHeader>
            {preset.isError ? (
              <div className="p-6">
                <QueryError error={preset.error} onRetry={() => void preset.refetch()} />
              </div>
            ) : !preset.data ? (
              <div className="grid gap-3 p-6">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-24 rounded-xl" />
                ))}
              </div>
            ) : (
              <Editor key={`${solution.id}:${preset.dataUpdatedAt}`} solution={solution} preset={preset.data} appName={appName} onClose={onClose} />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Editor({ solution, preset, appName, onClose }: { solution: Solution; preset: SolutionPreset; appName: string; onClose: () => void }) {
  const { t } = useI18n();
  const save = useSaveSolutionPreset();
  const graph = React.useMemo(() => buildGraph(preset.switchable), [preset.switchable]);
  const [on, setOn] = React.useState(() => new Set(preset.on));
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [applyNow, setApplyNow] = React.useState(false);

  const saved = React.useMemo(() => new Set(preset.on), [preset.on]);
  const dirty = on.size !== saved.size || [...on].some((k) => !saved.has(k));
  const changedFromDefault = preset.switchable.filter((d) => on.has(d.key) !== d.byDefault).length;

  const toggle = (key: string, value: boolean) => {
    const label = (k: string) => featureLabel(t, preset.switchable.find((d) => d.key === k) ?? { key: k });
    if (value) {
      const { next, added } = switchOn(on, [key], graph);
      setOn(next);
      if (added.length) toast.message(t("admin.featuresUi.alsoOn", { features: added.map(label).join(", ") }));
    } else {
      const { next, removed } = switchOff(on, [key], graph);
      setOn(next);
      if (removed.length) toast.message(t("admin.featuresUi.alsoOff", { features: removed.map(label).join(", ") }));
    }
  };

  const q = query.trim().toLowerCase();
  const visible = preset.switchable.filter((d) => {
    if (filter === "on" && !on.has(d.key)) return false;
    if (filter === "changed" && on.has(d.key) === d.byDefault) return false;
    if (!q) return true;
    return [featureLabel(t, d), d.description, d.key].some((x) => x.toLowerCase().includes(q));
  });
  const groups = groupByModule(visible);
  const allGroups = React.useMemo(() => groupByModule(preset.switchable), [preset.switchable]);

  const submit = async (features: string[] | null) => {
    try {
      const r = await save.mutateAsync({ id: solution.id, features, applyToShops: applyNow });
      toast.success(
        r.applied > 0
          ? t("admin.appsUi.savedApplied", { name: solution.name, count: r.applied })
          : features === null
            ? t("admin.appsUi.reset", { name: solution.name })
            : t("admin.appsUi.saved", { name: solution.name }),
      );
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid gap-3 border-b bg-muted/30 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium tabular-nums">{t("admin.appsUi.onCount", { on: on.size, total: preset.switchable.length })}</span>
          {changedFromDefault > 0 ? (
            <Badge variant="warning" className="font-normal">
              {t("admin.appsUi.changedCount", { count: changedFromDefault })}
            </Badge>
          ) : (
            <Badge variant="muted" className="font-normal">
              <SparklesIcon className="size-3" /> {t("admin.appsUi.asDefault")}
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("admin.appsUi.search")} className="pl-9" aria-label={t("admin.appsUi.search")} />
          </div>
          <div role="radiogroup" aria-label={t("admin.appsUi.show")} className="inline-flex shrink-0 rounded-lg border bg-background p-0.5">
            {(["all", "on", "changed"] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  filter === f ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`admin.appsUi.filter.${f}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
        {groups.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{t("admin.appsUi.noMatch")}</p>}
        {groups.map((g) => {
          const all = allGroups.find((x) => x.module === g.module)?.items ?? g.items;
          const n = all.filter((d) => on.has(d.key)).length;
          return (
            <section key={g.module} className="overflow-hidden rounded-xl border bg-card">
              <header className="flex items-center justify-between gap-2 border-b bg-muted/20 px-4 py-2.5">
                <h3 className="text-sm font-semibold">{moduleLabel(t, g.module, all)}</h3>
                <span className="text-xs text-muted-foreground tabular-nums">{t("admin.featuresUi.countOn", { on: n, total: all.length })}</span>
              </header>
              <ul className="divide-y">
                {g.items.map((d) => {
                  const isOn = on.has(d.key);
                  const changed = isOn !== d.byDefault;
                  const id = `preset-${d.key}`;
                  return (
                    <li key={d.key} className="flex items-start gap-4 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {featureLabel(t, d)}
                          {changed && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-normal text-warning-ink">
                              <span className="size-1.5 rounded-full bg-warning" aria-hidden />
                              {t(d.byDefault ? "admin.appsUi.defaultOn" : "admin.appsUi.defaultOff")}
                            </span>
                          )}
                        </label>
                        {d.description && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{d.description}</p>}
                      </div>
                      <Switch id={id} checked={isOn} onCheckedChange={(v) => toggle(d.key, v)} disabled={save.isPending} className="mt-0.5" />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        {preset.included.length > 0 && filter === "all" && !q && (
          <details className="group rounded-xl border border-dashed px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium">
              <span className="flex items-center gap-2">
                <CheckIcon className="size-4 text-success" />
                {t("admin.appsUi.included", { count: preset.included.length, app: appName })}
              </span>
              <span className="text-xs text-muted-foreground group-open:hidden">{t("admin.appsUi.showList")}</span>
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">{t("admin.appsUi.includedHint")}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {preset.included.map((d) => (
                <Badge key={d.key} variant="muted" className="font-normal">
                  {featureLabel(t, d)}
                </Badge>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="grid gap-3 border-t bg-background p-4 sm:px-6">
        {solution.shops > 0 && (
          <div className="flex items-start gap-2.5">
            <Checkbox id="apply-now" checked={applyNow} onCheckedChange={(v) => setApplyNow(v === true)} className="mt-0.5" />
            <Label htmlFor="apply-now" className="grid gap-0.5 font-normal">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <StoreIcon className="size-3.5" /> {t("admin.appsUi.applyNow", { count: solution.shops })}
              </span>
              <span className="text-xs text-muted-foreground">{t("admin.appsUi.applyNowHint")}</span>
            </Label>
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          {(preset.customised || changedFromDefault > 0) && (
            <Button type="button" variant="ghost" className="sm:mr-auto" disabled={save.isPending} onClick={() => void submit(null)}>
              <RotateCcwIcon /> {t("admin.appsUi.resetDefault")}
            </Button>
          )}
          <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row">
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("admin.common.cancel")}
            </Button>
            <Button type="button" disabled={save.isPending || (!dirty && !applyNow)} onClick={() => void submit([...on])}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {t("admin.common.save")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The solution's look in miniature: its theme's background with the brand colour and an "Aa" in its heading font. */
export function Swatch({ solution, className }: { solution: Pick<Solution, "preset">; className?: string }) {
  const p = solution.preset;
  return (
    <span className={cn("relative flex shrink-0 overflow-hidden ring-1 ring-border", className)} style={{ background: p?.background ?? "#ffffff" }} aria-hidden>
      <span className="w-1/2" style={{ background: p?.primary ?? "var(--primary)" }} />
      <span
        className="grid w-1/2 place-items-center text-sm font-semibold"
        style={{ fontFamily: p ? `"${p.fontHeading}", serif` : undefined, color: isDark(p?.background) ? "#f5f5f4" : "#1c1917" }}
      >
        Aa
      </span>
    </span>
  );
}

function isDark(hex: string | null | undefined) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}
