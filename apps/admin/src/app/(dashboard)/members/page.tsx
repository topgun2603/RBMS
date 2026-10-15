"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, MoreHorizontalIcon, SearchIcon, ShieldIcon, UserMinusIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  initials,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Label,
  PageHeader,
  toast,
  type DataTableColumn,
} from "@srirealtime/ui";
import { RoleBadges, StatusBadge } from "@/components/badges";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { RolePicker } from "@/components/role-picker";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { normalizeTarget } from "@/lib/format";
import { describeError, useI18n } from "@/lib/i18n";
import { qk, useMembers } from "@/lib/queries";
import type { Member } from "@/lib/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function memberInfo(m: Member) {
  const name = m.user?.name ?? m.name ?? null;
  const email = m.user?.email ?? m.email ?? null;
  const phone = m.user?.phone ?? m.phone ?? null;
  return { name, contact: email ?? phone, avatarUrl: m.user?.avatarUrl ?? null };
}

export default function MembersPage() {
  const { t, formatDate } = useI18n();
  const qc = useQueryClient();
  const me = useMe();
  const members = useMembers();
  const [q, setQ] = React.useState("");
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Member | null>(null);
  const [removing, setRemoving] = React.useState<Member | null>(null);
  const myId = me.data?.user.id;

  const rows = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return members.data;
    return members.data?.filter((m) => {
      const i = memberInfo(m);
      return [i.name, i.contact, m.userId, ...m.roles].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [members.data, q]);

  const remove = useMutation({
    mutationFn: (m: Member) => api.delete(`/tenancy/members/${m.userId}`),
    onSuccess: () => {
      toast.success(t("admin.members.removed"));
      void qc.invalidateQueries({ queryKey: qk.members });
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const columns: DataTableColumn<Member>[] = [
    {
      id: "member",
      header: t("admin.members.member"),
      cell: (m) => {
        const i = memberInfo(m);
        return (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="size-8">
              {i.avatarUrl && <AvatarImage src={i.avatarUrl} alt="" />}
              <AvatarFallback className="bg-primary/10 text-primary">{initials(i.name ?? i.contact)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex items-center gap-2 truncate font-medium">
                {i.name ?? i.contact ?? t("admin.members.unnamed")}
                {m.userId === myId && <span className="text-xs font-normal text-muted-foreground">({t("admin.members.you")})</span>}
              </div>
              <div className="truncate font-mono text-xs text-muted-foreground">{i.name ? (i.contact ?? m.userId) : m.userId}</div>
            </div>
          </div>
        );
      },
    },
    { id: "roles", header: t("admin.members.roles"), cell: (m) => <RoleBadges roles={m.roles} /> },
    { id: "status", header: t("admin.common.status"), hideBelow: "sm", cell: (m) => <StatusBadge status={m.status} /> },
    {
      id: "joined",
      header: t("admin.members.joined"),
      hideBelow: "md",
      cell: (m) => <span className="text-muted-foreground">{m.createdAt ? formatDate(m.createdAt) : "—"}</span>,
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("admin.common.actions")}</span>,
      align: "right",
      width: "48px",
      cell: (m) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("admin.common.actions")}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => setEditing(m)}>
              <ShieldIcon /> {t("admin.members.editRoles")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(m)}>
              <UserMinusIcon /> {m.userId === myId ? t("admin.members.leave") : t("admin.members.remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const inviteButton = (
    <Button onClick={() => setInviteOpen(true)}>
      <UserPlusIcon /> {t("admin.members.invite")}
    </Button>
  );

  return (
    <Page>
      <PageHeader title={t("admin.members.title")} description={t("admin.members.subtitle")} actions={inviteButton} />

      <div className="mb-3 flex items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("admin.members.search")}
            size="sm"
            className="pl-8"
            aria-label={t("admin.common.search")}
          />
        </div>
        {members.data && (
          <span className="ml-auto text-xs text-muted-foreground">{t("admin.members.count", { count: members.data.length })}</span>
        )}
      </div>

      {members.isError ? (
        <QueryError error={members.error} onRetry={() => void members.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={members.isLoading}
          getRowId={(m) => m.userId}
          pageSize={25}
          labels={{
            previous: t("admin.table.previous"),
            next: t("admin.table.next"),
            range: ({ from, to, total }) => t("admin.table.range", { from, to, total: total ?? to }),
          }}
          empty={
            <EmptyState
              compact
              icon={UsersIcon}
              title={q ? t("admin.common.noResults") : t("admin.members.emptyTitle")}
              description={q ? undefined : t("admin.members.emptyDescription")}
              action={q ? undefined : inviteButton}
            />
          }
        />
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <RolesDialog member={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing?.userId === myId ? t("admin.members.leaveTitle") : t("admin.members.removeTitle")}
        description={
          removing?.userId === myId
            ? t("admin.members.leaveDescription")
            : t("admin.members.removeDescription", { name: removing ? (memberInfo(removing).name ?? memberInfo(removing).contact ?? removing.userId) : "" })
        }
        confirmLabel={removing?.userId === myId ? t("admin.members.leave") : t("admin.members.remove")}
        onConfirm={() => (removing ? remove.mutateAsync(removing) : undefined)}
      />
    </Page>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [raw, setRaw] = React.useState("");
  const [roles, setRoles] = React.useState<string[]>(["member"]);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setRaw("");
      setRoles(["member"]);
      setTouched(false);
    }
  }, [open]);

  const isUuid = UUID_RE.test(raw.trim());
  const parsed = normalizeTarget(raw);
  const valid = (isUuid || parsed.kind !== "invalid") && roles.length > 0;

  const invite = useMutation({
    mutationFn: () =>
      api.post("/tenancy/members", isUuid ? { userId: raw.trim(), roles } : { target: parsed.target, roles }),
    onSuccess: () => {
      toast.success(t("admin.members.invited"));
      void qc.invalidateQueries({ queryKey: qk.members });
      onOpenChange(false);
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !invite.isPending && onOpenChange(o)}>
      <DialogContent closeLabel={t("admin.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("admin.members.inviteTitle")}</DialogTitle>
          <DialogDescription>{t("admin.members.inviteDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (valid) invite.mutate();
          }}
        >
          <Field id="invite-target">
            <FieldLabel>{t("admin.members.target")}</FieldLabel>
            <FieldControl>
              <Input autoFocus value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={t("admin.login.targetPlaceholder")} />
            </FieldControl>
            {touched && !isUuid && parsed.kind === "invalid" ? (
              <FieldError>{t("admin.login.targetInvalid")}</FieldError>
            ) : (
              <FieldHint>{t("admin.members.targetHint")}</FieldHint>
            )}
          </Field>
          <div className="grid gap-2">
            <Label>{t("admin.members.roles")}</Label>
            <RolePicker value={roles} onChange={setRoles} idPrefix="invite-role" />
            {touched && roles.length === 0 && <p className="text-xs text-destructive">{t("admin.members.pickRole")}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={invite.isPending}>
              {t("admin.common.cancel")}
            </Button>
            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending && <Loader2Icon className="animate-spin" />}
              {t("admin.members.sendInvite")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RolesDialog({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [roles, setRoles] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (member) setRoles(member.roles);
  }, [member]);

  const save = useMutation({
    mutationFn: () => api.patch(`/tenancy/members/${member!.userId}`, { roles }),
    onSuccess: () => {
      toast.success(t("admin.members.rolesUpdated"));
      void qc.invalidateQueries({ queryKey: qk.members });
      onClose();
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const info = member ? memberInfo(member) : null;
  return (
    <Dialog open={member !== null} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent closeLabel={t("admin.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("admin.members.editRoles")}</DialogTitle>
          <DialogDescription>{info?.name ?? info?.contact ?? member?.userId}</DialogDescription>
        </DialogHeader>
        <RolePicker value={roles} onChange={setRoles} idPrefix="edit-role" disabled={save.isPending} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t("admin.common.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || roles.length === 0}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            {t("admin.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
