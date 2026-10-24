"use client";

import * as React from "react";
import { Loader2Icon, ShieldCheckIcon } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from "@srirealtime/ui";
import { ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";

/** Header that carries the approving manager's POS PIN (the API's discount guard reads it). */
export const APPROVAL_PIN_HEADER = "x-approval-pin";

/** What the API says about a refused discount (403 `discount_approval_required` / `discount_approval_invalid`). */
export interface DiscountApprovalDetails {
  breached?: Array<"percent" | "amount">;
  requestedPercent?: number;
  requestedAmount?: number;
  maxPercent?: number | null;
  maxAmount?: number | null;
  attemptsLeft?: number;
}

export const needsDiscountApproval = (err: unknown): err is ApiError => err instanceof ApiError && err.code === "discount_approval_required";
const wrongApprover = (err: unknown): err is ApiError => err instanceof ApiError && err.code === "discount_approval_invalid";

/** Thrown by `run` when the cashier closes the approval dialog: the sale simply isn't sent. */
export class ApprovalCancelled extends Error {
  constructor() {
    super("approval cancelled");
    this.name = "ApprovalCancelled";
  }
}

interface Pending {
  details: DiscountApprovalDetails;
  message: string;
  resolve: (pin: string) => void;
  reject: (e: unknown) => void;
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Discount limits with manager approval. `run(send)` calls `send()` without a PIN; when the API answers that the
 * discount needs a manager's approval, a dialog asks for the manager's POS PIN and `send(pin)` is called (again, if the
 * PIN is wrong) until it works or the dialog is closed (`ApprovalCancelled`). Render `dialog` somewhere in the screen.
 *
 *   const approval = useDiscountApproval();
 *   const bill = await approval.run((pin) => createBill(input, pin));
 *   ...
 *   return <>{...}{approval.dialog}</>;
 */
export function useDiscountApproval() {
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const { t } = useI18n();

  const ask = React.useCallback(
    (err: ApiError) =>
      new Promise<string>((resolve, reject) => {
        setError(null);
        setPending({ details: (err.details ?? {}) as DiscountApprovalDetails, message: err.message, resolve, reject });
      }),
    [],
  );

  const run = React.useCallback(
    async <T,>(send: (approvalPin?: string) => Promise<T>): Promise<T> => {
      let pin: string | undefined;
      for (;;) {
        try {
          const result = await send(pin);
          setPending(null);
          setBusy(false);
          return result;
        } catch (err) {
          if (needsDiscountApproval(err) || (pin !== undefined && wrongApprover(err))) {
            if (wrongApprover(err)) {
              const left = (err.details as DiscountApprovalDetails | undefined)?.attemptsLeft;
              setError(left !== undefined ? t("web.approval.wrongLeft", { count: left }) : t("web.approval.wrong"));
            }
            setBusy(false);
            try {
              pin = await ask(err);
              setBusy(true);
            } catch (cancelled) {
              throw cancelled;
            }
            continue;
          }
          setPending(null);
          setBusy(false);
          throw err;
        }
      }
    },
    [ask, t],
  );

  const cancel = () => {
    pending?.reject(new ApprovalCancelled());
    setPending(null);
    setBusy(false);
  };

  const dialog = <ApprovalDialog pending={pending} error={error} busy={busy} onCancel={cancel} />;
  return { run, dialog };
}

function ApprovalDialog({ pending, error, busy, onCancel }: { pending: Pending | null; error: string | null; busy: boolean; onCancel: () => void }) {
  const { t } = useI18n();
  const [pin, setPin] = React.useState("");
  React.useEffect(() => {
    if (pending) setPin("");
  }, [pending]);
  const d = pending?.details ?? {};
  const facts: string[] = [];
  if (d.requestedPercent !== undefined) facts.push(t("web.approval.asked", { percent: d.requestedPercent }));
  if (d.maxPercent !== null && d.maxPercent !== undefined) facts.push(t("web.approval.limitPercent", { percent: d.maxPercent }));
  if (d.requestedAmount !== undefined && d.maxAmount !== null && d.maxAmount !== undefined) {
    facts.push(t("web.approval.askedAmount", { amount: rupees(d.requestedAmount) }), t("web.approval.limitAmount", { amount: rupees(d.maxAmount) }));
  }
  return (
    <Dialog open={!!pending} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm" data-testid="discount-approval">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (pending && pin.trim().length >= 4) {
              pending.resolve(pin.trim());
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheckIcon className="size-5 text-primary" /> {t("web.approval.title")}
            </DialogTitle>
            <DialogDescription>{t("web.approval.hint")}</DialogDescription>
          </DialogHeader>
          {facts.length > 0 && <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{facts.join(" · ")}</p>}
          <Input
            autoFocus
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder={t("web.approval.pin")}
            aria-label={t("web.approval.pin")}
            aria-invalid={!!error}
            className="text-center text-xl tracking-[0.5em]"
          />
          <p className="min-h-4 text-xs text-destructive" aria-live="polite">
            {error}
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t("web.approval.cancel")}
            </Button>
            <Button type="submit" disabled={busy || pin.trim().length < 4}>
              {busy && <Loader2Icon className="animate-spin" />}
              {t("web.approval.approve")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
