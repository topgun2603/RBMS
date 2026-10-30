"use client";

import * as React from "react";
import { BanIcon, CheckCircle2Icon, MoreVerticalIcon, RefreshCwIcon, RotateCwIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  toast,
} from "@rbms/ui";
import { ConfirmDialog, describeError, useI18n } from "@rbms/web";
import { SubmitButton } from "../components/account";
import { canCancelPayout, canMarkPaid, canRefreshPayout, canRetryPayout, money } from "../lib/logic";
import { usePayoutAction } from "../lib/queries";
import type { Payout } from "../lib/types";

/** Retry / mark paid / cancel / refresh for one payout (only the moves the server allows). */
export function PayoutActions({ payout: p }: { payout: Payout }) {
  const { t } = useI18n();
  const act = usePayoutAction();
  const [marking, setMarking] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [ref, setRef] = React.useState("");
  const [tried, setTried] = React.useState(false);

  const retry = canRetryPayout(p);
  const paid = canMarkPaid(p);
  const cancel = canCancelPayout(p);
  const refresh = canRefreshPayout(p);
  if (!retry && !paid && !cancel && !refresh) return null;

  const run = async (action: "retry" | "refresh") => {
    try {
      await act.mutateAsync({ id: p.id, action });
      toast.success(t(action === "retry" ? "marketplace.payouts.retried" : "marketplace.payouts.refreshed"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const markPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!ref.trim()) return;
    try {
      await act.mutateAsync({ id: p.id, action: "mark-paid", reference: ref.trim() });
      toast.success(t("marketplace.payouts.markedPaid"));
      setMarking(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <>
      {paid && (
        <Button
          size="sm"
          onClick={() => {
            setRef("");
            setTried(false);
            setMarking(true);
          }}
        >
          <CheckCircle2Icon /> {t("marketplace.payouts.markPaid")}
        </Button>
      )}
      {retry && !paid && (
        <Button size="sm" variant="outline" onClick={() => void run("retry")} disabled={act.isPending}>
          <RotateCwIcon /> {t("marketplace.payouts.retry")}
        </Button>
      )}
      {(cancel || refresh || (retry && paid)) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("marketplace.common.more")}>
              <MoreVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {retry && paid && (
              <DropdownMenuItem className="h-10" onSelect={() => void run("retry")}>
                <RotateCwIcon /> {t("marketplace.payouts.retry")}
              </DropdownMenuItem>
            )}
            {refresh && (
              <DropdownMenuItem className="h-10" onSelect={() => void run("refresh")}>
                <RefreshCwIcon /> {t("marketplace.payouts.refresh")}
              </DropdownMenuItem>
            )}
            {cancel && (
              <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => setCancelling(true)}>
                <BanIcon /> {t("marketplace.payouts.cancel")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={marking} onOpenChange={setMarking}>
        <DialogContent closeLabel={t("marketplace.common.close")}>
          <form onSubmit={markPaid} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>{t("marketplace.payouts.markPaidTitle", { amount: money(p.amount) })}</DialogTitle>
              <DialogDescription>{t("marketplace.payouts.markPaidBody", { name: p.vendorName ?? "" })}</DialogDescription>
            </DialogHeader>
            <Field invalid={tried && !ref.trim()}>
              <FieldLabel>{t("marketplace.payouts.reference")}</FieldLabel>
              <FieldControl>
                <Input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} autoFocus />
              </FieldControl>
              <FieldHint>{t("marketplace.payouts.referenceHint")}</FieldHint>
              <FieldError>{tried && !ref.trim() ? t("marketplace.validation.required") : null}</FieldError>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMarking(false)}>
                {t("marketplace.common.cancel")}
              </Button>
              <SubmitButton pending={act.isPending}>{t("marketplace.payouts.markPaid")}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t("marketplace.payouts.cancelTitle", { amount: money(p.amount) })}
        description={t("marketplace.payouts.cancelBody")}
        confirmLabel={t("marketplace.payouts.cancel")}
        onConfirm={async () => {
          try {
            await act.mutateAsync({ id: p.id, action: "cancel" });
            toast.success(t("marketplace.payouts.cancelled"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </>
  );
}
