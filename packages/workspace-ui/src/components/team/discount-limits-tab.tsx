"use client";

import * as React from "react";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button, Card, Input, Label, Skeleton, toast } from "@srirealtime/ui";
import { describeError, QueryError, useI18n } from "@srirealtime/web";
import { rupeesToPaise, useDeleteDiscountLimit, useDiscountLimits, useSaveDiscountLimit, type DiscountLimit } from "../../lib/discount-limits";
import { useMembers, useRoles } from "../../lib/queries";
import { roleName } from "./labels";

const money = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const SELECT =
  "h-10 w-full rounded-lg border bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Team & roles → Discount limits: a max discount percent and / or amount per bill, for a role or one person. */
export function DiscountLimitsTab() {
  const { t } = useI18n();
  const limits = useDiscountLimits();
  const roles = useRoles();
  const members = useMembers();
  const save = useSaveDiscountLimit();
  const del = useDeleteDiscountLimit();
  const [scope, setScope] = React.useState<"role" | "user">("role");
  const [subject, setSubject] = React.useState("");
  const [percent, setPercent] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const roleOptions = (roles.data ?? []).filter((r) => r.key !== "owner" && r.key !== "admin").map((r) => ({ value: r.key, label: roleName(t, r) }));
  const staffOptions = (members.data ?? []).filter((m) => m.level === "staff" && m.active).map((m) => ({ value: m.userId, label: m.name || m.phone || m.email || m.userId }));
  const options = scope === "role" ? roleOptions : staffOptions;
  const nameOf = (l: DiscountLimit) =>
    (l.scope === "role" ? roleOptions : staffOptions).find((o) => o.value === l.subject)?.label ?? (l.subject === "default" ? t("workspace.discounts.defaultRole") : l.subject);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const maxPercent = percent.trim() === "" ? null : Number(percent);
    if (maxPercent !== null && (!Number.isFinite(maxPercent) || maxPercent < 0 || maxPercent > 100)) return setError(t("workspace.discounts.badPercent"));
    const paise = rupeesToPaise(amount);
    if (paise === undefined) return setError(t("workspace.discounts.badAmount"));
    if (maxPercent === null && paise === null) return setError(t("workspace.discounts.needOne"));
    if (!subject) return;
    save.mutate(
      { scope, subject, maxPercent, maxAmount: paise },
      {
        onSuccess: () => {
          toast.success(t("workspace.discounts.saved"));
          setSubject("");
          setPercent("");
          setAmount("");
        },
        onError: (err) => toast.error(describeError(err, t)),
      },
    );
  };

  return (
    <div className="grid gap-4" data-testid="discount-limits">
      <p className="text-sm text-muted-foreground">{t("workspace.discounts.body")}</p>
      {limits.error && !limits.data ? (
        <QueryError error={limits.error} onRetry={() => void limits.refetch()} />
      ) : !limits.data ? (
        <Skeleton className="h-32 rounded-2xl" />
      ) : limits.data.length === 0 ? (
        <p className="rounded-xl border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">{t("workspace.discounts.empty")}</p>
      ) : (
        <Card className="divide-y p-0">
          {limits.data.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{nameOf(l)}</p>
                <p className="text-xs text-muted-foreground">{t(`workspace.discounts.scope.${l.scope}`)}</p>
              </div>
              <p className="tabular-nums">{l.maxPercent === null ? t("workspace.discounts.none") : `${l.maxPercent}%`}</p>
              <p className="tabular-nums">{l.maxAmount === null ? t("workspace.discounts.none") : money(l.maxAmount)}</p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("workspace.discounts.remove")}
                disabled={del.isPending}
                onClick={() => del.mutate(l, { onSuccess: () => toast.success(t("workspace.discounts.removed")), onError: (err) => toast.error(describeError(err, t)) })}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </Card>
      )}

      <Card className="p-4">
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          <h3 className="font-medium sm:col-span-2">{t("workspace.discounts.add")}</h3>
          <div className="grid gap-1.5">
            <Label htmlFor="dl-scope">{t("workspace.discounts.scope")}</Label>
            <select
              id="dl-scope"
              className={SELECT}
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as "role" | "user");
                setSubject("");
              }}
            >
              <option value="role">{t("workspace.discounts.scope.role")}</option>
              <option value="user">{t("workspace.discounts.scope.user")}</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dl-subject">{t("workspace.discounts.subject")}</Label>
            <select id="dl-subject" className={SELECT} value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">{t("workspace.discounts.pick")}</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dl-percent">{t("workspace.discounts.percent")}</Label>
            <Input id="dl-percent" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="10" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dl-amount">{t("workspace.discounts.amount")}</Label>
            <Input id="dl-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500" />
          </div>
          {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={save.isPending || !subject}>
              {save.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
              {t("workspace.discounts.save")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("workspace.discounts.approverNote")}</p>
          </div>
        </form>
      </Card>
    </div>
  );
}
