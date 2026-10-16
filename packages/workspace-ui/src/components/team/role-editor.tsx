"use client";

import * as React from "react";
import { Loader2Icon, SparklesIcon, XIcon } from "lucide-react";
import {
  Button,
  Checkbox,
  cn,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { describeError, QueryError, useI18n } from "@srirealtime/web";
import { coveringPattern, isPattern, roleKeyFrom } from "../../lib/permissions";
import { usePermissionGroups, useSaveRole } from "../../lib/queries";
import type { PermissionGroup, Role } from "../../lib/types";
import { moduleLabel, patternLabel, permDescription, permLabel, roleDescription, roleName } from "./labels";

export type RoleDraft = { mode: "new"; from?: Role } | { mode: "edit"; role: Role };

const VIEW_ALL = "*.view";

/** Create, duplicate or edit a role: name, description and a permission matrix grouped by module. */
export function RoleEditor({ draft, onClose, takenKeys }: { draft: RoleDraft | null; onClose: () => void; takenKeys: ReadonlySet<string> }) {
  const { t } = useI18n();
  const groups = usePermissionGroups(!!draft);
  const save = useSaveRole();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [perms, setPerms] = React.useState<string[]>([]);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const editing = draft?.mode === "edit" ? draft.role : null;

  React.useEffect(() => {
    if (!draft) return;
    const src = draft.mode === "edit" ? draft.role : draft.from;
    setName(draft.mode === "edit" ? roleName(t, draft.role) : src ? t("workspace.roles.copyOf", { name: roleName(t, src) }) : "");
    setDescription(src ? roleDescription(t, src) : "");
    setPerms(src?.permissions ?? []);
    setNameError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when a new draft opens
  }, [draft]);

  const registryKeys = React.useMemo(() => new Set((groups.data ?? []).flatMap((g) => g.permissions.map((p) => p.key))), [groups.data]);
  /** Patterns ("*.view", "orders.*") and keys no mounted module declares: kept as they are, removable. */
  const extras = perms.filter((p) => !registryKeys.has(p) && p !== VIEW_ALL);
  const key = editing?.key ?? roleKeyFrom(name, takenKeys);

  const toggle = (k: string, on: boolean) => setPerms((p) => (on ? [...new Set([...p, k])] : p.filter((x) => x !== k)));
  const toggleMany = (keys: string[], on: boolean) =>
    setPerms((p) => (on ? [...new Set([...p, ...keys])] : p.filter((x) => !keys.includes(x))));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError(t("workspace.validation.required"));
      return;
    }
    // Saving a translated built-in name would rename it; keep the stored name unless the owner changed it.
    const unchangedBuiltinName = editing?.builtin && name.trim() === roleName(t, editing);
    const unchangedBuiltinDesc = editing?.builtin && description.trim() === roleDescription(t, editing);
    try {
      await save.mutateAsync({
        key,
        isNew: !editing,
        body: {
          key,
          name: unchangedBuiltinName ? editing.name : name.trim(),
          description: unchangedBuiltinDesc ? editing.description : description.trim(),
          permissions: perms,
        },
      });
      toast.success(t(editing ? "workspace.roles.saved" : "workspace.roles.created", { name: name.trim() }));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Sheet open={!!draft} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl" closeLabel={t("workspace.common.close")}>
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>{editing ? t("workspace.roles.editTitle") : t("workspace.roles.newTitle")}</SheetTitle>
          <SheetDescription>{t("workspace.roles.editorHint")}</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-5 py-4">
            <FieldRow cols={2}>
              <Field id="role-name" invalid={!!nameError}>
                <FieldLabel>{t("workspace.roles.name")}</FieldLabel>
                <FieldControl>
                  <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                </FieldControl>
                {nameError ? <FieldError>{nameError}</FieldError> : <FieldHint className="font-mono">{t("workspace.roles.keyHint", { key })}</FieldHint>}
              </Field>
              <Field id="role-desc">
                <FieldLabel>{t("workspace.roles.description")}</FieldLabel>
                <FieldControl>
                  <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
                </FieldControl>
              </Field>
            </FieldRow>

            <Label htmlFor="role-view-all" className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3 font-normal">
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{t("workspace.roles.pattern.viewAll")}</span>
                <span className="text-xs text-muted-foreground">{t("workspace.roles.viewAllHint")}</span>
              </span>
              <Switch id="role-view-all" checked={perms.includes(VIEW_ALL)} onCheckedChange={(on) => toggle(VIEW_ALL, on)} />
            </Label>

            {extras.length > 0 && (
              <div className="grid gap-2">
                <p className="text-sm font-medium">{t("workspace.roles.extras")}</p>
                <p className="text-meta text-muted-foreground">{t("workspace.roles.extrasHint")}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {extras.map((p) => (
                    <li key={p} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-2.5 text-xs">
                      <SparklesIcon className="size-3 text-primary" />
                      <span className="font-medium">{patternLabel(t, p)}</span>
                      <code className="text-xs text-muted-foreground">{p}</code>
                      <button
                        type="button"
                        onClick={() => toggle(p, false)}
                        className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={t("workspace.roles.removeGrant", { name: patternLabel(t, p) })}
                      >
                        <XIcon className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {groups.isError ? (
              <QueryError compact error={groups.error} onRetry={() => void groups.refetch()} />
            ) : groups.isPending ? (
              <div className="grid gap-3">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-36 rounded-2xl" />
                ))}
              </div>
            ) : (
              <div className="grid gap-3">
                {groups.data.map((g) => (
                  <ModuleGroup key={g.module} group={g} perms={perms} onToggle={toggle} onToggleMany={toggleMany} />
                ))}
              </div>
            )}
          </div>
          <SheetFooter className="flex-row justify-end gap-2 border-t px-5 py-3">
            <Button type="button" variant="outline" size="lg" onClick={onClose} disabled={save.isPending}>
              {t("workspace.common.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {editing ? t("workspace.common.save") : t("workspace.roles.create")}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ModuleGroup({
  group,
  perms,
  onToggle,
  onToggleMany,
}: {
  group: PermissionGroup;
  perms: string[];
  onToggle: (k: string, on: boolean) => void;
  onToggleMany: (keys: string[], on: boolean) => void;
}) {
  const { t } = useI18n();
  const keys = group.permissions.map((p) => p.key);
  const has = (k: string) => perms.includes(k) || !!coveringPattern(perms, k);
  const count = keys.filter(has).length;
  const all = count === keys.length;
  const id = `perm-mod-${group.module}`;
  return (
    <section aria-labelledby={id} className="rounded-2xl border bg-card">
      <header className="flex items-center gap-3 border-b px-4 py-2.5">
        <Checkbox
          id={`${id}-all`}
          checked={all ? true : count > 0 ? "indeterminate" : false}
          onCheckedChange={() => onToggleMany(keys.filter((k) => !coveringPattern(perms, k)), !all)}
          aria-label={t("workspace.roles.selectAll", { module: moduleLabel(t, group.module) })}
        />
        <h3 id={id} className="flex-1 text-sm font-semibold">
          {moduleLabel(t, group.module)}
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {count}/{keys.length}
        </span>
      </header>
      <ul className="divide-y divide-border/60">
        {group.permissions.map((p) => {
          const via = isPattern(p.key) ? null : coveringPattern(perms, p.key);
          const checked = perms.includes(p.key) || !!via;
          const cid = `perm-${p.key}`;
          return (
            <li key={p.key}>
              <Label htmlFor={cid} className={cn("flex items-start gap-3 px-4 py-2.5 font-normal", via ? "cursor-default" : "cursor-pointer hover:bg-accent/40")}>
                <Checkbox id={cid} checked={checked} disabled={!!via} onCheckedChange={(c) => onToggle(p.key, c === true)} className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{permLabel(t, p)}</span>
                  {permDescription(t, p) && <span className="text-xs text-muted-foreground">{permDescription(t, p)}</span>}
                  {via && <span className="text-xs text-primary">{t("workspace.roles.includedBy", { grant: patternLabel(t, via) })}</span>}
                </span>
              </Label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
