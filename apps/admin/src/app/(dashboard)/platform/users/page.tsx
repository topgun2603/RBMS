"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BanIcon, CheckCircle2Icon, MoreHorizontalIcon, ShieldCheckIcon, ShieldOffIcon, UsersRoundIcon } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  DataTable,
  DataTableToolbar,
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
import { SuperAdminOnly } from "@/components/superadmin-only";
import { api } from "@/lib/api";
import { displayName, isSuperAdmin, useMe } from "@/lib/auth";
import { describeError, tOr, useI18n } from "@/lib/i18n";
import type { User } from "@/lib/types";
import { useServerTable, type ServerFilterDefs } from "@/lib/use-server-table";

/** Filter values of GET /v1/auth/users (packages/auth/src/list.ts). */
const STATUSES = ["active", "disabled", "deleted"] as const;
const ROLES = ["superadmin", "none"] as const;

type PendingAction = { user: User; kind: "status" | "superadmin" };

export default function PlatformUsersPage() {
  return (
    <SuperAdminOnly>
      {/* useServerTable reads the search params, which needs a Suspense boundary. */}
      <React.Suspense fallback={null}>
        <UsersList />
      </React.Suspense>
    </SuperAdminOnly>
  );
}

function UsersList() {
  const { t, formatDate, formatRelative } = useI18n();
  const qc = useQueryClient();
  const me = useMe();
  const myId = me.data?.user.id;
  const [pending, setPending] = React.useState<PendingAction | null>(null);

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

  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("admin.common.status"),
          options: STATUSES.map((s) => ({ value: s, label: tOr(t, `admin.status.${s}`, s) })),
        },
        role: {
          kind: "options",
          label: t("admin.platform.platformRoles"),
          options: ROLES.map((r) => ({ value: r, label: r === "none" ? t("admin.platform.noPlatformRole") : tOr(t, `admin.roles.${r}`, r) })),
        },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<User>[]>(
    () => [
      {
        id: "name",
        header: t("admin.platform.user"),
        sortable: true,
        hideable: false,
        card: "title",
        cell: (u) => (
          <div className="flex items-center gap-3">
            <Avatar className="size-8">
              {u.avatarUrl && <AvatarImage src={u.avatarUrl} alt="" />}
              <AvatarFallback className="bg-primary/10 text-primary">{initials(u.name ?? u.email ?? u.phone)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate font-medium">{displayName(u)}</div>
              {/* Phone and email have their own columns from lg up. */}
              <div className="truncate text-xs text-muted-foreground lg:hidden">{[u.phone, u.email].filter(Boolean).join(" · ")}</div>
            </div>
          </div>
        ),
        cardCell: (u) => displayName(u),
      },
      {
        id: "phone",
        header: t("admin.platform.phone"),
        sortable: true,
        hideBelow: "lg",
        card: "subtitle",
        cell: (u) => <span className="whitespace-nowrap tabular-nums">{u.phone ?? "—"}</span>,
        cardCell: (u) => [u.phone, u.email].filter(Boolean).join(" · ") || "—",
      },
      {
        id: "email",
        header: t("admin.platform.email"),
        sortable: true,
        hideBelow: "lg",
        cell: (u) => <span className="block max-w-[16rem] truncate">{u.email ?? "—"}</span>,
      },
      {
        id: "roles",
        header: t("admin.platform.platformRoles"),
        hideBelow: "sm",
        card: "meta",
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
        cardCell: (u) => (u.platformRoles.includes("superadmin") ? <Badge>{tOr(t, "admin.roles.superadmin", "superadmin")}</Badge> : null),
      },
      { id: "locale", header: t("admin.account.language"), hideBelow: "lg", defaultHidden: true, cell: (u) => <span className="uppercase">{u.locale}</span> },
      { id: "status", header: t("admin.common.status"), card: "right", cell: (u) => <StatusBadge status={u.status} /> },
      {
        id: "lastActive",
        header: t("admin.platform.lastLogin"),
        sortable: true,
        sortDescFirst: true,
        hideBelow: "md",
        card: "meta",
        cell: (u) => (
          <span className="whitespace-nowrap text-muted-foreground" title={u.lastLoginAt ? formatDate(u.lastLoginAt) : undefined}>
            {u.lastLoginAt ? formatRelative(u.lastLoginAt) : "—"}
          </span>
        ),
      },
      {
        id: "created",
        header: t("admin.common.created"),
        sortable: true,
        sortDescFirst: true,
        hideBelow: "md",
        cell: (u) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(u.createdAt)}</span>,
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("admin.common.actions")}</span>,
        label: t("admin.common.actions"),
        hideable: false,
        align: "right",
        width: "48px",
        card: "right",
        cell: (u) =>
          u.id === myId ? null : (
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
    ],
    [t, formatDate, formatRelative, myId],
  );

  const st = useServerTable<User, typeof filters>({
    queryKey: ["platform", "users", "table"],
    path: "/auth/users",
    columns,
    filters,
    defaultSort: "-created", // = USER_SORT default
    search: t("admin.platform.searchUsers"),
    storageKey: "admin-platform-users",
    getRowId: (u) => u.id,
  });

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
      <PageHeader
        eyebrow={t("admin.nav.platform")}
        title={t("admin.platform.usersTitle")}
        description={t("admin.platform.usersSubtitle")}
        actions={st.total !== undefined ? <span className="text-sm text-muted-foreground tabular-nums">{t("admin.platform.userCount", { count: st.total })}</span> : undefined}
      />
      <DataTableToolbar table={st.table} />
      <DataTable table={st.table} empty={<EmptyState compact icon={UsersRoundIcon} title={t("admin.common.noResults")} />} />
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
