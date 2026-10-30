"use client";

import * as React from "react";
import { KeyRoundIcon, Loader2Icon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rbms/ui";
import { describeError, useI18n, useOptionalSession } from "@rbms/web";
import { EXPIRY_PRESETS, expiryInFuture, expiryToIso, tomorrowIST, type ExpiryPreset } from "../../lib/developer";
import { useCreateKey, useScopes } from "../../lib/queries/developer";
import { InlineError } from "../bits";
import { ScopePicker } from "./scope-picker";

/** "Create API key": name, scopes, expiry. Calls `onCreated(token)` so the page can show the key once. */
export function CreateKeyDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (token: string, name: string) => void }) {
  const { t } = useI18n();
  const session = useOptionalSession();
  const scopes = useScopes();
  const create = useCreateKey();
  const [name, setName] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [preset, setPreset] = React.useState<ExpiryPreset>("never");
  const [custom, setCustom] = React.useState("");
  const [tried, setTried] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setSelected(new Set());
    setPreset("never");
    setCustom("");
    setTried(false);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canGrant = React.useCallback((key: string) => (session ? session.can(key) : true), [session]);
  const expiresAt = expiryToIso(preset, custom);
  const nameError = tried && !name.trim() ? t("growth.developer.keys.nameRequired") : null;
  const scopeError = tried && selected.size === 0 ? t("growth.developer.keys.scopesRequired") : null;
  const expiryError =
    tried && preset === "custom" && (expiresAt === undefined || !expiryInFuture(expiresAt)) ? t("growth.developer.keys.expiryInvalid") : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!name.trim() || selected.size === 0 || expiresAt === undefined || !expiryInFuture(expiresAt)) return;
    try {
      const res = await create.mutateAsync({ name: name.trim(), scopes: [...selected], expiresAt });
      onOpenChange(false);
      onCreated(res.token, res.key.name);
    } catch {
      // shown inline below
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent closeLabel={t("growth.common.close")} className="grid max-h-[92dvh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-4 text-primary" />
            {t("growth.developer.keys.createTitle")}
          </DialogTitle>
          <DialogDescription>{t("growth.developer.keys.createBody")}</DialogDescription>
        </DialogHeader>
        <form id="create-api-key" onSubmit={submit} className="-mx-1 grid min-h-0 content-start gap-5 overflow-y-auto px-1" noValidate>
          <FieldRow cols={2}>
            <Field invalid={!!nameError}>
              <FieldLabel>{t("growth.developer.keys.name")}</FieldLabel>
              <FieldControl>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("growth.developer.keys.namePlaceholder")} autoFocus autoComplete="off" />
              </FieldControl>
              <FieldHint>{t("growth.developer.keys.nameHint")}</FieldHint>
              <FieldError>{nameError}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("growth.developer.keys.expiry")}</FieldLabel>
              <FieldControl>
                <Select value={preset} onValueChange={(v) => setPreset(v as ExpiryPreset)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_PRESETS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {t(`growth.developer.keys.expiryPresets.${p}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldControl>
              <FieldHint>{t("growth.developer.keys.expiryHint")}</FieldHint>
            </Field>
          </FieldRow>
          {preset === "custom" && (
            <FieldRow cols={2}>
              <Field invalid={!!expiryError}>
                <FieldLabel>{t("growth.developer.keys.expiryDate")}</FieldLabel>
                <FieldControl>
                  <Input type="date" value={custom} min={tomorrowIST()} onChange={(e) => setCustom(e.target.value)} />
                </FieldControl>
                <FieldError>{expiryError}</FieldError>
              </Field>
            </FieldRow>
          )}
          <Field invalid={!!scopeError}>
            <FieldLabel htmlFor={null}>{t("growth.developer.keys.scopes")}</FieldLabel>
            <ScopePicker
              id="key-scopes"
              scopes={scopes.data?.items ?? []}
              loading={scopes.isPending}
              selected={selected}
              onChange={setSelected}
              canGrant={canGrant}
              invalid={!!scopeError}
            />
            <FieldHint>{t("growth.developer.keys.scopesHint")}</FieldHint>
            <FieldError>{scopeError}</FieldError>
          </Field>
          {scopes.isError && <InlineError title={describeError(scopes.error, t)} />}
          {create.isError && <InlineError title={t("growth.developer.keys.createFailed")}>{describeError(create.error, t)}</InlineError>}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            {t("growth.common.cancel")}
          </Button>
          <Button type="submit" form="create-api-key" disabled={create.isPending}>
            {create.isPending && <Loader2Icon className="animate-spin" />}
            {t("growth.developer.keys.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
