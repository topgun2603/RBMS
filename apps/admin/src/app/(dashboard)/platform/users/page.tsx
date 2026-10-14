"use client";

import * as React from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BanIcon, CheckCircle2Icon, MoreHorizontalIcon, ShieldCheckIcon, ShieldOffIcon, UsersRoundIcon } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  initials,
  PageHeader,
  toast,
  type DataTableColumn,
} from "@srirealtime/ui";
import { StatusBadge } from "@/components/badges";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { DebouncedSearch } from "@/components/search-input";
import { SuperAdminOnly } from "@/components/superadmin-only";
import { api } from "@/lib/api";
import { displayName, isSuperAdmin, useMe } from "@/lib/auth";
import { describeError, tOr, useI18n } from "@/lib/i18n";
import type { Paged, User } from "@/lib/types";

const PAGE = 25;

type PendingAction = { user: User; kind: "status" | "superadmin" };

export default function PlatformUsersPage() {
  return (
    <SuperAdminOnly>
      <UsersList />
    </SuperAdminOnly>
  );
}

function UsersList() {
  const { t, formatDate, formatRelative } = useI18n();
  const qc = useQueryClient();
  const me = useMe();
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [pending, setPending] = React.useState<PendingAction | null>(null);

  const users = useQuery({
    queryKey: ["platform", "users", q, page],
    queryFn: () => api.get<Paged<User>>("/auth/users", { q, limit: PAGE, offset: page * PAGE }, { tenant: null }),
    placeholderData: keepPreviousData,
  });

  const act = useMutation({
    mutationFn: ({ user, kind }: PendingAction) =>
      kind === "status"
        ? api.patch(`/auth/users/${user.id}/status`, { status: user.status === "active" ? "disabled" : "active" }, { tenant: null })
        : api.patch(
            `/auth/users/${user.id}/platform-roles`,
            {
              roles: isSuperAdmin(user) ? user.platformRoles.filter((r) => r !== "superadmin") : [...user.platformRoles, "superadmin"],
            },
            { tenant: null },
          ),
    onSuccess: () => {
      toast.success(t("admin.platform.userUpdated"));
      void qc.invalidateQueries({ queryKey: ["platform", "users"] });
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const columns: DataTableColumn<User>[] = [
    {
      id: "user",
      header: t("admin.platform.user"),
      cell: (u) => (
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            {u.avatarUrl && <AvatarImage src={u.avatarUrl} alt="" />}
            <AvatarFallback className="bg-primary/10 text-primary">{initials(u.name ?? u.email ?? u.phone)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate font-medium">{displayName(u)}</div>
            <div className="truncate text-xs text-muted-foreground">{[u.phone, u.email].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      ),
    },
    {
      id: "roles",
      header: t("admin.platform.platformRoles"),
      hideBelow: "sm",
      cell: (u) =>
        u.platformRoles.length ? (
          <div className="flex flex-wrap gap-1">
            {u.platformRoles.map((r) => (
              <Badge key={r} variant={r === "superadmin" ? "default" : "outline"}>
                {tOr(t, `admin.roles.${r}`, r)}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { id: "locale", header: t("admin.account.language"), hideBelow: "lg", cell: (u) => <span className="uppercase">{u.locale}</span> },
    { id: "status", header: t("admin.common.status"), cell: (u) => <StatusBadge status={u.status} /> },
    {
      id: "seen",
      header: t("admin.platform.lastLogin"),
      hideBelow: "md",
      cell: (u) => <span className="text-muted-foreground">{u.lastLoginAt ? formatRelative(u.lastLoginAt) : formatDate(u.createdAt)}</span>,
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("admin.common.actions")}</span>,
      align: "right",
      width: "48px",
      cell: (u) =>
        u.id === me.data?.user.id ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("admin.common.actions")}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => setPending({ user: u, kind: "superadmin" })}>
                {isSuperAdmin(u) ? <ShieldOffIcon /> : <ShieldCheckIcon />}
                {isSuperAdmin(u) ? t("admin.platform.revokeSuperadmin") : t("admin.platform.grantSuperadmin")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant={u.status === "active" ? "destructive" : "default"}
                onSelect={() => setPending({ user: u, kind: "status" })}
                disabled={u.status === "deleted"}
              >
                {u.status === "active" ? <BanIcon /> : <CheckCircle2Icon />}
                {u.status === "active" ? t("admin.platform.disableUser") : t("admin.platform.enableUser")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
    },
  ];

  const p = pending;
  const title = !p
    ? ""
    : p.kind === "status"
      ? p.user.status === "active"
        ? t("admin.platform.disableUser")
        : t("admin.platform.enableUser")
      : isSuperAdmin(p.user)
        ? t("admin.platform.revokeSuperadmin")
        : t("admin.platform.grantSuperadmin");

  return (
    <Page>
      <PageHeader eyebrow={t("admin.nav.platform")} title={t("admin.platform.usersTitle")} description={t("admin.platform.usersSubtitle")} />
      <div className="mb-3 flex items-center gap-2">
        <DebouncedSearch
          placeholder={t("admin.platform.searchUsers")}
          onSearch={(v) => {
            setQ(v);
            setPage(0);
          }}
        />
        {users.data?.total !== undefined && (
          <span className="ml-auto text-xs text-muted-foreground">{t("admin.platform.userCount", { count: users.data.total })}</span>
        )}
      </div>
      {users.isError ? (
        <QueryError error={users.error} onRetry={() => void users.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={users.data?.items}
          loading={users.isLoading}
          getRowId={(u) => u.id}
          pagination={{ page, pageSize: PAGE, total: users.data?.total, onPageChange: setPage }}
          labels={{
            previous: t("admin.table.previous"),
            next: t("admin.table.next"),
            range: ({ from, to, total }) => t("admin.table.range", { from, to, total: total ?? to }),
          }}
          empty={<EmptyState compact icon={UsersRoundIcon} title={t("admin.common.noResults")} />}
        />
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        destructive={!!p && ((p.kind === "status" && p.user.status === "active") || (p.kind === "superadmin" && !isSuperAdmin(p.user)))}
        title={title}
        description={p ? t("admin.platform.confirmUserAction", { name: displayName(p.user) }) : ""}
        confirmLabel={title}
        onConfirm={() => (p ? act.mutateAsync(p) : undefined)}
      />
    </Page>
  );
}
