"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BoxIcon, InfoIcon, LinkIcon, PuzzleIcon } from "lucide-react";
import { Badge, Button, cn, EmptyState, Skeleton, Switch } from "@srirealtime/ui";
import { QueryError } from "@/components/query-state";
import {
  buildGraph,
  featureLabel,
  groupByModule,
  moduleLabel,
  switchOff,
  switchOn,
  useFeatureRegistry,
} from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import type { FeatureDef } from "@/lib/types";

const EASE = [0.16, 1, 0.3, 1] as const;

interface Note {
  kind: "on" | "off";
  keys: string[];
  id: number;
}

export interface FeatureMatrixProps {
  defs: FeatureDef[];
  /** Selected feature keys. */
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
  /** Two columns of module cards on wide screens. */
  columns?: 1 | 2;
  className?: string;
}

/**
 * Module cards with a master switch and per-feature switches. Switching a feature on switches on
 * what it needs; switching one off switches off what needs it — with a short inline note.
 */
export function FeatureMatrix({ defs, value, onChange, disabled, columns = 1, className }: FeatureMatrixProps) {
  const { t } = useI18n();
  const reduced = useReducedMotion() ?? false;
  const graph = React.useMemo(() => buildGraph(defs), [defs]);
  const groups = React.useMemo(() => groupByModule(defs), [defs]);
  const [notes, setNotes] = React.useState<Record<string, Note>>({});
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  React.useEffect(() => {
    const map = timers.current;
    return () => map.forEach((h) => clearTimeout(h));
  }, []);

  const flashed = React.useMemo(() => new Set(Object.values(notes).flatMap((n) => n.keys)), [notes]);

  const showNote = (module: string, kind: Note["kind"], keys: string[]) => {
    const prev = timers.current.get(module);
    if (prev) clearTimeout(prev);
    if (keys.length === 0) {
      setNotes(({ [module]: _gone, ...rest }) => rest);
      return;
    }
    setNotes((n) => ({ ...n, [module]: { kind, keys, id: Date.now() } }));
    timers.current.set(
      module,
      setTimeout(() => setNotes(({ [module]: _gone, ...rest }) => rest), 5000),
    );
  };

  const set = (module: string, keys: string[], on: boolean) => {
    if (on) {
      const { next, added } = switchOn(value, keys, graph);
      onChange(next);
      showNote(module, "on", added);
    } else {
      const { next, removed } = switchOff(value, keys, graph);
      onChange(next);
      showNote(module, "off", removed);
    }
  };

  const labelOf = (key: string) => {
    const d = graph.byKey.get(key);
    return d ? featureLabel(t, d) : key;
  };

  if (groups.length === 0) {
    return <EmptyState compact icon={PuzzleIcon} title={t("admin.featuresUi.registryEmpty")} description={t("admin.featuresUi.registryEmptyHint")} />;
  }

  return (
    <div className={cn("grid gap-3", columns === 2 && "xl:grid-cols-2", className)}>
      {groups.map((g, gi) => {
        const onCount = g.items.filter((i) => value.has(i.key)).length;
        const all = onCount === g.items.length;
        const some = onCount > 0 && !all;
        const name = moduleLabel(t, g.module, g.items);
        const note = notes[g.module];
        return (
          <motion.section
            key={g.module}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: EASE, delay: reduced ? 0 : Math.min(gi, 8) * 0.03 }}
            className="overflow-hidden rounded-xl border bg-card text-card-foreground"
            aria-label={name}
          >
            <header className="flex items-center gap-3 border-b bg-muted/30 px-4 py-3">
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
                  onCount > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                <BoxIcon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{name}</div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <code className="font-mono">{g.module}</code>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{t("admin.featuresUi.countOn", { on: onCount, total: g.items.length })}</span>
                </div>
              </div>
              <Switch
                checked={all}
                className={cn(some && "data-[state=unchecked]:bg-primary/40 dark:data-[state=unchecked]:bg-primary/40")}
                onCheckedChange={(c) => set(g.module, g.items.map((i) => i.key), c)}
                disabled={disabled}
                aria-label={t("admin.featuresUi.allOf", { module: name })}
              />
            </header>

            <ul className="divide-y">
              {g.items.map((f) => {
                const on = value.has(f.key);
                const deps = f.dependsOn ?? [];
                const id = `feat-${f.key}`;
                return (
                  <li
                    key={f.key}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3 transition-colors duration-500",
                      flashed.has(f.key) && "bg-primary/[0.06]",
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <label htmlFor={id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium">
                        {featureLabel(t, f)}
                        {f.key === g.module && (
                          <Badge variant="muted" className="h-4 px-1.5 text-[10px] font-normal">
                            {t("admin.featuresUi.base")}
                          </Badge>
                        )}
                        {f.shopToggle && (
                          <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal text-muted-foreground">
                            {t("admin.featuresUi.shopToggle")}
                          </Badge>
                        )}
                      </label>
                      {f.description && <p className="text-xs leading-relaxed text-muted-foreground">{f.description}</p>}
                      <div className="flex flex-wrap items-center gap-1">
                        <code className="mr-1 font-mono text-xs text-muted-foreground/80">{f.key}</code>
                        {deps.map((d) => (
                          <Badge
                            key={d}
                            variant="outline"
                            className={cn(
                              "h-5 gap-1 px-1.5 text-xs font-normal transition-colors",
                              on && !value.has(d) ? "border-destructive/50 text-destructive" : "text-muted-foreground",
                            )}
                          >
                            <LinkIcon /> {t("admin.featuresUi.needs", { feature: labelOf(d) })}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Switch id={id} className="mt-0.5" checked={on} onCheckedChange={(c) => set(g.module, [f.key], c)} disabled={disabled} />
                  </li>
                );
              })}
            </ul>

            <AnimatePresence initial={false}>
              {note && (
                <motion.div
                  key="note"
                  initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  animate={reduced ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                  exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div role="status" className="flex items-start gap-2 border-t bg-primary/5 px-4 py-2 text-xs text-foreground/80">
                    <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      {t(note.kind === "on" ? "admin.featuresUi.alsoOn" : "admin.featuresUi.alsoOff", {
                        features: note.keys.map(labelOf).join(", "),
                      })}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-my-1 h-6 px-2 text-xs"
                      onClick={() => showNote(g.module, note.kind, [])}
                    >
                      {t("admin.common.dismiss")}
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        );
      })}
    </div>
  );
}

/** Registry-backed picker: loads GET /features/registry and renders the matrix (with loading / error states). */
export function RegistryFeatureMatrix(props: Omit<FeatureMatrixProps, "defs">) {
  const registry = useFeatureRegistry();
  if (registry.isError) return <QueryError compact error={registry.error} onRetry={() => void registry.refetch()} />;
  if (registry.isLoading || !registry.data) return <FeatureMatrixSkeleton />;
  return <FeatureMatrix defs={registry.data} {...props} />;
}

export function FeatureMatrixSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="grid gap-3" aria-busy="true">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border">
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <Skeleton className="size-8" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-[1.15rem] w-8 rounded-full" />
          </div>
          {[0, 1].map((j) => (
            <div key={j} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
              <Skeleton className="h-[1.15rem] w-8 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
