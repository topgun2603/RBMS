"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2Icon, CheckIcon, ChevronsUpDownIcon, PlusIcon, SearchIcon } from "lucide-react";
import { Button, Popover, PopoverContent, PopoverTrigger, ScrollArea, Skeleton, cn } from "@srirealtime/ui";
import { useMyTenants, useSwitchTenant } from "@/lib/auth";
import { tOr, useI18n } from "@/lib/i18n";
import { useTenantSlug } from "@/lib/session";

/** Workspace picker: search by name or slug (the list grows to hundreds), arrow keys + Enter, slim hover scrollbar. */
export function TenantSwitcher() {
  const { t } = useI18n();
  const slug = useTenantSlug();
  const router = useRouter();
  const { data, isLoading } = useMyTenants();
  const switchTenant = useSwitchTenant();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);
  const current = data?.find((m) => m.tenant.slug === slug);

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter(({ tenant }) => tenant.name.toLowerCase().includes(q) || tenant.slug.toLowerCase().includes(q));
  }, [data, query]);

  React.useEffect(() => setActive(0), [query]);
  React.useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (next: string) => {
    setOpen(false);
    if (next !== slug) {
      switchTenant(next);
      router.push("/");
    }
  };
  const create = () => {
    setOpen(false);
    router.push("/select-tenant?create=1");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = matches[active];
      if (m) choose(m.tenant.slug);
    }
  };

  if (isLoading) return <Skeleton className="h-8 w-40" />;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-[16rem] justify-between gap-2 px-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
              <Building2Icon className="size-3" />
            </span>
            <span className="truncate font-medium">{current?.tenant.name ?? slug ?? t("admin.tenant.none")}</span>
          </span>
          <ChevronsUpDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("admin.tenant.search")}
            aria-label={t("admin.tenant.search")}
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex items-center justify-between px-3 pt-2 pb-1 text-xs text-muted-foreground">
          <span>{t("admin.tenant.workspaces")}</span>
          <span className="tabular-nums">{query ? `${matches.length} / ${data?.length ?? 0}` : (data?.length ?? 0)}</span>
        </div>
        <ScrollArea
          type="hover"
          className={cn(
            "[&>[data-slot=scroll-area-viewport]]:max-h-72",
            // slim overlay scrollbar, shown on hover only
            "[&_[data-slot=scroll-area-scrollbar]]:w-1.5 [&_[data-slot=scroll-area-scrollbar]]:border-l-0",
            "[&_[data-slot=scroll-area-thumb]]:bg-muted-foreground/30 hover:[&_[data-slot=scroll-area-thumb]]:bg-muted-foreground/50",
          )}
        >
          <div ref={listRef} role="listbox" aria-label={t("admin.tenant.workspaces")} className="p-1">
            {matches.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("admin.tenant.noMatch")}</p>}
            {matches.map(({ tenant, roles }, i) => (
              <button
                key={tenant.id}
                type="button"
                role="option"
                aria-selected={tenant.slug === slug}
                data-index={i}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(tenant.slug)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
                  i === active && "bg-accent text-accent-foreground",
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{tenant.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {tenant.slug} · {roles.map((r) => tOr(t, `admin.roles.${r}`, r)).join(", ")}
                  </span>
                </div>
                {tenant.slug === slug && <CheckIcon className="size-4 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
        </ScrollArea>
        <div className="border-t p-1">
          <button
            type="button"
            onClick={create}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground [&_svg]:size-4"
          >
            <PlusIcon /> {t("admin.tenant.create")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
