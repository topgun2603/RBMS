"use client";

import * as React from "react";
import { Loader2Icon, TruckIcon, Undo2Icon, XCircleIcon } from "lucide-react";
import {
  Button,
  ChipGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { describeError, useFeature, useI18n } from "@srirealtime/web";
import { usePermissions } from "../lib/access";
import { orNull } from "../lib/format";
import { useUpdateStatus } from "../lib/queries";
import { dialogFor, transitionPermissions, type TransitionDialog } from "../lib/status";
import type { Fulfillment, OrderStatus } from "../lib/types";
import { Field } from "./bits";

/** What the mover needs to know about an order (a list row or the full order). */
export interface MovableOrder {
  id: string;
  number: string;
  status: OrderStatus;
}

interface PendingMove {
  order: MovableOrder;
  to: OrderStatus;
  kind: Exclude<TransitionDialog, null>;
}

/**
 * Moving orders along their flow, shared by the list, the board and the detail page. Moves that need input (cancel
 * with a reason, return, ship with tracking) open a dialog; the rest run at once with an optimistic update.
 * Render `dialogs` once in the page.
 */
export function useStatusMover() {
  const { t } = useI18n();
  const update = useUpdateStatus();
  const { can } = usePermissions();
  const [pending, setPending] = React.useState<PendingMove | null>(null);

  const canMove = React.useCallback((to: OrderStatus) => can(transitionPermissions(to)), [can]);

  const run = React.useCallback(
    async (order: MovableOrder, to: OrderStatus, extra: { note?: string | null; fulfillment?: Fulfillment } = {}) => {
      try {
        await update.mutateAsync({ id: order.id, from: order.status, body: { status: to, ...extra } });
        toast.success(t("orders.move.done", { number: order.number, status: t(`orders.status.${to}`) }));
      } catch (err) {
        toast.error(describeError(err, t));
        throw err;
      }
    },
    [update, t],
  );

  const request = React.useCallback(
    (order: MovableOrder, to: OrderStatus) => {
      if (!canMove(to)) {
        toast.error(t("orders.errors.permission_denied"));
        return;
      }
      const kind = dialogFor(to);
      if (kind) setPending({ order, to, kind });
      else void run(order, to).catch(() => undefined);
    },
    [canMove, run, t],
  );

  const dialogs = (
    <>
      <CancelDialog
        move={pending?.kind === "cancel" ? pending : null}
        onClose={() => setPending(null)}
        onConfirm={(note) => run(pending!.order, pending!.to, { note })}
      />
      <ReturnDialog
        move={pending?.kind === "return" ? pending : null}
        onClose={() => setPending(null)}
        onConfirm={(note) => run(pending!.order, pending!.to, { note })}
      />
      <ShipDialog
        move={pending?.kind === "ship" ? pending : null}
        onClose={() => setPending(null)}
        onConfirm={(fulfillment, note) => run(pending!.order, pending!.to, { fulfillment, note })}
      />
    </>
  );

  return { request, canMove, dialogs, busyId: update.isPending ? (update.variables?.id ?? null) : null };
}

const CANCEL_REASONS = ["customer", "stock", "payment", "duplicate", "address"] as const;

function CancelDialog({ move, onClose, onConfirm }: { move: PendingMove | null; onClose: () => void; onConfirm: (note: string) => Promise<void> }) {
  const { t } = useI18n();
  const [preset, setPreset] = React.useState<string>("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (move) {
      setPreset("");
      setReason("");
      setError(null);
    }
  }, [move]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = reason.trim() || (preset ? t(`orders.cancel.reason.${preset}`) : "");
    if (!text) {
      setError(t("orders.cancel.reasonRequired"));
      return;
    }
    setBusy(true);
    try {
      await onConfirm(text);
      onClose();
    } catch {
      // toast shown by the mover
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!move} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("orders.common.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="icon-chip size-8 text-danger-ink">
              <XCircleIcon className="size-4" />
            </span>
            {t("orders.cancel.title", { number: move?.order.number ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("orders.cancel.body")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <ChipGroup
            size="sm"
            className="flex-wrap"
            aria-label={t("orders.cancel.reasonLabel")}
            value={preset}
            onChange={(v) => {
              setPreset(v);
              setReason(t(`orders.cancel.reason.${v}`));
              setError(null);
            }}
            options={CANCEL_REASONS.map((r) => ({ value: r, label: t(`orders.cancel.reason.${r}`) }))}
          />
          <Field label={t("orders.cancel.reasonLabel")} htmlFor="cancel-reason" error={error}>
            <Textarea
              id="cancel-reason"
              rows={3}
              value={reason}
              maxLength={500}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              placeholder={t("orders.cancel.reasonPlaceholder")}
            />
          </Field>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t("orders.cancel.keep")}
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              {t("orders.cancel.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReturnDialog({ move, onClose, onConfirm }: { move: PendingMove | null; onClose: () => void; onConfirm: (note: string | null) => Promise<void> }) {
  const { t } = useI18n();
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (move) setNote("");
  }, [move]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onConfirm(orNull(note));
      onClose();
    } catch {
      // toast shown by the mover
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!move} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("orders.common.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="icon-chip size-8 text-warning-ink">
              <Undo2Icon className="size-4" />
            </span>
            {t("orders.return.title", { number: move?.order.number ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("orders.return.body")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label={t("orders.return.note")} htmlFor="return-note" optional>
            <Textarea id="return-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("orders.return.notePlaceholder")} />
          </Field>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t("orders.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              {t("orders.return.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShipDialog({
  move,
  onClose,
  onConfirm,
}: {
  move: PendingMove | null;
  onClose: () => void;
  onConfirm: (f: Fulfillment | undefined, note: string | null) => Promise<void>;
}) {
  const { t } = useI18n();
  const delivery = useFeature("delivery");
  const [carrier, setCarrier] = React.useState("");
  const [awb, setAwb] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (move) {
      setCarrier("");
      setAwb("");
      setUrl("");
      setError(null);
    }
  }, [move]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = url.trim();
    if (u && !/^https?:\/\/\S+\.\S+/.test(u)) {
      setError(t("orders.validation.url"));
      return;
    }
    const f: Fulfillment = { carrier: orNull(carrier), trackingNumber: orNull(awb), trackingUrl: orNull(u) };
    const any = f.carrier || f.trackingNumber || f.trackingUrl;
    setBusy(true);
    try {
      await onConfirm(any ? f : undefined, null);
      onClose();
    } catch {
      // toast shown by the mover
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!move} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("orders.common.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="icon-chip size-8 text-info-ink">
              <TruckIcon className="size-4" />
            </span>
            {t("orders.ship.title", { number: move?.order.number ?? "" })}
          </DialogTitle>
          <DialogDescription>{delivery ? t("orders.ship.bodyDelivery") : t("orders.ship.body")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("orders.ship.courier")} htmlFor="ship-courier" optional>
              <Input id="ship-courier" className="h-11" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder={t("orders.ship.courierPlaceholder")} />
            </Field>
            <Field label={t("orders.ship.awb")} htmlFor="ship-awb" optional>
              <Input id="ship-awb" className="h-11" value={awb} onChange={(e) => setAwb(e.target.value)} autoComplete="off" />
            </Field>
          </div>
          <Field label={t("orders.ship.url")} htmlFor="ship-url" optional error={error}>
            <Input id="ship-url" type="url" inputMode="url" className="h-11" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </Field>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t("orders.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              {t("orders.ship.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
