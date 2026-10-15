"use client";

import * as React from "react";
import { BracesIcon, SearchXIcon, SparklesIcon } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Skeleton,
} from "@srirealtime/ui";
import { SearchField, useI18n, useOptionalShop } from "@srirealtime/web";
import { groupEvents, groupState, samplePayload, toggleGroup, toggleKey } from "../../lib/developer";
import type { WebhookEventDef } from "../../lib/types";
import { JsonView } from "./json-view";
import { moduleLabel } from "./scope-picker";

/**
 * Webhook event checkboxes grouped by module, plus an "All events (*)" switch that sends ["*"]. Each event has a
 * "View sample" button showing the exact JSON body an endpoint receives.
 */
export function EventPicker({
  events,
  loading,
  all,
  onAllChange,
  selected,
  onChange,
  invalid,
}: {
  events: readonly WebhookEventDef[];
  loading?: boolean;
  all: boolean;
  onAllChange: (all: boolean) => void;
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  invalid?: boolean;
}) {
  const { t } = useI18n();
  const [query, setQuery] = React.useState("");
  const [sample, setSample] = React.useState<WebhookEventDef | null>(null);
  const groups = React.useMemo(() => groupEvents(events, query), [events, query]);

  return (
    <div className={cn("grid min-w-0 gap-2 rounded-xl border p-3", invalid && "border-destructive")}>
      <label
        htmlFor="events-all"
        className={cn("flex cursor-pointer items-start gap-3 rounded-lg border border-dashed px-3 py-2.5 transition-colors hover:bg-muted/60", all && "border-primary/40 bg-primary/5")}
      >
        <Checkbox id="events-all" className="mt-0.5" checked={all} onCheckedChange={(c) => onAllChange(c === true)} />
        <span className="grid gap-0.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            <SparklesIcon className="size-3.5 text-primary" />
            {t("growth.developer.events.all")}
            <code className="font-mono text-[11px] font-normal text-muted-foreground">*</code>
          </span>
          <span className="text-xs text-muted-foreground">{t("growth.developer.events.allHint")}</span>
        </span>
      </label>

      <div className={cn("grid gap-2 transition-opacity", all && "pointer-events-none opacity-50")} aria-disabled={all || undefined}>
        <div className="flex flex-wrap items-center gap-2">
          <SearchField size="sm" value={query} onChange={setQuery} placeholder={t("growth.developer.events.search")} className="min-w-0 flex-1 basis-48" />
          <Badge variant={!all && selected.size ? "default" : "muted"} className="tabular-nums" aria-live="polite">
            {all ? t("growth.developer.events.allShort") : t("growth.developer.events.selected", { count: selected.size })}
          </Badge>
        </div>
        <div className="-mx-1 max-h-72 overflow-y-auto overscroll-contain px-1" role="group" aria-label={t("growth.developer.endpoints.events")}>
          {loading ? (
            <div className="grid gap-2 py-1" aria-busy="true">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <EmptyState compact icon={SearchXIcon} title={t("growth.developer.events.noMatch")} />
          ) : (
            <div className="grid gap-3 py-1">
              {groups.map((g) => {
                const keys = g.items.map((e) => e.type);
                return (
                  <section key={g.module} className="grid gap-1">
                    <div className="sticky top-0 z-10 flex items-center gap-2 rounded-md bg-background/95 py-1 backdrop-blur">
                      <Checkbox
                        checked={groupState(keys, selected)}
                        disabled={all}
                        onCheckedChange={() => onChange(toggleGroup(selected, keys))}
                        aria-label={t("growth.developer.scopes.selectModule", { module: moduleLabel(t, g.module) })}
                      />
                      <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{moduleLabel(t, g.module)}</span>
                    </div>
                    {g.items.map((e) => {
                      const cid = `event-${e.type}`;
                      return (
                        <div key={e.type} className={cn("flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60", selected.has(e.type) && !all && "bg-primary/5")}>
                          <Checkbox id={cid} className="mt-0.5" checked={all || selected.has(e.type)} disabled={all} onCheckedChange={(c) => onChange(toggleKey(selected, e.type, c === true))} />
                          <label htmlFor={cid} className="grid min-w-0 flex-1 cursor-pointer gap-0.5">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium">
                              {e.label}
                              <code className="font-mono text-[11px] font-normal text-muted-foreground">{e.type}</code>
                            </span>
                            <span className="text-xs text-muted-foreground">{e.description}</span>
                          </label>
                          <Button type="button" variant="ghost" size="sm" className="pointer-events-auto shrink-0" onClick={() => setSample(e)}>
                            <BracesIcon /> <span className="hidden sm:inline">{t("growth.developer.events.viewSample")}</span>
                          </Button>
                        </div>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <SampleDialog event={sample} onClose={() => setSample(null)} />
    </div>
  );
}

/** The JSON body of an event, as an endpoint receives it. */
export function SampleDialog({ event, onClose }: { event: WebhookEventDef | null; onClose: () => void }) {
  const { t } = useI18n();
  const shop = useOptionalShop();
  const payload = React.useMemo(() => (event ? samplePayload(event, shop?.tenant.slug ?? "your-shop") : null), [event, shop?.tenant.slug]);
  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t("growth.common.close")} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{event?.label}</DialogTitle>
          <DialogDescription>
            {t("growth.developer.events.sampleBody")} <code className="font-mono text-xs">{event?.type}</code>
          </DialogDescription>
        </DialogHeader>
        {payload && <JsonView value={payload} label={t("growth.developer.events.sampleLabel")} maxHeight="max-h-[60dvh]" />}
        <DialogFooter>
          <Button onClick={onClose}>{t("growth.common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
