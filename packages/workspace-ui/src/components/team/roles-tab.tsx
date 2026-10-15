"use client";

import * as React from "react";
import { CopyIcon, CrownIcon, KeyRoundIcon, LockIcon, MoreVerticalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  Stagger,
  StaggerItem,
  StatusPill,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, QueryError, useI18n } from "@srirealtime/web";
import { DEFAULT_ROLE_KEY } from "../../lib/permissions";
import { useDeleteRole, useMembers, useRoles } from "../../lib/queries";
import type { Role } from "../../lib/types";
import { patternLabel, roleDescription, roleName } from "./labels";
import { RoleEditor, type RoleDraft } from "./role-editor";

export function RolesTab() {
  const { t } = useI18n();
  const roles = useRoles();
  const members = useMembers();
  const del = useDeleteRole();
  const [draft, setDraft] = React.useState<RoleDraft | null>(null);
  const [deleting, setDeleting] = React.useState<Role | null>(null);

  const usage = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const mem of members.data ?? []) {
      if (mem.level !== "staff" || !mem.active) continue;
      if (mem.roleKeys.length === 0) m.set(DEFAULT_ROLE_KEY, (m.get(DEFAULT_ROLE_KEY) ?? 0) + 1);
      for (const k of mem.roleKeys) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [members.data]);
  const taken = React.useMemo(() => new Set((roles.data ?? []).map((r) => r.key)), [roles.data]);

  if (roles.isError) return <QueryError error={roles.error} onRetry={() => void roles.refetch()} />;

  return (
    <div className="grid gap-3">
      <Alert className="border-primary/25 bg-primary/5">
        <CrownIcon className="text-primary" />
        <AlertDescription className="text-foreground/90">{t("workspace.roles.ownersNote")}</AlertDescription>
      </Alert>
      <div className="flex justify-end">
        <Button size="lg" className="h-11" onClick={() => setDraft({ mode: "new" })}>
          <PlusIcon /> {t("workspace.roles.new")}
        </Button>
      </div>

      {roles.isPending ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : (
        <Stagger className="grid gap-3 md:grid-cols-2" stagger={0.04}>
          {roles.data.map((r) => {
            const n = usage.get(r.key) ?? 0;
            const broad = r.permissions.filter((p) => p.includes("*"));
            return (
              <StaggerItem key={r.key} className="min-w-0">
                <Card className="h-full gap-2 px-4 py-4 sm:px-5">
                  <div className="flex items-start gap-3">
                    <span className="icon-chip size-9 shrink-0 text-primary">
                      {r.builtin ? <LockIcon className="size-4" /> : <KeyRoundIcon className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {roleName(t, r)}
                        {r.builtin && <StatusPill tone="neutral">{t("workspace.roles.builtinBadge")}</StatusPill>}
                      </p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{roleDescription(t, r) || t("workspace.roles.noDescription")}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={t("workspace.common.actionsFor", { name: roleName(t, r) })}>
                          <MoreVerticalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem className="h-10" onSelect={() => setDraft({ mode: "edit", role: r })}>
                          <PencilIcon /> {t("workspace.common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="h-10" onSelect={() => setDraft({ mode: "new", from: r })}>
                          <CopyIcon /> {t("workspace.roles.duplicate")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" className="h-10" disabled={r.builtin} onSelect={() => setDeleting(r)}>
                          <Trash2Icon /> {r.builtin ? t("workspace.roles.builtinNoDelete") : t("workspace.common.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                    <span className="rounded-full bg-muted px-2 py-0.5 font-medium tabular-nums">{t("workspace.roles.permCount", { count: r.permissions.length })}</span>
                    {broad.slice(0, 3).map((p) => (
                      <span key={p} className="rounded-full border px-2 py-0.5 text-muted-foreground">
                        {patternLabel(t, p)}
                      </span>
                    ))}
                    <span className="ml-auto text-muted-foreground">{t("workspace.roles.memberCount", { count: n })}</span>
                  </div>
                  {r.key === DEFAULT_ROLE_KEY && <p className="text-xs text-muted-foreground">{t("workspace.roles.defaultNote")}</p>}
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}

      <RoleEditor draft={draft} onClose={() => setDraft(null)} takenKeys={taken} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("workspace.roles.deleteTitle", { name: deleting ? roleName(t, deleting) : "" })}
        description={t("workspace.roles.deleteBody", { count: deleting ? (usage.get(deleting.key) ?? 0) : 0 })}
        confirmLabel={t("workspace.common.delete")}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await del.mutateAsync(deleting.key);
            toast.success(t("workspace.roles.deleted", { name: roleName(t, deleting) }));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </div>
  );
}
