"use client";

import * as React from "react";
import {
  CalendarRangeIcon,
  GiftIcon,
  Loader2Icon,
  LockIcon,
  MinusIcon,
  PackageIcon,
  PlusIcon,
  SaveIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TargetIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Button, Checkbox, ChipGroup, cn, Input, InputGroup, InputGroupAddon, InputGroupInput, Skeleton, Switch, Textarea, toast } from "@rbms/ui";
import { ConfirmDialog, describeError, ModuleLink, Page, PageHeading, QueryError, useI18n, useModuleNavigate, useRouteParams } from "@rbms/web";
import { Field, MoneyInput, ReadOnlyNote, Section, Thumb } from "../components/bits";
import { CategoryChecklist, ProductMultiPicker } from "../components/target-pickers";
import { VariantPicker } from "../components/variant-picker";
import { PERMS, usePermissions } from "../lib/access";
import { money } from "../lib/format";
import { bundlePreview, draftToInput, offerToDraft, type DraftErrors, type OfferDraft } from "../lib/offers";
import { useCollections, useDeleteOffer, useOffer, useProductsByIds, useSaveOffer, useVariantsByIds } from "../lib/queries";
import { COUPON_CHANNELS, OFFER_APPLIES_TO, OFFER_KINDS, type Offer, type OfferAppliesTo, type OfferKind } from "../lib/types";
import { KIND_ICON, OfferStatePill } from "./offers";

export default function OfferEditPage() {
  const { id, kind } = useRouteParams<{ id?: string; kind?: string }>();
  const { t } = useI18n();
  const offer = useOffer(id ?? null);
  const startKind = (OFFER_KINDS as readonly string[]).includes(kind ?? "") ? (kind as OfferKind) : "bxgy";
  if (!id) return <OfferEditor startKind={startKind} />;
  if (offer.isError)
    return (
      <Page>
        <PageHeading icon={SparklesIcon} title={t("orders.offers.edit")} back={{ href: "offers", label: t("orders.offers.title") }} />
        <QueryError error={offer.error} onRetry={() => void offer.refetch()} />
      </Page>
    );
  if (offer.isPending)
    return (
      <Page>
        <div className="grid gap-section">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      </Page>
    );
  return <OfferEditor offer={offer.data} startKind={offer.data.kind} />;
}

function OfferEditor({ offer, startKind }: { offer?: Offer; startKind: OfferKind }) {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const { can } = usePermissions();
  const canManage = can(PERMS.coupons);
  const save = useSaveOffer();
  const del = useDeleteOffer();
  const [d, setD] = React.useState<OfferDraft>(() => offerToDraft(offer, startKind));
  const [errors, setErrors] = React.useState<DraftErrors>({});
  const [deleting, setDeleting] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const set = <K extends keyof OfferDraft>(k: K, v: OfferDraft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };
  const err = (k: string) => (errors[k] ? t(errors[k]!) : null);
  const disabled = !canManage;
  const idp = React.useId();

  React.useEffect(() => {
    setD(offerToDraft(offer, startKind));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when another offer loads
  }, [offer?.id, offer?.updatedAt]);

  // Names and prices for ids stored on the offer (bundle items, the gift).
  const variantIds = [...new Set([...d.items.map((i) => i.variantId ?? i.pinned).filter((x): x is string => !!x), ...(d.gift ? [d.gift.variantId] : [])])];
  const variants = useVariantsByIds(variantIds);
  const anyProducts = useProductsByIds(d.items.filter((i) => !i.variantId).map((i) => i.productId));
  const items = d.items.map((i) => {
    const v = i.variantId ? variants.data?.get(i.variantId) : undefined;
    const p = anyProducts.data?.get(i.productId);
    return {
      ...i,
      name: i.name ?? v?.productName ?? p?.name ?? variants.data?.get(i.pinned ?? "")?.productName,
      image: i.image ?? v?.image ?? p?.image ?? null,
      variantTitle: i.variantId ? (i.variantTitle ?? v?.title ?? "") : "",
      price: i.variantId ? (v?.price ?? i.price) : (p?.priceMin ?? (i.pinned ? i.price : undefined)),
    };
  });
  const preview = d.kind === "bundle" ? bundlePreview({ ...d, items }) : null;
  const gift = d.gift ? { ...d.gift, name: d.gift.name ?? variants.data?.get(d.gift.variantId)?.name, price: d.gift.price ?? variants.data?.get(d.gift.variantId)?.price } : null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = draftToInput(d);
    if (!r.ok) {
      setErrors(r.errors);
      toast.error(t("orders.offers.fixErrors"));
      return;
    }
    setErrors({});
    try {
      const saved = await save.mutateAsync({ id: offer?.id, body: offer ? { ...r.input, kind: undefined } : r.input });
      toast.success(t(offer ? "orders.offers.saved" : "orders.offers.created", { name: saved.name }));
      setDirty(false);
      if (!offer) navigate(`offers/${saved.id}`, { replace: true });
    } catch (err2) {
      toast.error(describeError(err2, t));
    }
  };

  const Icon = KIND_ICON[d.kind];
  return (
    <Page className="pb-28 md:pb-8">
      <PageHeading
        icon={Icon}
        back={{ href: "offers", label: t("orders.offers.title") }}
        title={
          offer ? (
            <span className="flex flex-wrap items-center gap-2">
              {offer.name}
              <OfferStatePill offer={offer} />
            </span>
          ) : (
            t(d.kind === "bundle" ? "orders.offers.addBundle" : "orders.offers.add")
          )
        }
        description={offer ? t("orders.coupons.usedSummary", { used: offer.usedCount }) : t("orders.offers.addHint")}
        actions={
          offer &&
          canManage && (
            <Button variant="outline" size="icon-lg" className="text-danger-ink" onClick={() => setDeleting(true)} aria-label={t("orders.offers.delete")}>
              <Trash2Icon />
            </Button>
          )
        }
      />
      {disabled && <ReadOnlyNote icon={LockIcon}>{t("orders.offers.readOnly")}</ReadOnlyNote>}

      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <fieldset disabled={disabled} className="grid min-w-0 gap-section">
          {!offer && (
            <Section icon={SparklesIcon} title={t("orders.offers.kindLabel")}>
              <ChipGroup<OfferKind>
                aria-label={t("orders.offers.kindLabel")}
                value={d.kind}
                onChange={(k) => setD((x) => ({ ...offerToDraft(null, k), name: x.name, description: x.description }))}
                options={OFFER_KINDS.map((k) => ({ value: k, label: t(`orders.offers.kind.${k}`) }))}
              />
              <p className="text-meta text-muted-foreground">{t(`orders.offers.kindHint.${d.kind}`)}</p>
            </Section>
          )}

          <Section icon={Icon} title={t("orders.offers.details")}>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field label={t("orders.offers.name")} htmlFor={`${idp}-name`} error={err("name")} hint={t("orders.offers.nameHint")}>
                <Input id={`${idp}-name`} value={d.name} onChange={(e) => set("name", e.target.value)} placeholder={t(`orders.offers.namePlaceholder.${d.kind}`)} maxLength={120} />
              </Field>
              <Field label={t("orders.offers.description")} htmlFor={`${idp}-desc`} optional>
                <Textarea id={`${idp}-desc`} value={d.description} onChange={(e) => set("description", e.target.value)} rows={2} maxLength={500} />
              </Field>
            </div>

            {d.kind === "bxgy" && (
              <div className="grid items-start gap-4 sm:grid-cols-4">
                <Field label={t("orders.offers.buyQty")} htmlFor={`${idp}-buy`} error={err("buyQty")}>
                  <Input id={`${idp}-buy`} inputMode="numeric" className="tabular-nums" value={d.buyQty} onChange={(e) => set("buyQty", e.target.value.replace(/\D/g, "").slice(0, 2))} />
                </Field>
                <Field label={t("orders.offers.getQty")} htmlFor={`${idp}-get`} error={err("getQty")}>
                  <Input id={`${idp}-get`} inputMode="numeric" className="tabular-nums" value={d.getQty} onChange={(e) => set("getQty", e.target.value.replace(/\D/g, "").slice(0, 2))} />
                </Field>
                <Field label={t("orders.offers.getPercent")} htmlFor={`${idp}-pct`} error={err("getPercent")} hint={t("orders.offers.getPercentHint")}>
                  <InputGroup>
                    <InputGroupInput id={`${idp}-pct`} inputMode="numeric" className="text-right tabular-nums" value={d.getPercent} onChange={(e) => set("getPercent", e.target.value.replace(/\D/g, "").slice(0, 3))} />
                    <InputGroupAddon aria-hidden>%</InputGroupAddon>
                  </InputGroup>
                </Field>
                <Field label={t("orders.offers.maxApplications")} htmlFor={`${idp}-max`} error={err("maxApplications")} optional>
                  <Input id={`${idp}-max`} inputMode="numeric" className="tabular-nums" placeholder={t("orders.coupons.unlimited")} value={d.maxApplications} onChange={(e) => set("maxApplications", e.target.value.replace(/\D/g, "").slice(0, 2))} />
                </Field>
                <p className="text-meta text-muted-foreground sm:col-span-4">{t("orders.offers.cheapestHint")}</p>
              </div>
            )}

            {d.kind === "tiered" && (
              <div className="grid gap-3">
                <ChipGroup<"qty" | "amount">
                  aria-label={t("orders.offers.basis")}
                  value={d.basis}
                  onChange={(b) => set("basis", b)}
                  options={[
                    { value: "qty", label: t("orders.offers.basisQty") },
                    { value: "amount", label: t("orders.offers.basisAmount") },
                  ]}
                />
                <ul className="grid gap-2">
                  {d.tiers.map((tier, i) => (
                    <li key={i} className="grid items-start gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_auto_1fr_auto]">
                      <Field label={d.basis === "qty" ? t("orders.offers.tierMinQty") : t("orders.offers.tierMinAmount")} htmlFor={`${idp}-tmin-${i}`} error={err(`tiers.${i}.min`)}>
                        {d.basis === "qty" ? (
                          <Input id={`${idp}-tmin-${i}`} inputMode="numeric" className="tabular-nums" value={tier.min} onChange={(e) => set("tiers", d.tiers.map((x, k) => (k === i ? { ...x, min: e.target.value.replace(/\D/g, "").slice(0, 4) } : x)))} />
                        ) : (
                          <MoneyInput id={`${idp}-tmin-${i}`} value={tier.min} onChange={(e) => set("tiers", d.tiers.map((x, k) => (k === i ? { ...x, min: e.target.value } : x)))} />
                        )}
                      </Field>
                      <div className="grid gap-1.5">
                        <span className="text-sm font-medium">{t("orders.offers.tierType")}</span>
                        <ChipGroup<"percent" | "flat">
                          size="sm"
                          aria-label={t("orders.offers.tierType")}
                          value={tier.type}
                          onChange={(ty) => set("tiers", d.tiers.map((x, k) => (k === i ? { ...x, type: ty, value: "" } : x)))}
                          options={[
                            { value: "percent", label: "%" },
                            { value: "flat", label: "₹" },
                          ]}
                        />
                      </div>
                      <Field label={tier.type === "percent" ? t("orders.coupons.percentOff") : t("orders.coupons.amountOff")} htmlFor={`${idp}-tval-${i}`} error={err(`tiers.${i}.value`)}>
                        {tier.type === "percent" ? (
                          <InputGroup>
                            <InputGroupInput id={`${idp}-tval-${i}`} inputMode="numeric" className="text-right tabular-nums" value={tier.value} onChange={(e) => set("tiers", d.tiers.map((x, k) => (k === i ? { ...x, value: e.target.value.replace(/\D/g, "").slice(0, 3) } : x)))} />
                            <InputGroupAddon aria-hidden>%</InputGroupAddon>
                          </InputGroup>
                        ) : (
                          <MoneyInput id={`${idp}-tval-${i}`} value={tier.value} onChange={(e) => set("tiers", d.tiers.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))} />
                        )}
                      </Field>
                      <Button type="button" variant="ghost" size="icon" className="mt-6 text-muted-foreground" disabled={d.tiers.length <= 1} onClick={() => set("tiers", d.tiers.filter((_, k) => k !== i))} aria-label={t("orders.offers.removeTier")}>
                        <XIcon />
                      </Button>
                    </li>
                  ))}
                </ul>
                {err("tiers") && <p className="text-sm text-danger-ink">{err("tiers")}</p>}
                {d.tiers.length < 10 && (
                  <Button type="button" variant="outline" className="justify-self-start" onClick={() => set("tiers", [...d.tiers, { min: "", type: "percent", value: "" }])}>
                    <PlusIcon /> {t("orders.offers.addTier")}
                  </Button>
                )}
              </div>
            )}

            {d.kind === "free_gift" && (
              <div className="grid items-start gap-4 sm:grid-cols-[1fr_8rem]">
                <Field label={t("orders.offers.minAmount")} htmlFor={`${idp}-minamt`} error={err("minAmount")} hint={t("orders.offers.minAmountHint")}>
                  <MoneyInput id={`${idp}-minamt`} value={d.minAmount} onChange={(e) => set("minAmount", e.target.value)} />
                </Field>
                <Field label={t("orders.offers.giftQty")} htmlFor={`${idp}-gqty`} error={err("giftQty")}>
                  <Input id={`${idp}-gqty`} inputMode="numeric" className="tabular-nums" value={d.giftQty} onChange={(e) => set("giftQty", e.target.value.replace(/\D/g, "").slice(0, 2))} />
                </Field>
                <div className="grid gap-2 sm:col-span-2">
                  <span className="text-sm font-medium">{t("orders.offers.gift")}</span>
                  {gift ? (
                    <div className="flex items-center gap-3 rounded-xl border p-2.5">
                      <GiftIcon className="size-5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{gift.name ?? t("orders.common.loading")}</span>
                      {gift.price !== undefined && <span className="text-sm tabular-nums text-muted-foreground">{money(gift.price)}</span>}
                      {!disabled && (
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => set("gift", null)} aria-label={t("orders.offers.removeGift")}>
                          <XIcon />
                        </Button>
                      )}
                    </div>
                  ) : (
                    <VariantPicker disabled={disabled} onPick={(v) => set("gift", { productId: v.productId, variantId: v.id, name: v.name, price: v.price })} />
                  )}
                  <p className={cn("text-meta", err("gift") ? "text-danger-ink" : "text-muted-foreground")}>{err("gift") ?? t("orders.offers.giftHint")}</p>
                </div>
              </div>
            )}
          </Section>

          {d.kind === "bundle" && (
            <Section icon={PackageIcon} title={t("orders.offers.bundleItems")} description={t("orders.offers.bundleItemsHint")}>
              {items.length > 0 && (
                <ul className="grid gap-2" data-testid="bundle-items">
                  {items.map((i, k) => (
                    <li key={`${i.productId}-${k}`} className="flex flex-wrap items-center gap-3 rounded-xl border p-2.5">
                      <Thumb src={i.image} alt="" className="size-10" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{i.name ?? t("orders.common.loading")}</p>
                        <p className="text-meta text-muted-foreground">
                          {i.variantId ? i.variantTitle || t("orders.offers.thisVariant") : t("orders.offers.anyVariant")}
                          {i.price !== undefined && ` · ${money(i.price)}`}
                        </p>
                      </div>
                      {(i.pinned || !i.variantId) && i.pinned && (
                        <label className="flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={!i.variantId}
                            onCheckedChange={(on) => set("items", d.items.map((x, j) => (j === k ? { ...x, variantId: on === true ? null : x.pinned } : x)))}
                          />
                          {t("orders.offers.anyVariantToggle")}
                        </label>
                      )}
                      <div className="flex items-center gap-1" role="group" aria-label={t("orders.offers.qtyOf", { name: i.name ?? "" })}>
                        <Button type="button" variant="outline" size="icon-sm" disabled={i.qty <= 1} onClick={() => set("items", d.items.map((x, j) => (j === k ? { ...x, qty: x.qty - 1 } : x)))} aria-label={t("orders.offers.less")}>
                          <MinusIcon />
                        </Button>
                        <span className="w-6 text-center text-sm tabular-nums">{i.qty}</span>
                        <Button type="button" variant="outline" size="icon-sm" disabled={i.qty >= 99} onClick={() => set("items", d.items.map((x, j) => (j === k ? { ...x, qty: x.qty + 1 } : x)))} aria-label={t("orders.offers.more")}>
                          <PlusIcon />
                        </Button>
                      </div>
                      <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={() => set("items", d.items.filter((_, j) => j !== k))} aria-label={t("orders.common.removeNamed", { name: i.name ?? "" })}>
                        <XIcon />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {d.items.length < 8 && (
                <VariantPicker
                  disabled={disabled}
                  onPick={(v) => set("items", [...d.items, { productId: v.productId, variantId: v.id, qty: 1, pinned: v.id, name: v.productName, variantTitle: v.title, price: v.price, image: v.image }])}
                />
              )}
              {err("items") && <p className="text-sm text-danger-ink">{err("items")}</p>}
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("orders.offers.priceType")}</span>
                  <ChipGroup<"fixed" | "percent">
                    aria-label={t("orders.offers.priceType")}
                    value={d.priceType}
                    onChange={(p) => setD((x) => ({ ...x, priceType: p, bundleValue: "" }))}
                    options={[
                      { value: "fixed", label: t("orders.offers.priceFixed") },
                      { value: "percent", label: t("orders.offers.pricePercent") },
                    ]}
                  />
                </div>
                <Field label={d.priceType === "fixed" ? t("orders.offers.bundlePrice") : t("orders.coupons.percentOff")} htmlFor={`${idp}-bval`} error={err("bundleValue")}>
                  {d.priceType === "fixed" ? (
                    <MoneyInput id={`${idp}-bval`} value={d.bundleValue} onChange={(e) => set("bundleValue", e.target.value)} />
                  ) : (
                    <InputGroup>
                      <InputGroupInput id={`${idp}-bval`} inputMode="numeric" className="text-right tabular-nums" value={d.bundleValue} onChange={(e) => set("bundleValue", e.target.value.replace(/\D/g, "").slice(0, 3))} />
                      <InputGroupAddon aria-hidden>%</InputGroupAddon>
                    </InputGroup>
                  )}
                </Field>
              </div>
              {preview && (
                <p className="rounded-xl bg-success/10 px-3 py-2 text-sm text-success-ink" data-testid="bundle-preview">
                  {t("orders.offers.bundlePreview", { regular: money(preview.regular), price: money(preview.price), save: money(preview.save) })}
                </p>
              )}
              {offer?.slug && <p className="text-meta text-muted-foreground">{t("orders.offers.bundleUrl", { path: `/bundles` })}</p>}
            </Section>
          )}

          {d.kind !== "bundle" && (
            <Section icon={TargetIcon} title={t("orders.offers.appliesTo")}>
              <ChipGroup<OfferAppliesTo>
                aria-label={t("orders.offers.appliesTo")}
                value={d.appliesTo}
                onChange={(a) => setD((x) => ({ ...x, appliesTo: a, targetIds: [] }))}
                options={OFFER_APPLIES_TO.map((a) => ({ value: a, label: t(`orders.offers.applies.${a}`) }))}
              />
              {d.appliesTo === "categories" && <CategoryChecklist value={d.targetIds} onChange={(v) => set("targetIds", v)} disabled={disabled} />}
              {d.appliesTo === "products" && <ProductMultiPicker value={d.targetIds} onChange={(v) => set("targetIds", v)} disabled={disabled} />}
              {d.appliesTo === "collections" && <CollectionChecklist value={d.targetIds} onChange={(v) => set("targetIds", v)} disabled={disabled} />}
              {err("targetIds") && <p className="text-sm text-danger-ink">{err("targetIds")}</p>}
            </Section>
          )}

          <Section icon={CalendarRangeIcon} tone="text-info-ink" title={t("orders.coupons.validity")} description={t("orders.coupons.validityHint")}>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field label={t("orders.coupons.starts")} htmlFor={`${idp}-from`} optional>
                <Input id={`${idp}-from`} type="date" value={d.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
              </Field>
              <Field label={t("orders.coupons.ends")} htmlFor={`${idp}-to`} optional error={err("endsAt")}>
                <Input id={`${idp}-to`} type="date" value={d.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section icon={ShieldCheckIcon} tone="text-warning-ink" title={t("orders.offers.limits")}>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field label={t("orders.offers.usageLimit")} htmlFor={`${idp}-ul`} optional error={err("usageLimit")} hint={t("orders.offers.usageLimitHint")}>
                <Input id={`${idp}-ul`} inputMode="numeric" className="tabular-nums" placeholder={t("orders.coupons.unlimited")} value={d.usageLimit} onChange={(e) => set("usageLimit", e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label={t("orders.coupons.perCustomer")} htmlFor={`${idp}-pc`} optional error={err("perCustomerLimit")}>
                <Input id={`${idp}-pc`} inputMode="numeric" className="tabular-nums" placeholder={t("orders.coupons.unlimited")} value={d.perCustomerLimit} onChange={(e) => set("perCustomerLimit", e.target.value.replace(/\D/g, ""))} />
              </Field>
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">{t("orders.coupons.channels")}</span>
              <div className="flex flex-wrap gap-2">
                {COUPON_CHANNELS.filter((c) => c !== "billing").map((c) => {
                  const on = d.channels.includes(c);
                  return (
                    <label key={c} className={cn("flex h-10 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm", on ? "border-primary bg-primary/8" : "bg-card")}>
                      <Checkbox checked={on} onCheckedChange={(v) => set("channels", v === true ? [...d.channels, c] : d.channels.filter((x) => x !== c))} />
                      {t(`orders.coupons.channel.${c}`)}
                    </label>
                  );
                })}
              </div>
              {err("channels") && <p className="text-sm text-danger-ink">{err("channels")}</p>}
            </div>
            <SwitchRow label={t("orders.offers.stackable")} hint={t("orders.offers.stackableHint")} checked={d.stackable} onChange={(v) => set("stackable", v)} />
            <SwitchRow label={t("orders.offers.withCoupons")} hint={t("orders.offers.withCouponsHint")} checked={d.combinesWithCoupons} onChange={(v) => set("combinesWithCoupons", v)} />
          </Section>

          <SwitchRow card label={t("orders.offers.activeLabel")} hint={t("orders.offers.activeHint")} checked={d.active} onChange={(v) => set("active", v)} />
        </fieldset>

        {canManage && (
          <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
            <div className="mx-auto flex max-w-4xl justify-end gap-2">
              <Button asChild type="button" variant="outline" size="lg">
                <ModuleLink to="offers">{t("orders.common.cancel")}</ModuleLink>
              </Button>
              <Button type="submit" size="lg" className="flex-1 md:flex-none" disabled={save.isPending || (!!offer && !dirty)}>
                {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
                {offer ? t("orders.common.save") : t(d.kind === "bundle" ? "orders.offers.createBundle" : "orders.offers.create")}
              </Button>
            </div>
          </div>
        )}
      </form>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("orders.offers.deleteTitle", { name: offer?.name ?? "" })}
        description={t("orders.offers.deleteBody")}
        confirmLabel={t("orders.offers.delete")}
        onConfirm={async () => {
          if (!offer) return;
          try {
            await del.mutateAsync(offer.id);
            toast.success(t("orders.offers.deleted", { name: offer.name }));
            navigate("offers", { replace: true });
          } catch (e) {
            toast.error(describeError(e, t));
            throw e;
          }
        }}
      />
    </Page>
  );
}

function SwitchRow({ label, hint, checked, onChange, card }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; card?: boolean }) {
  const id = React.useId();
  return (
    <div className={cn("flex flex-row items-center justify-between gap-3 border p-3", card ? "rounded-2xl border-card-ring bg-card p-4 shadow-elevated" : "rounded-xl")}>
      <div className="grid gap-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p className="text-meta text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** Active catalogue collections as a checklist. */
function CollectionChecklist({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const cols = useCollections();
  const set = new Set(value);
  if (cols.isPending) return <Skeleton className="h-32 rounded-xl" />;
  const list = (cols.data ?? []).filter((c) => c.active || set.has(c.id));
  if (!list.length) return <p className="text-sm text-muted-foreground">{t("orders.offers.noCollections")}</p>;
  return (
    <ul className="max-h-64 overflow-y-auto rounded-xl border p-1">
      {list.map((c) => (
        <li key={c.id}>
          <label className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-accent/50", disabled && "pointer-events-none opacity-60")}>
            <Checkbox checked={set.has(c.id)} disabled={disabled} onCheckedChange={(on) => onChange(on === true ? [...value, c.id] : value.filter((x) => x !== c.id))} />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <span className="text-xs text-muted-foreground">{t(`orders.offers.collectionType.${c.type}`)}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
