"use client";

import { useRouter } from "next/navigation";
import { Building2Icon, CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
} from "@srirealtime/ui";
import { useMyTenants, useSwitchTenant } from "@/lib/auth";
import { tOr, useI18n } from "@/lib/i18n";
import { useTenantSlug } from "@/lib/session";

export function TenantSwitcher() {
  const { t } = useI18n();
  const slug = useTenantSlug();
  const router = useRouter();
  const { data, isLoading } = useMyTenants();
  const switchTenant = useSwitchTenant();
  const current = data?.find((m) => m.tenant.slug === slug);

  if (isLoading) return <Skeleton className="h-8 w-40" />;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-[16rem] justify-between gap-2 px-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
              <Building2Icon className="size-3" />
            </span>
            <span className="truncate font-medium">{current?.tenant.name ?? slug ?? t("admin.tenant.none")}</span>
          </span>
          <ChevronsUpDownIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("admin.tenant.workspaces")}</DropdownMenuLabel>
        {data?.map(({ tenant, roles }) => (
          <DropdownMenuItem
            key={tenant.id}
            onSelect={() => {
              if (tenant.slug !== slug) {
                switchTenant(tenant.slug);
                router.push("/");
              }
            }}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{tenant.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {tenant.slug} · {roles.map((r) => tOr(t, `admin.roles.${r}`, r)).join(", ")}
              </span>
            </div>
            {tenant.slug === slug && <CheckIcon className="text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/select-tenant?create=1")}>
          <PlusIcon /> {t("admin.tenant.create")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
