"use client";

import * as React from "react";
import {
  ExternalLinkIcon,
  FastForwardIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  StickyNoteIcon,
  TagIcon,
  TruckIcon,
  XIcon,
} from "lucide-react";
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
  Skeleton,
  toast,
} from "@srirealtime/ui";
import { absoluteUrl, ConfirmDialog, describeError, useFeature, useI18n } from "@srirealtime/web";
import { PERMS, usePermissions } from "../../lib/access";
import { orNull } from "../../lib/format";
import { useOrderAction, useShipmentAction, useShipments } from "../../lib/queries";
import type { CarrierProvider, Order, PackageDims, Shipment } from "../../lib/types";
import { CopyButton, Field, Optional, Section } from "../bits";
import { ShipmentPill } from "../pills";

const TERMINAL = ["delivered", "rto", "cancelled"];
/** The mock carrier only exists on development APIs; the server refuses it elsewhere. */
const DEV = process.env.NODE_ENV !== "production";

/**
 * Fulfilment: with `delivery` the order's shipments (create manual/carrier, label, tracking, cancel, dev "advance");
 * without it the plain shipping details (courier, tracking number, URL) stored on the order.
 */
export function ShippingCard({ order }: { order: Order }) {
  const { t } = useI18n();
  const delivery = useFeature("delivery");
  const { can } = usePermissions();
  const canShip = can(PERMS.manage);
  const shipments = useShipments(order.id, delivery);
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const closed = ["cancelled", "returned", "delivered"].includes(order.status);
  const f = order.fulfillment ?? {};
  const hasDetails = !!(f.carrier || f.trackingNumber || f.trackingUrl);
  const open = (shipments.data ?? []).filter((s) => !TERMINAL.includes(s.status));
  const noAddress = !order.shippingAddress;

  return (
    <Section
      icon={TruckIcon}
      tone="text-info-ink"
      title={t("orders.ship.cardTitle")}
      description={noAddress ? t("orders.ship.noAddress") : delivery ? t("orders.ship.cardHint") : t("orders.ship.cardHintManual")}
      action={
        canShip && !closed ? (
          delivery ? (
            open.length === 0 && (
              <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                <PlusIcon /> {t("orders.ship.create")}
              </Button>
            )
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <PencilIcon /> {hasDetails ? t("orders.common.edit") : t("orders.ship.addDetails")}
            </Button>
          )
        ) : undefined
      }
    >
      {delivery ? (
        shipments.isPending ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : (shipments.data ?? []).length === 0 ? (
          hasDetails ? (
            <FulfillmentDetails order={order} />
          ) : (
            <p className="text-sm text-muted-foreground">{closed ? t("orders.ship.none") : t("orders.ship.noneYet")}</p>
          )
        ) : (
          <div className="grid gap-3">
            {(shipments.data ?? []).map((s) => (
              <ShipmentRow key={s.id} order={order} shipment={s} canShip={canShip} />
            ))}
          </div>
        )
      ) : hasDetails ? (
        <FulfillmentDetails order={order} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("orders.ship.noneYet")}</p>
      )}
      {delivery && <CreateShipmentDialog order={order} open={creating} onOpenChange={setCreating} />}
      <FulfillmentDialog order={order} open={editing} onOpenChange={setEditing} />
    </Section>
  );
}

function FulfillmentDetails({ order }: { order: Order }) {
  const { t } = useI18n();
  const f = order.fulfillment;
  return (
    <dl className="grid gap-2 text-sm">
      {f.carrier && (
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("orders.ship.courier")}</dt>
          <dd className="font-medium">{f.carrier}</dd>
        </div>
      )}
      {f.trackingNumber && (
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t("orders.ship.awb")}</dt>
          <dd className="flex items-center gap-1 font-medium tabular-nums">
            {f.trackingNumber}
            <CopyButton value={f.trackingNumber} variant="ghost" size="icon-sm" />
          </dd>
        </div>
      )}
      {f.trackingUrl && (
        <Button asChild variant="outline" size="sm" className="w-fit">
          <a href={f.trackingUrl} target="_blank" rel="noreferrer">
            <ExternalLinkIcon /> {t("orders.ship.track")}
          </a>
        </Button>
      )}
    </dl>
  );
}

function ShipmentRow({ order, shipment: s, canShip }: { order: Order; shipment: Shipment; canShip: boolean }) {
  const { t, formatDate } = useI18n();
  const act = useShipmentAction(order.id);
  const [cancelling, setCancelling] = React.useState(false);
  const terminal = TERMINAL.includes(s.status);
  const run = async (kind: "refresh" | "mock-advance" | "cancel") => {
    try {
      await act.mutateAsync({ kind, id: s.id });
      toast.success(t(`orders.ship.done.${kind}`));
    } catch (err) {
      toast.error(describeError(err, t));
      throw err;
    }
  };
  const label = absoluteUrl(s.labelUrl);
  const events = [...s.events].reverse().slice(0, 5);

  return (
    <div className="grid gap-3 rounded-xl border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ShipmentPill status={s.status} />
        <span className="text-sm font-medium">{s.courier || t(`orders.ship.provider.${s.provider}`)}</span>
        <span className="text-xs text-muted-foreground">· {t(`orders.ship.provider.${s.provider}`)}</span>
      </div>
      {s.awb && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("orders.ship.awb")}</span>
          <span className="font-semibold tabular-nums">{s.awb}</span>
          <CopyButton value={s.awb} variant="ghost" size="icon-sm" />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {s.trackingUrl && (
          <Button asChild variant="outline" size="sm">
            <a href={s.trackingUrl} target="_blank" rel="noreferrer">
              <ExternalLinkIcon /> {t("orders.ship.track")}
            </a>
          </Button>
        )}
        {label && (
          <Button asChild variant="outline" size="sm">
            <a href={label} target="_blank" rel="noreferrer">
              <TagIcon /> {t("orders.ship.carrierLabel")}
            </a>
          </Button>
        )}
        {canShip && s.provider === "shiprocket" && !terminal && (
          <Button variant="ghost" size="sm" disabled={act.isPending} onClick={() => void run("refresh").catch(() => undefined)}>
            {act.isPending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} {t("orders.ship.refresh")}
          </Button>
        )}
        {canShip && s.provider === "mock" && !terminal && (
          <Button variant="ghost" size="sm" disabled={act.isPending} onClick={() => void run("mock-advance").catch(() => undefined)}>
            {act.isPending ? <Loader2Icon className="animate-spin" /> : <FastForwardIcon />} {t("orders.ship.mockAdvance")}
          </Button>
        )}
        {canShip && !terminal && (
          <Button variant="ghost" size="sm" className="text-danger-ink" onClick={() => setCancelling(true)}>
            <XIcon /> {t("orders.ship.cancel")}
          </Button>
        )}
      </div>
      {events.length > 0 && (
        <ol className="grid gap-1.5 border-l border-border pl-3">
          {events.map((e, i) => (
            <li key={`${e.at}-${i}`} className="relative text-xs">
              <span className="absolute top-1.5 -left-[0.95rem] size-2 rounded-full bg-primary/70 ring-2 ring-card" aria-hidden />
              <span className="font-medium">{e.status ? t(`orders.shipment.status.${e.status}`) : e.label}</span>
              {e.location && <span className="text-muted-foreground"> · {e.location}</span>}
              <span className="block text-muted-foreground tabular-nums">{formatDate(e.at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
            </li>
          ))}
        </ol>
      )}
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t("orders.ship.cancelTitle")}
        description={t("orders.ship.cancelBody")}
        confirmLabel={t("orders.ship.cancel")}
        onConfirm={() => run("cancel")}
      />
    </div>
  );
}

function CreateShipmentDialog({ order, open, onOpenChange }: { order: Order; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const carriers = useFeature("delivery.carriers");
  const act = useShipmentAction(order.id);
  const providers: CarrierProvider[] = ["manual", ...(carriers ? (["shiprocket"] as const) : []), ...(DEV ? (["mock"] as const) : [])];
  const [provider, setProvider] = React.useState<CarrierProvider>("manual");
  const [courier, setCourier] = React.useState("");
  const [awb, setAwb] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [dims, setDims] = React.useState({ lengthCm: "", breadthCm: "", heightCm: "", weightGrams: "" });
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setProvider(carriers ? "shiprocket" : "manual");
      setCourier("");
      setAwb("");
      setUrl("");
      setDims({ lengthCm: "", breadthCm: "", heightCm: "", weightGrams: "" });
      setError(null);
    }
  }, [open, carriers]);

  const pkg = (): PackageDims | null | "invalid" => {
    const vals = Object.values(dims).map((v) => v.trim());
    if (vals.every((v) => v === "")) return null;
    const n = { lengthCm: Number(dims.lengthCm), breadthCm: Number(dims.breadthCm), heightCm: Number(dims.heightCm), weightGrams: Math.round(Number(dims.weightGrams)) };
    if (Object.values(n).some((x) => !Number.isFinite(x) || x <= 0)) return "invalid";
    return n;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (provider === "manual") {
      const u = url.trim();
      if (u && !/^https?:\/\/\S+\.\S+/.test(u)) return setError(t("orders.validation.url"));
    }
    const p = provider === "shiprocket" ? pkg() : null;
    if (p === "invalid") return setError(t("orders.ship.packageInvalid"));
    try {
      await act.mutateAsync({
        kind: "create",
        body:
          provider === "manual"
            ? { provider, courier: orNull(courier), awb: orNull(awb), trackingUrl: orNull(url) }
            : { provider, ...(p ? { package: p } : {}) },
      });
      toast.success(t("orders.ship.created"));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !act.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" closeLabel={t("orders.common.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="icon-chip size-8 text-info-ink">
              <TruckIcon className="size-4" />
            </span>
            {t("orders.ship.create")}
          </DialogTitle>
          <DialogDescription>{t(`orders.ship.providerHint.${provider}`)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {providers.length > 1 && (
            <ChipGroup<CarrierProvider>
              aria-label={t("orders.ship.providerLabel")}
              value={provider}
              onChange={(v) => (setProvider(v), setError(null))}
              options={providers.map((p) => ({ value: p, label: t(`orders.ship.provider.${p}`) }))}
            />
          )}
          {provider === "manual" && (
            <>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <Field label={t("orders.ship.courier")} htmlFor="sh-courier">
                  <Input id="sh-courier" value={courier} onChange={(e) => setCourier(e.target.value)} placeholder={t("orders.ship.courierPlaceholder")} />
                </Field>
                <Field label={t("orders.ship.awb")} htmlFor="sh-awb">
                  <Input id="sh-awb" value={awb} onChange={(e) => setAwb(e.target.value)} autoComplete="off" />
                </Field>
              </div>
              <Field label={t("orders.ship.url")} htmlFor="sh-url" optional error={error}>
                <Input id="sh-url" type="url" inputMode="url" value={url} onChange={(e) => (setUrl(e.target.value), setError(null))} placeholder="https://" />
              </Field>
            </>
          )}
          {provider === "shiprocket" && (
            <div className="grid gap-2">
              <p className="text-sm font-medium">
                {t("orders.ship.package")}
                <Optional />
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(["lengthCm", "breadthCm", "heightCm", "weightGrams"] as const).map((k) => (
                  <Input
                    key={k}
                    inputMode="decimal"
                    aria-label={t(`orders.ship.dims.${k}`)}
                    placeholder={t(`orders.ship.dims.${k}`)}
                    value={dims[k]}
                    onChange={(e) => (setDims((d) => ({ ...d, [k]: e.target.value.replace(/[^\d.]/g, "") })), setError(null))}
                  />
                ))}
              </div>
              <p className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{error ?? t("orders.ship.packageHint")}</p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={act.isPending}>
              {t("orders.common.cancel")}
            </Button>
            <Button type="submit" disabled={act.isPending}>
              {act.isPending && <Loader2Icon className="animate-spin" />}
              {provider === "manual" ? t("orders.ship.saveManual") : t("orders.ship.book")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Shipping details stored on the order (POST /orders/:id/fulfillment), used without the delivery module. */
function FulfillmentDialog({ order, open, onOpenChange }: { order: Order; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const action = useOrderAction();
  const [carrier, setCarrier] = React.useState("");
  const [awb, setAwb] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setCarrier(order.fulfillment.carrier ?? "");
      setAwb(order.fulfillment.trackingNumber ?? "");
      setUrl(order.fulfillment.trackingUrl ?? "");
      setError(null);
    }
  }, [open, order.fulfillment]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = url.trim();
    if (u && !/^https?:\/\/\S+\.\S+/.test(u)) return setError(t("orders.validation.url"));
    try {
      await action.mutateAsync({ id: order.id, action: "fulfillment", body: { carrier: orNull(carrier), trackingNumber: orNull(awb), trackingUrl: orNull(u) } });
      toast.success(t("orders.ship.detailsSaved"));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !action.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" closeLabel={t("orders.common.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StickyNoteIcon className="size-4 text-info-ink" /> {t("orders.ship.addDetails")}
          </DialogTitle>
          <DialogDescription>{t("orders.ship.cardHintManual")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field label={t("orders.ship.courier")} htmlFor="ff-courier">
              <Input id="ff-courier" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder={t("orders.ship.courierPlaceholder")} />
            </Field>
            <Field label={t("orders.ship.awb")} htmlFor="ff-awb">
              <Input id="ff-awb" value={awb} onChange={(e) => setAwb(e.target.value)} autoComplete="off" />
            </Field>
          </div>
          <Field label={t("orders.ship.url")} htmlFor="ff-url" optional error={error}>
            <Input id="ff-url" type="url" inputMode="url" value={url} onChange={(e) => (setUrl(e.target.value), setError(null))} placeholder="https://" />
          </Field>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={action.isPending}>
              {t("orders.common.cancel")}
            </Button>
            <Button type="submit" disabled={action.isPending}>
              {action.isPending && <Loader2Icon className="animate-spin" />}
              {t("orders.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
