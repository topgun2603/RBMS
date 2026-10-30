"use client";

import * as React from "react";
import { KeyRoundIcon, Trash2Icon } from "lucide-react";
import {
  Alert,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  toast,
} from "@rbms/ui";
import { ApiError, describeError, useI18n } from "@rbms/web";
import { pinProblem, usePinActions } from "../../lib/pins";

export interface PinTarget {
  /** "me" = the signed-in member (PUT /pos/pins/me). */
  userId: string | "me";
  name: string;
  hasPin: boolean;
}

/** Set / reset a member's POS PIN (or your own), or remove it. Weak and taken PINs come back from the server too. */
export function PinDialog({ target, onClose }: { target: PinTarget | null; onClose: () => void }) {
  const { t } = useI18n();
  const actions = usePinActions();
  const [pin, setPin] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [server, setServer] = React.useState<string | null>(null);
  const open = !!target;

  React.useEffect(() => {
    if (!open) return;
    setPin("");
    setConfirm("");
    setTouched(false);
    setServer(null);
  }, [open, target?.userId]);

  const problem = pinProblem(pin, confirm);
  const me = target?.userId === "me";

  const errorText = (err: unknown) =>
    err instanceof ApiError && err.code === "pin_weak"
      ? t("workspace.pins.error.weak")
      : err instanceof ApiError && err.code === "pin_taken"
        ? t("workspace.pins.error.taken")
        : describeError(err, t);

  const save = async () => {
    setTouched(true);
    setServer(null);
    if (!target || problem) return;
    try {
      await actions.set.mutateAsync({ userId: target.userId, pin });
      toast.success(me ? t("workspace.pins.savedMine") : t("workspace.pins.saved", { name: target.name }));
      onClose();
    } catch (err) {
      setServer(errorText(err));
    }
  };

  const remove = async () => {
    if (!target || target.userId === "me") return;
    try {
      await actions.remove.mutateAsync(target.userId);
      toast.success(t("workspace.pins.removed", { name: target.name }));
      onClose();
    } catch (err) {
      setServer(errorText(err));
    }
  };

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);
  const showProblem = touched && (problem === "format" || problem === "weak");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm" closeLabel={t("workspace.common.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-5 text-primary" />
            {me ? t("workspace.pins.myTitle") : target?.hasPin ? t("workspace.pins.resetTitle", { name: target.name }) : t("workspace.pins.setTitle", { name: target?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>{me ? t("workspace.pins.myBody") : t("workspace.pins.body")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field invalid={showProblem}>
            <FieldLabel>{t("workspace.pins.new")}</FieldLabel>
            <Input type="password" inputMode="numeric" autoComplete="off" autoFocus value={pin} onChange={(e) => setPin(digits(e.target.value))} className="h-12 text-center font-mono text-xl tracking-[0.4em]" />
            {showProblem ? <FieldError>{t(problem === "weak" ? "workspace.pins.problem.weak" : "workspace.pins.problem.format")}</FieldError> : <FieldHint>{t("workspace.pins.rules")}</FieldHint>}
          </Field>
          <Field invalid={touched && problem === "mismatch"}>
            <FieldLabel>{t("workspace.pins.confirm")}</FieldLabel>
            <Input type="password" inputMode="numeric" autoComplete="off" value={confirm} onChange={(e) => setConfirm(digits(e.target.value))} className="h-12 text-center font-mono text-xl tracking-[0.4em]" />
            {touched && problem === "mismatch" && <FieldError>{t("workspace.pins.problem.mismatch")}</FieldError>}
          </Field>
          {server && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>{server}</AlertTitle>
            </Alert>
          )}
          <DialogFooter className="sm:justify-between">
            {!me && target?.hasPin ? (
              <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void remove()} disabled={actions.remove.isPending}>
                <Trash2Icon /> {t("workspace.pins.remove")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t("workspace.common.cancel")}
              </Button>
              <Button type="submit" disabled={actions.set.isPending}>
                {t("workspace.pins.save")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
