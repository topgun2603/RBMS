"use client";

import * as React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, type ControlSize } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { useMe } from "../lib/access";
import { formatPhone } from "../lib/format";
import { useStaff } from "../lib/queries";

const NONE = "__none";

/**
 * Assignee picker. With `staff.manage` it lists the team (GET /v1/staff/members); without it, "Me" and "Unassigned"
 * only (the current assignee still shows as "Someone else").
 */
export function StaffSelect({
  value,
  onChange,
  disabled,
  size = "default",
  id,
  className,
  "aria-label": ariaLabel,
}: {
  value: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  size?: ControlSize;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const { t } = useI18n();
  const me = useMe();
  const staff = useStaff();
  const options = React.useMemo(() => {
    const list = staff.members.filter((m) => m.active).map((m) => ({ id: m.userId, label: m.userId === me.userId ? t("inbox.assign.me") : m.name || formatPhone(m.phone) || m.email || t("inbox.assign.someone") }));
    if (me.userId && !list.some((o) => o.id === me.userId)) list.unshift({ id: me.userId, label: t("inbox.assign.me") });
    if (value && !list.some((o) => o.id === value)) list.push({ id: value, label: t("inbox.assign.someone") });
    return list;
  }, [staff.members, me.userId, value, t]);
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger id={id} size={size} className={className ?? "w-full"} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t("inbox.assign.none")}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Display name of a staff member by id ("You" for me, "Staff" when unknown). */
export function useStaffName() {
  const { t } = useI18n();
  const me = useMe();
  const staff = useStaff();
  return React.useCallback(
    (id: string | null | undefined) => {
      if (!id) return t("inbox.assign.none");
      if (id === me.userId) return t("inbox.assign.you");
      const m = staff.byId.get(id);
      return m?.name || formatPhone(m?.phone) || m?.email || t("inbox.assign.staff");
    },
    [staff.byId, me.userId, t],
  );
}
