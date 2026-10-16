"use client";

import * as React from "react";
import { MailIcon, MoreVerticalIcon, PencilIcon, PhoneIcon, UserMinusIcon, UserPlusIcon, UsersRoundIcon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  Card,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  InitialsAvatar,
  motion,
  Skeleton,
  Switch,
  toast,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, displayName, QueryError, SearchField, useI18n, useSession } from "@srirealtime/web";
import { LevelPill, useRelativeTime } from "../bits";
import { useMyUserId } from "../../lib/access";
import { useMembers, useRemoveMember, useRoles, useUpdateMember } from "../../lib/queries";
import type { StaffMember } from "../../lib/types";
import { MemberDialog } from "./member-dialog";
import { roleName } from "./labels";

const LEVEL_ORDER = { owner: 0, admin: 1, staff: 2, member: 3 } as const;

export function MembersTab() {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const { canManage } = useSession();
  const me = useMyUserId();
  const members = useMembers();
  const roles = useRoles();
  const update = useUpdateMember();
  const remove = useRemoveMember();
  const ago = useRelativeTime();
  const [q, setQ] = React.useState("");
  const [dialog, setDialog] = React.useState<{ member: StaffMember | null } | null>(null);
  const [removing, setRemoving] = React.useState<StaffMember | null>(null);

  const roleByKey = React.useMemo(() => new Map((roles.data ?? []).map((r) => [r.key, r])), [roles.data]);
  const list = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...(members.data ?? [])]
      .filter((m) => !needle || [m.name, m.phone, m.email].some((v) => v?.toLowerCase().includes(needle)))
      .sort((a, b) => LEVEL_ORDER[a.level ?? "member"] - LEVEL_ORDER[b.level ?? "member"] || displayName(a).localeCompare(displayName(b)));
  }, [members.data, q]);

  /** Owners are managed through the shop's ownership; staff managers can't touch admins; nobody edits themselves here. */
  const canEdit = (m: StaffMember) => m.level !== "owner" && m.userId !== me && (canManage || m.level !== "admin");

  const setActive = (m: StaffMember, active: boolean) =>
    update.mutate(
      { userId: m.userId, body: { active } },
      {
        onSuccess: () => toast.success(t(active ? "workspace.team.activated" : "workspace.team.deactivated", { name: displayName(m) })),
        onError: (err) => toast.error(describeError(err, t)),
      },
    );

  const invite = (
    <Button size="lg" onClick={() => setDialog({ member: null })}>
      <UserPlusIcon /> {t("workspace.team.invite")}
    </Button>
  );

  if (members.isError) return <QueryError error={members.error} onRetry={() => void members.refetch()} />;

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {(members.data?.length ?? 0) > 6 ? (
          <SearchField value={q} onChange={setQ} placeholder={t("workspace.team.search")} className="sm:max-w-xs sm:flex-1" />
        ) : members.data ? (
          <p className="text-sm text-muted-foreground">{t("workspace.team.count", { count: members.data.length })}</p>
        ) : (
          <Skeleton className="h-4 w-24" />
        )}
        {invite}
      </div>

      {members.isPending ? (
        <Card className="gap-0 divide-y py-0">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-6 w-10 rounded-full" />
            </div>
          ))}
        </Card>
      ) : list.length === 0 ? (
        <EmptyState icon={UsersRoundIcon} title={q ? t("workspace.team.noMatch") : t("workspace.team.emptyTitle")} description={q ? undefined : t("workspace.team.emptyBody")} action={q ? undefined : invite} />
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <ul className="divide-y" aria-label={t("workspace.team.membersTab")}>
            <AnimatePresence initial={false}>
              {list.map((m) => {
                const editable = canEdit(m);
                const contact = [m.phone, m.email].filter(Boolean);
                return (
                  <motion.li
                    key={m.userId}
                    layout={!reduced}
                    initial={reduced ? false : { opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:flex-nowrap sm:px-5", !m.active && "bg-muted/30")}
                  >
                    <InitialsAvatar name={displayName(m)} className={cn(!m.active && "opacity-50")} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className={cn("truncate font-medium", !m.active && "text-muted-foreground")}>{m.name || contact[0] || t("workspace.team.unnamed")}</span>
                        {m.userId === me && <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{t("workspace.team.you")}</span>}
                        {!m.active && <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{t("workspace.team.inactive")}</span>}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-3 text-meta text-muted-foreground">
                        {m.phone && (
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <PhoneIcon className="size-3" /> {m.phone}
                          </span>
                        )}
                        {m.email && (
                          <span className="inline-flex min-w-0 items-center gap-1 truncate">
                            <MailIcon className="size-3" /> {m.email}
                          </span>
                        )}
                        <span>{t("workspace.team.lastActive", { when: ago(m.lastActive) })}</span>
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <LevelPill level={m.level} />
                        {m.level === "staff" &&
                          (m.roleKeys.length ? (
                            m.roleKeys.map((k) => {
                              const r = roleByKey.get(k);
                              return (
                                <span key={k} className="rounded-full border bg-card px-2 py-0.5 text-xs font-medium">
                                  {r ? roleName(t, r) : k}
                                </span>
                              );
                            })
                          ) : (
                            <span className="text-xs text-muted-foreground">{t("workspace.team.defaultAccess")}</span>
                          ))}
                      </div>
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      <Switch
                        checked={m.active}
                        disabled={!editable || update.isPending}
                        onCheckedChange={(on) => setActive(m, on)}
                        aria-label={t(m.active ? "workspace.team.deactivate" : "workspace.team.activate", { name: displayName(m) })}
                      />
                      {editable ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={t("workspace.common.actionsFor", { name: displayName(m) })}>
                              <MoreVerticalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem className="h-10" onSelect={() => setDialog({ member: m })}>
                              <PencilIcon /> {t("workspace.team.editAccess")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => setRemoving(m)}>
                              <UserMinusIcon /> {t("workspace.team.remove")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="size-9" aria-hidden />
                      )}
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </Card>
      )}

      <MemberDialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} member={dialog?.member ?? null} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("workspace.team.removeTitle", { name: removing ? displayName(removing) : "" })}
        description={t("workspace.team.removeBody")}
        confirmLabel={t("workspace.team.remove")}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await remove.mutateAsync(removing.userId);
            toast.success(t("workspace.team.removed", { name: displayName(removing) }));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </div>
  );
}
