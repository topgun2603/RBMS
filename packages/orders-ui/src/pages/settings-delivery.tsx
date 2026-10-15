"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  BanknoteIcon,
  CheckCircle2Icon,
  CircleSlashIcon,
  Globe2Icon,
  KeyRoundIcon,
  Loader2Icon,
  LockIcon,
  MapIcon,
  MoreVerticalIcon,
  PencilIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  ScaleIcon,
  SearchCheckIcon,
  Trash2Icon,
  TruckIcon,
  UnplugIcon,
} from "lucide-react";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Skeleton,
  StatusPill,
  Switch,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, Page, PageHeading, QueryError, SettingsNav, useFeature, useI18n } from "@srirealtime/web";
import { CopyButton, Field, MoneyInput, Optional, ReadOnlyNote, Section } from "../components/bits";
import { RateDialog, ZoneDialog } from "../components/delivery-dialogs";
import { DeliveryIllustration } from "../components/illustrations";
import { PERMS, usePermissions } from "../lib/access";
import { rateSummary } from "../lib/delivery";
import { digitsOnly, money, rupeesToPaise, stateName } from "../lib/format";
import { quoteDelivery, useCarrierAccount, useDeleteCarrierAccount, useDeleteRate, useDeleteZone, useSaveCarrierAccount, useZones } from "../lib/queries";
import type { CarrierAccount, Quote, Rate, Zone } from "../lib/types";

export default function DeliverySettingsPage() {
  const { t } = useI18n();
  const { can } = usePermissions();
  const canEdit = can(PERMS.settings);
  const carriers = useFeature("delivery.carriers");
  const zones = useZones();
  const [zoneDialog, setZoneDialog] = React.useState<{ zone: Zone | null } | null>(null);
  const [rateDialog, setRateDialog] = React.useState<{ zone: Zone; rate: Rate | null } | null>(null);
  const [deleting, setDeleting] = React.useState<{ kind: "zone"; zone: Zone } | { kind: "rate"; rate: Rate } | null>(null);
  const delZone = useDeleteZone();
  const delRate = useDeleteRate();
  const list = zones.data?.items ?? [];

  return (
    <Page className="max-w-4xl">
      <SettingsNav />
      <PageHeading
        icon={TruckIcon}
        title={t("orders.delivery.title")}
        description={t("orders.delivery.subtitle")}
        actions={
          canEdit && (
            <Button size="lg" onClick={() => setZoneDialog({ zone: null })}>
              <PlusIcon /> {t("orders.delivery.addZone")}
            </Button>
          )
        }
      />
      {!canEdit && <ReadOnlyNote icon={LockIcon}>{t("orders.delivery.readOnly")}</ReadOnlyNote>}

      <div className="grid gap-4">
        {zones.isError ? (
          <QueryError error={zones.error} onRetry={() => void zones.refetch()} />
        ) : zones.isPending ? (
          <>
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </>
        ) : (
          <>
            {zones.data.implicitDefault && (
              <div className="flex items-start gap-3 rounded-2xl border border-info/30 bg-info/8 p-4">
                <span className="icon-chip size-9 shrink-0 text-info-ink">
                  <Globe2Icon className="size-4" />
                </span>
                <div className="text-sm">
                  <p className="font-semibold">{t("orders.delivery.defaultTitle")}</p>
                  <p className="text-muted-foreground">{t("orders.delivery.defaultBody")}</p>
                </div>
              </div>
            )}
            {list.length === 0 ? (
              <EmptyState
                illustration={<DeliveryIllustration />}
                title={t("orders.delivery.emptyTitle")}
                description={t("orders.delivery.emptyBody")}
                action={
                  canEdit && (
                    <Button size="lg" onClick={() => setZoneDialog({ zone: null })}>
                      <PlusIcon /> {t("orders.delivery.addZone")}
                    </Button>
                  )
                }
              />
            ) : (
              list.map((z) => (
                <ZoneCard
                  key={z.id}
                  zone={z}
                  canEdit={canEdit}
                  onEdit={() => setZoneDialog({ zone: z })}
                  onDelete={() => setDeleting({ kind: "zone", zone: z })}
                  onAddRate={() => setRateDialog({ zone: z, rate: null })}
                  onEditRate={(r) => setRateDialog({ zone: z, rate: r })}
                  onDeleteRate={(r) => setDeleting({ kind: "rate", rate: r })}
                />
              ))
            )}
            <p className="px-1 text-xs text-muted-foreground">{t("orders.delivery.matchOrder")}</p>
          </>
        )}

        <TestQuote />
        {carriers && <CarrierCard canEdit={canEdit} />}
      </div>

      <ZoneDialog open={!!zoneDialog} onOpenChange={(o) => !o && setZoneDialog(null)} zone={zoneDialog?.zone} nextSort={list.length} />
      <RateDialog open={!!rateDialog} onOpenChange={(o) => !o && setRateDialog(null)} zone={rateDialog?.zone ?? null} rate={rateDialog?.rate} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting?.kind === "zone" ? t("orders.delivery.deleteZone", { name: deleting.zone.name }) : t("orders.delivery.deleteRate", { name: deleting?.kind === "rate" ? deleting.rate.name : "" })}
        description={deleting?.kind === "zone" ? t("orders.delivery.deleteZoneBody") : undefined}
        confirmLabel={t("orders.common.delete")}
        onConfirm={async () => {
          try {
            if (deleting?.kind === "zone") await delZone.mutateAsync(deleting.zone.id);
            else if (deleting?.kind === "rate") await delRate.mutateAsync(deleting.rate.id);
            toast.success(t("orders.delivery.deleted"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </Page>
  );
}

function ZoneCard({
  zone,
  canEdit,
  onEdit,
  onDelete,
  onAddRate,
  onEditRate,
  onDeleteRate,
}: {
  zone: Zone;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAddRate: () => void;
  onEditRate: (r: Rate) => void;
  onDeleteRate: (r: Rate) => void;
}) {
  const { t } = useI18n();
  const rest = zone.states.length === 0 && zone.pincodePrefixes.length === 0 && zone.pincodes.length === 0;
  return (
    <Section
      icon={MapIcon}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {zone.name}
          {!zone.active && (
            <StatusPill tone="neutral" icon={CircleSlashIcon}>
              {t("orders.delivery.off")}
            </StatusPill>
          )}
        </span>
      }
      description={rest ? t("orders.delivery.restOfIndiaShort") : t("orders.delivery.ratesCount", { count: zone.rates.length })}
      action={
        canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t("orders.common.actionsFor", { name: zone.name })}>
                <MoreVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="h-10" onSelect={onEdit}>
                <PencilIcon /> {t("orders.delivery.editZone")}
              </DropdownMenuItem>
              <DropdownMenuItem className="h-10" onSelect={onAddRate}>
                <PlusIcon /> {t("orders.delivery.addRate")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" className="h-10" onSelect={onDelete}>
                <Trash2Icon /> {t("orders.common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
      className={cn(!zone.active && "opacity-75")}
    >
      {!rest && (
        <div className="flex flex-wrap gap-1.5">
          {zone.states.map((s) => (
            <span key={s} className="inline-flex h-6 items-center rounded-full bg-info/12 px-2.5 text-xs font-medium text-info-ink ring-1 ring-info/25 ring-inset">
              {stateName(s)}
            </span>
          ))}
          {zone.pincodePrefixes.map((p) => (
            <span key={`p${p}`} className="inline-flex h-6 items-center rounded-full bg-primary/10 px-2.5 text-xs font-medium text-primary tabular-nums ring-1 ring-primary/20 ring-inset">
              {p}…
            </span>
          ))}
          {zone.pincodes.slice(0, 20).map((p) => (
            <span key={`c${p}`} className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-medium tabular-nums ring-1 ring-border ring-inset">
              {p}
            </span>
          ))}
          {zone.pincodes.length > 20 && <span className="text-xs text-muted-foreground">{t("orders.delivery.morePincodes", { count: zone.pincodes.length - 20 })}</span>}
        </div>
      )}
      {zone.rates.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
          <span className="flex items-center gap-2 text-warning-ink">
            <AlertTriangleIcon className="size-4" /> {t("orders.delivery.noRates")}
          </span>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={onAddRate}>
              <PlusIcon /> {t("orders.delivery.addRate")}
            </Button>
          )}
        </div>
      ) : (
        <ul className="grid gap-2">
          {zone.rates.map((r) => (
            <RateRow key={r.id} rate={r} canEdit={canEdit} onEdit={() => onEditRate(r)} onDelete={() => onDeleteRate(r)} />
          ))}
          {canEdit && (
            <li>
              <Button variant="ghost" size="sm" onClick={onAddRate}>
                <PlusIcon /> {t("orders.delivery.addRate")}
              </Button>
            </li>
          )}
        </ul>
      )}
    </Section>
  );
}

function RateRow({ rate: r, canEdit, onEdit, onDelete }: { rate: Rate; canEdit: boolean; onEdit: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  const s = rateSummary(r);
  return (
    <li className={cn("flex items-start gap-3 rounded-xl border bg-muted/20 p-3", !r.active && "opacity-60")}>
      <span className="icon-chip size-9 shrink-0 text-info-ink">{r.type === "weight" ? <ScaleIcon className="size-4" /> : <TruckIcon className="size-4" />}</span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">
          {r.name}
          {!r.active && <span className="ml-2 text-xs text-muted-foreground">({t("orders.delivery.off")})</span>}
        </p>
        <p className="text-muted-foreground">
          {r.type === "weight"
            ? s.slabs.map((x) => t("orders.delivery.slabText", { amount: x.amount, upTo: x.upTo })).join(" · ")
            : r.amount === 0
              ? t("orders.totals.free")
              : t("orders.delivery.flatText", { amount: s.amount })}
          {s.freeAbove && ` · ${t("orders.delivery.freeAboveText", { amount: s.freeAbove })}`}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{t("orders.delivery.eta", { min: r.etaMinDays, max: r.etaMaxDays })}</span>
          <span className="inline-flex items-center gap-1">
            <BanknoteIcon className="size-3.5" />
            {r.codAllowed ? (r.codFee > 0 ? t("orders.delivery.codWithFee", { fee: money(r.codFee) }) : t("orders.delivery.codFree")) : t("orders.delivery.noCod")}
          </span>
        </p>
      </div>
      {canEdit && (
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label={t("orders.delivery.editRate")}>
            <PencilIcon />
          </Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-danger-ink" onClick={onDelete} aria-label={t("orders.common.delete")}>
            <Trash2Icon />
          </Button>
        </div>
      )}
    </li>
  );
}

function TestQuote() {
  const { t } = useI18n();
  const [pincode, setPincode] = React.useState("");
  const [weight, setWeight] = React.useState("500");
  const [subtotal, setSubtotal] = React.useState("999");
  const [cod, setCod] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<Quote | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[1-9]\d{5}$/.test(pincode)) return setError(t("orders.validation.pincode"));
    setBusy(true);
    try {
      setResult(await quoteDelivery({ pincode, weightGrams: Number(weight) || 0, subtotal: rupeesToPaise(subtotal) ?? 0, cod }));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={SearchCheckIcon} tone="text-success-ink" title={t("orders.delivery.testTitle")} description={t("orders.delivery.testHint")}>
      <form onSubmit={run} className="grid items-start gap-3 sm:grid-cols-[8rem_7rem_minmax(0,1fr)_auto_auto]" noValidate>
        <Field label={t("orders.new.pincode")} htmlFor="tq-pin" error={error}>
          <Input id="tq-pin" inputMode="numeric" className="tabular-nums" value={pincode} maxLength={6} onChange={(e) => (setPincode(digitsOnly(e.target.value, 6)), setError(null))} placeholder="600001" />
        </Field>
        <Field label={t("orders.delivery.weight")} htmlFor="tq-w">
          <Input id="tq-w" inputMode="numeric" className="text-right tabular-nums" value={weight} onChange={(e) => setWeight(digitsOnly(e.target.value, 7))} />
        </Field>
        <Field label={t("orders.delivery.subtotal")} htmlFor="tq-sub">
          <MoneyInput id="tq-sub" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} />
        </Field>
        {/* No label row of their own: sm:mt-7 = label row (20px) + gap (8px), so they line up with the inputs. */}
        <label className="flex h-10 items-center gap-2 text-sm sm:mt-7">
          <Switch checked={cod} onCheckedChange={setCod} /> {t("orders.method.cod")}
        </label>
        <Button type="submit" className="sm:mt-7" disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : <SearchCheckIcon />} {t("orders.delivery.check")}
        </Button>
      </form>
      {result &&
        (result.serviceable && result.options.length > 0 ? (
          <div className="grid gap-2">
            {result.zone && <p className="text-xs text-muted-foreground">{t("orders.delivery.matchedZone", { zone: result.zone.name })}</p>}
            {result.options.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3 rounded-xl border bg-success/5 px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <CheckCircle2Icon className="size-4 text-success-ink" />
                  <span>
                    <span className="block font-medium">{o.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("orders.delivery.eta", { min: o.etaDays[0], max: o.etaDays[1] })}
                      {cod && o.codFee > 0 && ` · ${t("orders.delivery.codWithFee", { fee: money(o.codFee) })}`}
                    </span>
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{o.amount === 0 ? t("orders.totals.free") : money(o.amount)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning-ink">
            <AlertTriangleIcon className="size-4" /> {t("orders.new.notServiceable")}
          </p>
        ))}
    </Section>
  );
}

function CarrierCard({ canEdit }: { canEdit: boolean }) {
  const { t } = useI18n();
  const account = useCarrierAccount(true);
  const save = useSaveCarrierAccount();
  const remove = useDeleteCarrierAccount();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [pickup, setPickup] = React.useState("Primary");
  const [enabled, setEnabled] = React.useState(true);
  const [dims, setDims] = React.useState({ lengthCm: "", breadthCm: "", heightCm: "", weightGrams: "" });
  const [token, setToken] = React.useState<string | null>(null);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const a = account.data;

  React.useEffect(() => {
    if (!a) return;
    setEmail(a.email ?? "");
    setPickup(a.pickupLocation ?? "Primary");
    setEnabled(a.configured ? a.enabled : true);
    const p = a.defaultPackage;
    setDims(p ? { lengthCm: String(p.lengthCm), breadthCm: String(p.breadthCm), heightCm: String(p.heightCm), weightGrams: String(p.weightGrams) } : { lengthCm: "", breadthCm: "", heightCm: "", weightGrams: "" });
  }, [a]);

  const submit = async (e: React.FormEvent, rotate = false) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(t("orders.validation.email"));
    if (!a?.configured && !password) return setError(t("orders.carrier.passwordRequired"));
    const vals = Object.values(dims);
    let defaultPackage: CarrierAccount["defaultPackage"] | undefined;
    if (vals.every((v) => v === "")) defaultPackage = null;
    else {
      const n = { lengthCm: Number(dims.lengthCm), breadthCm: Number(dims.breadthCm), heightCm: Number(dims.heightCm), weightGrams: Math.round(Number(dims.weightGrams)) };
      if (Object.values(n).some((x) => !Number.isFinite(x) || x <= 0)) return setError(t("orders.ship.packageInvalid"));
      defaultPackage = n;
    }
    setError(null);
    try {
      const r = await save.mutateAsync({
        email: email.trim(),
        ...(password ? { password } : {}),
        pickupLocation: pickup.trim() || "Primary",
        enabled,
        defaultPackage,
        ...(rotate ? { rotateWebhookToken: true } : {}),
      });
      setPassword("");
      if (r.newWebhookToken) setToken(r.newWebhookToken);
      toast.success(rotate ? t("orders.carrier.rotated") : t("orders.carrier.saved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Section
      icon={PlugIcon}
      tone="text-primary"
      title={t("orders.carrier.title")}
      description={t("orders.carrier.hint")}
      action={
        a?.configured ? (
          <StatusPill tone={a.enabled ? "success" : "neutral"} icon={a.enabled ? CheckCircle2Icon : CircleSlashIcon}>
            {a.enabled ? t("orders.carrier.connected") : t("orders.carrier.paused")}
          </StatusPill>
        ) : undefined
      }
    >
      {account.isError ? (
        <QueryError compact error={account.error} onRetry={() => void account.refetch()} />
      ) : account.isPending ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : (
        <form onSubmit={(e) => void submit(e)} className="grid gap-4" noValidate>
          <fieldset disabled={!canEdit} className="grid gap-4">
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field label={t("orders.carrier.email")} htmlFor="sr-email" error={error} hint={t("orders.carrier.emailHint")}>
                <Input id="sr-email" type="email" autoComplete="off" value={email} onChange={(e) => (setEmail(e.target.value), setError(null))} />
              </Field>
              <Field label={t("orders.carrier.password")} htmlFor="sr-pass" optional={!!a?.configured} hint={a?.configured ? t("orders.carrier.passwordKeep") : undefined}>
                <Input id="sr-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            </div>
            <Field label={t("orders.carrier.pickup")} htmlFor="sr-pickup" hint={t("orders.carrier.pickupHint")}>
              <Input id="sr-pickup" value={pickup} onChange={(e) => setPickup(e.target.value)} />
            </Field>
            <div className="grid gap-2">
              <p className="text-sm font-medium">
                {t("orders.carrier.package")}
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
                    onChange={(e) => setDims((d) => ({ ...d, [k]: e.target.value.replace(/[^\d.]/g, "") }))}
                  />
                ))}
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
              <span>
                <span className="block font-medium">{t("orders.carrier.enabled")}</span>
                <span className="text-xs text-muted-foreground">{t("orders.carrier.enabledHint")}</span>
              </span>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </label>
          </fieldset>

          {a?.configured && (
            <div className="grid gap-2 rounded-xl border bg-muted/20 p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <KeyRoundIcon className="size-4 text-primary" /> {t("orders.carrier.webhook")}
              </p>
              <p className="text-xs text-muted-foreground">{t("orders.carrier.webhookHint", { header: a.webhookHeader })}</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-card px-2.5 py-2 text-xs ring-1 ring-border">{a.webhookUrl}</code>
                <CopyButton value={a.webhookUrl} size="icon" />
              </div>
              {token ? (
                <div className="grid gap-1.5 rounded-lg border border-warning/40 bg-warning/10 p-2.5">
                  <p className="text-xs font-medium text-warning-ink">{t("orders.carrier.tokenOnce")}</p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md bg-card px-2.5 py-2 font-mono text-xs ring-1 ring-border">{token}</code>
                    <CopyButton value={token} size="icon" />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{a.webhookTokenSet ? t("orders.carrier.tokenSet") : t("orders.carrier.tokenMissing")}</p>
              )}
              {canEdit && (
                <Button type="button" variant="ghost" size="sm" className="w-fit" disabled={save.isPending} onClick={(e) => void submit(e, true)}>
                  <RefreshCwIcon /> {t("orders.carrier.rotate")}
                </Button>
              )}
            </div>
          )}

          {canEdit && (
            <div className="flex flex-wrap justify-end gap-2">
              {a?.configured && (
                <Button type="button" variant="ghost" className="text-danger-ink" onClick={() => setDisconnecting(true)}>
                  <UnplugIcon /> {t("orders.carrier.disconnect")}
                </Button>
              )}
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
                {a?.configured ? t("orders.common.save") : t("orders.carrier.connect")}
              </Button>
            </div>
          )}
        </form>
      )}
      <ConfirmDialog
        open={disconnecting}
        onOpenChange={setDisconnecting}
        title={t("orders.carrier.disconnectTitle")}
        description={t("orders.carrier.disconnectBody")}
        confirmLabel={t("orders.carrier.disconnect")}
        onConfirm={async () => {
          try {
            await remove.mutateAsync();
            setToken(null);
            toast.success(t("orders.carrier.disconnected"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </Section>
  );
}
