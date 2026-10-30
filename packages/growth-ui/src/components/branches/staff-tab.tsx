"use client";

import * as React from "react";
import { HomeIcon, Loader2Icon, PencilIcon, ShieldCheckIcon, UsersIcon } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  InitialsAvatar,
  Label,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  toast,
} from "@rbms/ui";
import { describeError, QueryError, useI18n } from "@rbms/web";
import { InlineError } from "../bits";
import { useAssignments, useSetUserBranches, useStaff } from "../../lib/queries/branches";
import type { Branch, StaffMember } from "../../lib/types";

const FULL = new Set(["owner", "admin"]);
const isFull = (m: StaffMember) => (m.level ? FULL.has(m.level) : m.roles.some((r) => FULL.has(r)));

/** Which staff work in which branch, and their home branch. Owners and admins work everywhere. */
export function StaffTab({ branches }: { branches: Branch[] }) {
  const { t } = useI18n();
  const staff = useStaff();
  const open = branches.filter((b) => b.active);
  const assignments = useAssignments(open);
  const [editing, setEditing] = React.useState<StaffMember | null>(null);

  if (staff.isError) return <QueryError error={staff.error} onRetry={() => void staff.refetch()} />;
  if (staff.isPending || assignments.pending) {
    return (
      <div className="grid gap-2" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    );
  }
  const members = staff.data.filter((m) => m.active);
  if (members.length === 0) return <EmptyState icon={UsersIcon} title={t("growth.branches.noStaff")} description={t("growth.branches.noStaffBody")} />;
  const name = (id: string) => branches.find((b) => b.id === id);

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">{t("growth.branches.staffIntro")}</p>
      {assignments.error ? <QueryError compact error={assignments.error} onRetry={assignments.refetch} /> : null}
      <ul className="grid gap-2">
        {members.map((m) => {
          const a = assignments.byUser.get(m.userId);
          const full = isFull(m);
          return (
            <li key={m.userId} className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <InitialsAvatar name={m.name ?? m.email ?? m.phone ?? "?"} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.name ?? m.email ?? m.phone}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {full ? (
                      <Badge variant="secondary" className="gap-1">
                        <ShieldCheckIcon className="size-3.5" /> {t("growth.branches.allBranches")}
                      </Badge>
                    ) : a && a.branchIds.length > 0 ? (
                      a.branchIds.map((id) => (
                        <Badge key={id} variant={id === a.homeBranchId ? "default" : "outline"} className="gap-1">
                          {id === a.homeBranchId && <HomeIcon className="size-3" aria-label={t("growth.branches.home")} />}
                          {name(id)?.code ?? "—"}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("growth.branches.mainOnly")}</span>
                    )}
                  </div>
                </div>
              </div>
              {!full && (
                <Button variant="outline" size="sm" onClick={() => setEditing(m)}>
                  <PencilIcon /> {t("growth.branches.assign")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <AssignDialog
        member={editing}
        branches={open}
        current={editing ? assignments.byUser.get(editing.userId) : undefined}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </div>
  );
}

function AssignDialog({
  member,
  branches,
  current,
  onOpenChange,
}: {
  member: StaffMember | null;
  branches: Branch[];
  current?: { branchIds: string[]; homeBranchId: string | null };
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const save = useSetUserBranches();
  const [ids, setIds] = React.useState<string[]>([]);
  const [home, setHome] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (member) {
      setIds(current?.branchIds ?? []);
      setHome(current?.homeBranchId ?? null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when the dialog opens for a member
  }, [member]);

  const toggle = (id: string, on: boolean) => {
    setIds((x) => (on ? [...new Set([...x, id])] : x.filter((y) => y !== id)));
    if (!on && home === id) setHome(null);
  };
  const homeValid = !home || ids.includes(home);

  const submit = async () => {
    if (!member || !homeValid) return;
    setError(null);
    try {
      await save.mutateAsync({ userId: member.userId, branchIds: ids, defaultBranchId: home ?? (ids.length === 1 ? ids[0]! : null) });
      toast.success(t("growth.branches.assigned", { name: member.name ?? "" }));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("growth.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("growth.branches.assignTitle", { name: member?.name ?? member?.email ?? "" })}</DialogTitle>
          <DialogDescription>{t("growth.branches.assignBody")}</DialogDescription>
        </DialogHeader>
        {error && <InlineError title={error} />}
        <Field>
          <FieldLabel htmlFor={null}>{t("growth.branches.worksIn")}</FieldLabel>
          <div className="grid gap-2">
            {branches.map((b) => {
              const id = `assign-${b.id}`;
              return (
                <div key={b.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                  <Checkbox id={id} checked={ids.includes(b.id)} onCheckedChange={(v) => toggle(b.id, v === true)} />
                  <Label htmlFor={id} className="flex-1 cursor-pointer font-normal">
                    <span className="font-medium">{b.name}</span> <span className="font-mono text-xs text-muted-foreground">{b.code}</span>
                  </Label>
                </div>
              );
            })}
          </div>
          <FieldHint>{t("growth.branches.worksInHint")}</FieldHint>
        </Field>
        {ids.length > 1 && (
          <Field invalid={!homeValid}>
            <FieldLabel htmlFor={null}>{t("growth.branches.homeBranch")}</FieldLabel>
            <RadioGroup value={home ?? ""} onValueChange={(v) => setHome(v || null)} className="grid gap-2">
              {branches
                .filter((b) => ids.includes(b.id))
                .map((b) => (
                  <div key={b.id} className="flex items-center gap-2">
                    <RadioGroupItem id={`home-${b.id}`} value={b.id} />
                    <Label htmlFor={`home-${b.id}`} className="font-normal">
                      {b.name}
                    </Label>
                  </div>
                ))}
            </RadioGroup>
            <FieldHint>{t("growth.branches.homeHint")}</FieldHint>
            <FieldError>{homeValid ? null : t("growth.branches.homeInvalid")}</FieldError>
          </Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("growth.common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            {t("growth.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
