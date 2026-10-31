"use client";

import * as React from "react";
import { KeyRoundIcon } from "lucide-react";
import { Alert, AlertTitle, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldError, FieldHint, FieldLabel, Input, toast } from "@rbms/ui";
import { ApiError, describeError, useI18n } from "@rbms/web";
import { pinProblem } from "../lib/pin";
import { useSetMyPin } from "../lib/terminal-api";

/** "My POS PIN": the signed-in member sets the PIN they unlock paired terminals with (PUT /pos/pins/me). */
export function MyPinDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const save = useSetMyPin();
  const [pin, setPin] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [server, setServer] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setPin("");
      setConfirm("");
      setTouched(false);
      setServer(null);
    }
  }, [open]);
  const problem = pinProblem(pin, confirm);

  const submit = async () => {
    setTouched(true);
    setServer(null);
    if (problem) return;
    try {
      await save.mutateAsync(pin);
      toast.success(t("pos.pin.saved"));
      onClose();
    } catch (err) {
      setServer(err instanceof ApiError && (err.code === "pin_weak" || err.code === "pin_taken") ? t(`pos.pin.error.${err.code === "pin_weak" ? "weak" : "taken"}`) : describeError(err, t));
    }
  };

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm" closeLabel={t("pos.common.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-5 text-primary" /> {t("pos.pin.myTitle")}
          </DialogTitle>
          <DialogDescription>{t("pos.pin.myBody")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field invalid={touched && (problem === "format" || problem === "weak")}>
            <FieldLabel>{t("pos.pin.new")}</FieldLabel>
            <Input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(digits(e.target.value))} className="h-12 text-center font-mono text-xl tracking-[0.4em]" autoFocus />
            {touched && (problem === "format" || problem === "weak") ? <FieldError>{t(`pos.pin.problem.${problem}`)}</FieldError> : <FieldHint>{t("pos.pin.rules")}</FieldHint>}
          </Field>
          <Field invalid={touched && problem === "mismatch"}>
            <FieldLabel>{t("pos.pin.confirm")}</FieldLabel>
            <Input type="password" inputMode="numeric" autoComplete="off" value={confirm} onChange={(e) => setConfirm(digits(e.target.value))} className="h-12 text-center font-mono text-xl tracking-[0.4em]" />
            {touched && problem === "mismatch" && <FieldError>{t("pos.pin.problem.mismatch")}</FieldError>}
          </Field>
          {server && (
            <Alert variant="destructive">
              <AlertTitle>{server}</AlertTitle>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("pos.common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {t("pos.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
