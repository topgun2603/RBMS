"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangleIcon, Loader2Icon, ShieldCheckIcon, UserIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  toast,
} from "@srirealtime/ui";
import {
  ApiError,
  describeError,
  displayName,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  isPlanLimit,
  normalizeTarget,
  useI18n,
  useSession,
} from "@srirealtime/web";
import { DEFAULT_ROLE_KEY } from "../../lib/permissions";
import { useInvite, useRoles, useUpdateMember } from "../../lib/queries";
import type { AssignableLevel, Role, StaffMember } from "../../lib/types";
import { roleDescription, roleName } from "./labels";

const schema = z.object({
  target: z.string().trim(),
  level: z.enum(["staff", "admin"]),
  roleKeys: z.array(z.string()),
});
type Values = z.infer<typeof schema>;

/** Invite a member (phone or email) or change a member's level and roles. */
export function MemberDialog({
  open,
  onOpenChange,
  member,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** null = invite a new member. */
  member: StaffMember | null;
}) {
  const { t } = useI18n();
  const { canManage } = useSession();
  const roles = useRoles(open);
  const invite = useInvite();
  const update = useUpdateMember();
  const busy = invite.isPending || update.isPending;
  const [limit, setLimit] = React.useState<{ limit?: number } | null>(null);
  const editing = !!member;

  const form = useForm<Values>({
    resolver: zodResolver(
      schema.superRefine((v, ctx) => {
        if (editing) return;
        if (!v.target) ctx.addIssue({ code: "custom", path: ["target"], message: "workspace.validation.required" });
        else if (normalizeTarget(v.target).kind === "invalid") ctx.addIssue({ code: "custom", path: ["target"], message: "workspace.validation.target" });
      }),
    ),
    defaultValues: { target: "", level: "staff", roleKeys: [] },
  });

  React.useEffect(() => {
    if (!open) return;
    setLimit(null);
    form.reset({
      target: "",
      level: member?.level === "admin" ? "admin" : "staff",
      roleKeys: member?.roleKeys ?? [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when (re)opened
  }, [open, member?.userId]);

  const level = form.watch("level");
  const assignable = (roles.data ?? []).filter((r) => r.key !== DEFAULT_ROLE_KEY);
  const fallback = (roles.data ?? []).find((r) => r.key === DEFAULT_ROLE_KEY);

  const onSubmit = form.handleSubmit(async (v) => {
    setLimit(null);
    const roleKeys = v.level === "staff" ? v.roleKeys : [];
    try {
      if (member) {
        await update.mutateAsync({ userId: member.userId, body: { level: v.level as AssignableLevel, roleKeys } });
        toast.success(t("workspace.team.updated", { name: displayName(member) }));
      } else {
        const { target } = normalizeTarget(v.target);
        await invite.mutateAsync({ target, level: v.level as AssignableLevel, roleKeys });
        toast.success(t("workspace.team.invited", { target }));
      }
      onOpenChange(false);
    } catch (err) {
      if (isPlanLimit(err)) {
        const d = ((err as ApiError).details ?? {}) as { limit?: number };
        setLimit({ limit: d.limit });
      } else if (err instanceof ApiError && err.status === 409) {
        form.setError("target", { message: "workspace.team.alreadyMember" });
      } else toast.error(describeError(err, t));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" closeLabel={t("workspace.common.close")}>
        <DialogHeader>
          <DialogTitle>{member ? t("workspace.team.editTitle", { name: displayName(member) }) : t("workspace.team.inviteTitle")}</DialogTitle>
          <DialogDescription>{member ? t("workspace.team.editHint") : t("workspace.team.inviteHint")}</DialogDescription>
        </DialogHeader>

        {limit && (
          <Alert className="border-warning/40 bg-warning/10 text-warning-ink">
            <AlertTriangleIcon />
            <AlertTitle>{t("workspace.team.limitTitle")}</AlertTitle>
            <AlertDescription className="text-warning-ink/90">
              {typeof limit.limit === "number" ? t("workspace.team.limitBody", { limit: limit.limit }) : t("workspace.team.limitBodyNoCount")}
            </AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            {!member && (
              <FormField
                control={form.control}
                name="target"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("workspace.team.target")}</FormLabel>
                    <FormControl>
                      <Input autoFocus autoComplete="off" inputMode="email" placeholder={t("workspace.team.targetPlaceholder")} {...field} />
                    </FormControl>
                    <FormDescription>{t("workspace.team.targetHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="level"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("workspace.team.level")}</FormLabel>
                  <div role="radiogroup" aria-label={t("workspace.team.level")} className="grid gap-2 sm:grid-cols-2">
                    {(["staff", "admin"] as const).map((l) => {
                      const Icon = l === "admin" ? ShieldCheckIcon : UserIcon;
                      const disabled = l === "admin" && !canManage;
                      const on = field.value === l;
                      return (
                        <button
                          key={l}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          disabled={disabled}
                          onClick={() => field.onChange(l)}
                          className={cn(
                            "flex items-start gap-3 rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                            on ? "border-primary bg-primary/5 ring-1 ring-primary/40" : "hover:bg-accent/50",
                          )}
                        >
                          <span className={cn("icon-chip size-8 shrink-0", on ? "text-primary" : "text-muted-foreground")}>
                            <Icon className="size-4" />
                          </span>
                          <span className="grid gap-0.5">
                            <span className="text-sm font-medium">{t(`workspace.levels.${l}`)}</span>
                            <span className="text-xs text-muted-foreground">{t(l === "admin" ? "workspace.team.adminHint" : "workspace.team.staffHint")}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {level === "staff" && (
              <FormField
                control={form.control}
                name="roleKeys"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("workspace.team.roles")}</FormLabel>
                    {roles.isPending ? (
                      <div className="grid gap-2">
                        {Array.from({ length: 4 }, (_, i) => (
                          <Skeleton key={i} className="h-14 rounded-xl" />
                        ))}
                      </div>
                    ) : (
                      <RolePicker roles={assignable} value={field.value} onChange={field.onChange} />
                    )}
                    <FormDescription>
                      {fallback ? t("workspace.team.noRoleHint", { role: roleName(t, fallback) }) : t("workspace.team.noRoleHintPlain")}
                    </FormDescription>
                  </FormItem>
                )}
              />
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={busy}>
                {t("workspace.common.cancel")}
              </Button>
              <Button type="submit" size="lg" disabled={busy}>
                {busy && <Loader2Icon className="animate-spin" />}
                {member ? t("workspace.common.save") : t("workspace.team.sendInvite")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function RolePicker({ roles, value, onChange }: { roles: Role[]; value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useI18n();
  const toggle = (key: string, on: boolean) => onChange(on ? [...new Set([...value, key])] : value.filter((k) => k !== key));
  return (
    <div className="grid max-h-72 gap-1.5 overflow-y-auto pr-1">
      {roles.map((r) => {
        const id = `role-${r.key}`;
        const on = value.includes(r.key);
        return (
          <Label
            key={r.key}
            htmlFor={id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 font-normal transition-colors",
              on ? "border-primary/50 bg-primary/5" : "hover:bg-accent/50",
            )}
          >
            <Checkbox id={id} checked={on} onCheckedChange={(c) => toggle(r.key, c === true)} className="mt-0.5" />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{roleName(t, r)}</span>
              {roleDescription(t, r) && <span className="text-xs text-muted-foreground">{roleDescription(t, r)}</span>}
            </span>
          </Label>
        );
      })}
    </div>
  );
}
