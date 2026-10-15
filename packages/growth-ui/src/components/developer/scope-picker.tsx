"use client";

import * as React from "react";
import { SearchXIcon } from "lucide-react";
import { Badge, Button, Checkbox, cn, EmptyState, Skeleton } from "@srirealtime/ui";
import { humanizeKey, SearchField, tOr, useI18n, type Translator } from "@srirealtime/web";
import { groupScopes, groupState, toggleGroup, toggleKey } from "../../lib/developer";
import type { ScopeDef } from "../../lib/types";

/** "invoices" → "Bills" (falls back to a humanised key for modules added later). */
export const moduleLabel = (t: Translator, module: string) => tOr(t, `growth.developer.modules.${module}`, humanizeKey(module));

/**
 * Scope (permission) checkboxes grouped by module, with search, "select all in module" and a selected count.
 * Scopes the member doesn't hold are disabled (the server refuses them anyway).
 */
export function ScopePicker({
  scopes,
  loading,
  selected,
  onChange,
  canGrant,
  invalid,
  id,
}: {
  scopes: readonly ScopeDef[];
  loading?: boolean;
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  canGrant: (key: string) => boolean;
  invalid?: boolean;
  id?: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = React.useState("");
  const groups = React.useMemo(() => groupScopes(scopes, query), [scopes, query]);
  const grantable = React.useMemo(() => scopes.filter((s) => canGrant(s.key)).map((s) => s.key), [scopes, canGrant]);

  return (
    <div id={id} className={cn("grid min-w-0 gap-2 rounded-xl border p-3", invalid && "border-destructive")}>
      <div className="flex flex-wrap items-center gap-2">
        <SearchField size="sm" value={query} onChange={setQuery} placeholder={t("growth.developer.scopes.search")} className="min-w-0 flex-1 basis-48" />
        <Badge variant={selected.size ? "default" : "muted"} className="tabular-nums" aria-live="polite">
          {t("growth.developer.scopes.selected", { count: selected.size })}
        </Badge>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(toggleGroup(selected, grantable))} disabled={grantable.length === 0}>
          {groupState(grantable, selected) === true ? t("growth.developer.scopes.clearAll") : t("growth.developer.scopes.selectAll")}
        </Button>
      </div>

      <div className="-mx-1 max-h-80 overflow-y-auto overscroll-contain px-1" role="group" aria-label={t("growth.developer.keys.scopes")}>
        {loading ? (
          <div className="grid gap-2 py-1" aria-busy="true">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <EmptyState compact icon={SearchXIcon} title={t("growth.developer.scopes.noMatch")} />
        ) : (
          <div className="grid gap-3 py-1">
            {groups.map((g) => {
              const keys = g.items.filter((s) => canGrant(s.key)).map((s) => s.key);
              const state = groupState(keys, selected);
              const picked = g.items.filter((s) => selected.has(s.key)).length;
              const groupId = `${id ?? "scopes"}-${g.module}`;
              return (
                <section key={g.module} className="grid gap-1" aria-labelledby={groupId}>
                  <div className="sticky top-0 z-10 flex items-center gap-2 rounded-md bg-background/95 py-1 backdrop-blur">
                    <Checkbox
                      checked={state}
                      disabled={keys.length === 0}
                      onCheckedChange={() => onChange(toggleGroup(selected, keys))}
                      aria-label={t("growth.developer.scopes.selectModule", { module: moduleLabel(t, g.module) })}
                    />
                    <span id={groupId} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {moduleLabel(t, g.module)}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {picked}/{g.items.length}
                    </span>
                  </div>
                  {g.items.map((s) => {
                    const allowed = canGrant(s.key);
                    const cid = `${id ?? "scope"}-${s.key}`;
                    return (
                      <label
                        key={s.key}
                        htmlFor={cid}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60",
                          selected.has(s.key) && "bg-primary/5",
                          !allowed && "cursor-not-allowed opacity-60 hover:bg-transparent",
                        )}
                      >
                        <Checkbox id={cid} className="mt-0.5" checked={selected.has(s.key)} disabled={!allowed} onCheckedChange={(c) => onChange(toggleKey(selected, s.key, c === true))} />
                        <span className="grid min-w-0 gap-0.5">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium">
                            {s.label}
                            <code className="font-mono text-[11px] font-normal text-muted-foreground">{s.key}</code>
                          </span>
                          <span className="text-xs text-muted-foreground">{s.description}</span>
                          {!allowed && <span className="text-xs text-warning-ink">{t("growth.developer.scopes.notHeld")}</span>}
                        </span>
                      </label>
                    );
                  })}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
