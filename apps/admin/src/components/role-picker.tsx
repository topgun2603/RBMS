"use client";

import { Checkbox, cn, Label } from "@srirealtime/ui";
import { useI18n } from "@/lib/i18n";

export const TENANT_ROLES = ["owner", "admin", "member"] as const;

/** Checkbox list of tenant roles with a one-line description each. */
export function RolePicker({
  value,
  onChange,
  disabled,
  idPrefix = "role",
}: {
  value: string[];
  onChange: (roles: string[]) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const { t } = useI18n();
  const toggle = (role: string, on: boolean) => onChange(on ? [...new Set([...value, role])] : value.filter((r) => r !== role));
  return (
    <div className="grid gap-2">
      {TENANT_ROLES.map((role) => {
        const id = `${idPrefix}-${role}`;
        const checked = value.includes(role);
        return (
          <Label
            key={role}
            htmlFor={id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal transition-colors hover:bg-accent/50",
              checked && "border-primary/50 bg-primary/5",
            )}
          >
            <Checkbox id={id} checked={checked} onCheckedChange={(v) => toggle(role, v === true)} disabled={disabled} className="mt-0.5" />
            <span className="grid gap-1">
              <span className="text-sm font-medium">{t(`admin.roles.${role}`)}</span>
              <span className="text-xs leading-snug text-muted-foreground">{t(`admin.roles.${role}Hint`)}</span>
            </span>
          </Label>
        );
      })}
    </div>
  );
}
