"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CalendarRangeIcon,
  CheckCircle2Icon,
  Undo2Icon,
  HistoryIcon,
  Loader2Icon,
  LockIcon,
  PercentIcon,
  SaveIcon,
  ShieldCheckIcon,
  ShuffleIcon,
  TargetIcon,
  TicketPercentIcon,
  Trash2Icon,
} from "lucide-react";
import {
  Button,
  Checkbox,
  ChipGroup,
  cn,
  EmptyState,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Skeleton,
  StatusPill,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from "@srirealtime/ui";
import {
  ConfirmDialog,
  describeError,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  ModuleLink,
  Page,
  PageHeading,
  QueryError,
  useI18n,
  useModuleNavigate,
  useRouteParams,
} from "@srirealtime/web";
import { CopyButton, MoneyInput, Optional, ReadOnlyNote, Section } from "../components/bits";
import { CouponStatePill } from "../components/coupon-bits";
import { CategoryChecklist, ProductMultiPicker } from "../components/target-pickers";
import { PERMS, usePermissions } from "../lib/access";
import { couponWindow, randomCode } from "../lib/coupons";
import { CODE_RE, money, normalizeCode, paiseToInput, rupeesToPaise } from "../lib/format";
import { useCoupon, useDeleteCoupon, useRedemptions, useSaveCoupon } from "../lib/queries";
import { COUPON_APPLIES_TO, COUPON_CHANNELS, COUPON_TYPES, type Coupon, type CouponAppliesTo, type CouponChannel, type CouponInput, type CouponType } from "../lib/types";

const intOrEmpty = (msg: string) => z.string().trim().regex(/^$|^\d+$/, msg);
const moneyOrEmpty = z
  .string()
  .trim()
  .refine((v) => v === "" || rupeesToPaise(v) !== null, "orders.validation.amount");

const schema = z
  .object({
    code: z
      .string()
      .transform(normalizeCode)
      .refine((c) => CODE_RE.test(c), "orders.coupons.validation.code"),
    description: z.string().max(500),
    type: z.enum(COUPON_TYPES),
    value: z.string().trim(),
    maxDiscount: moneyOrEmpty,
    minOrder: moneyOrEmpty,
    startsAt: z.string(),
    endsAt: z.string(),
    usageLimit: intOrEmpty("orders.validation.whole"),
    perCustomerLimit: intOrEmpty("orders.validation.whole"),
    firstOrderOnly: z.boolean(),
    appliesTo: z.enum(COUPON_APPLIES_TO),
    targetIds: z.array(z.string()),
    channels: z.array(z.enum(COUPON_CHANNELS)).min(1, "orders.coupons.validation.channels"),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (v.type === "percent") {
      const n = Number(v.value);
      if (!/^\d+$/.test(v.value) || n < 1 || n > 100) issue("value", "orders.coupons.validation.percent");
    }
    if (v.type === "flat" && !(rupeesToPaise(v.value) ?? 0)) issue("value", "orders.validation.amount");
    if (v.appliesTo !== "all" && v.targetIds.length === 0) issue("targetIds", "orders.coupons.validation.targets");
    if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) issue("endsAt", "orders.coupons.validation.dates");
    if (v.usageLimit === "0") issue("usageLimit", "orders.validation.whole");
    if (v.perCustomerLimit === "0") issue("perCustomerLimit", "orders.validation.whole");
  });
type Values = z.input<typeof schema>;

const toValues = (c?: Coupon | null): Values => {
  const w = c ? couponWindow(c) : { from: null, to: null };
  return {
    code: c?.code ?? "",
    description: c?.description ?? "",
    type: c?.type ?? "percent",
    value: c ? (c.type === "percent" ? String(c.value) : c.type === "flat" ? paiseToInput(c.value) : "") : "10",
    maxDiscount: paiseToInput(c?.maxDiscount ?? null),
    minOrder: c?.minOrder ? paiseToInput(c.minOrder) : "",
    startsAt: w.from ?? "",
    endsAt: w.to ?? "",
    usageLimit: c?.usageLimit ? String(c.usageLimit) : "",
    perCustomerLimit: c?.perCustomerLimit ? String(c.perCustomerLimit) : "",
    firstOrderOnly: c?.firstOrderOnly ?? false,
    appliesTo: c?.appliesTo ?? "all",
    targetIds: c?.targetIds ?? [],
    channels: c?.channels ?? ["store"],
    active: c?.active ?? true,
  };
};

function toInput(v: Values): CouponInput {
  const type = v.type as CouponType;
  return {
    code: normalizeCode(v.code),
    description: v.description.trim() || null,
    type,
    value: type === "percent" ? Number(v.value) : type === "flat" ? (rupeesToPaise(v.value) ?? 0) : 0,
    maxDiscount: type === "percent" ? rupeesToPaise(v.maxDiscount) : null,
    minOrder: rupeesToPaise(v.minOrder) ?? 0,
    startsAt: v.startsAt || null,
    endsAt: v.endsAt || null,
    usageLimit: v.usageLimit ? Number(v.usageLimit) : null,
    perCustomerLimit: v.perCustomerLimit ? Number(v.perCustomerLimit) : null,
    firstOrderOnly: v.firstOrderOnly,
    appliesTo: v.appliesTo,
    targetIds: v.appliesTo === "all" ? [] : v.targetIds,
    channels: v.channels as CouponChannel[],
    active: v.active,
  };
}

export default function CouponEditPage() {
  const { id } = useRouteParams<{ id?: string }>();
  const { t } = useI18n();
  const coupon = useCoupon(id ?? null);
  if (!id) return <CouponEditor />;
  if (coupon.isError)
    return (
      <Page>
        <PageHeading icon={TicketPercentIcon} title={t("orders.coupons.edit")} back={{ href: "coupons", label: t("orders.coupons.title") }} />
        <QueryError error={coupon.error} onRetry={() => void coupon.refetch()} />
      </Page>
    );
  if (coupon.isPending)
    return (
      <Page>
        <div className="grid gap-section">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      </Page>
    );
  return <CouponEditor coupon={coupon.data} />;
}

function CouponEditor({ coupon }: { coupon?: Coupon }) {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const { can } = usePermissions();
  const canManage = can(PERMS.coupons);
  const save = useSaveCoupon();
  const del = useDeleteCoupon();
  const [deleting, setDeleting] = React.useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(coupon) });
  const type = useWatch({ control: form.control, name: "type" }) as CouponType;
  const appliesTo = useWatch({ control: form.control, name: "appliesTo" }) as CouponAppliesTo;
  const code = useWatch({ control: form.control, name: "code" });

  React.useEffect(() => {
    form.reset(toValues(coupon));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when another coupon loads
  }, [coupon?.id, coupon?.updatedAt]);

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const saved = await save.mutateAsync({ id: coupon?.id, body: toInput(v) });
      toast.success(coupon ? t("orders.coupons.saved", { code: saved.code }) : t("orders.coupons.created", { code: saved.code }));
      if (!coupon) navigate(`coupons/${saved.id}`, { replace: true });
    } catch (err) {
      toast.error(describeError(err, t));
    }
  });

  const disabled = !canManage;

  return (
    <Page className="pb-28 md:pb-8">
      <PageHeading
        icon={TicketPercentIcon}
        back={{ href: "coupons", label: t("orders.coupons.title") }}
        title={
          coupon ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{coupon.code}</span>
              <CouponStatePill coupon={coupon} />
            </span>
          ) : (
            t("orders.coupons.add")
          )
        }
        description={coupon ? t("orders.coupons.usedSummary", { used: coupon.usedCount }) : t("orders.coupons.addHint")}
        actions={
          coupon && (
            <>
              <CopyButton value={coupon.code} showLabel size="lg" label={t("orders.coupons.copyCode")} copiedMessage={t("orders.coupons.copied", { code: coupon.code })} />
              {canManage && (
                <Button variant="outline" size="icon-lg" className="text-danger-ink" onClick={() => setDeleting(true)} aria-label={t("orders.coupons.delete")}>
                  <Trash2Icon />
                </Button>
              )}
            </>
          )
        }
      />
      {disabled && <ReadOnlyNote icon={LockIcon}>{t("orders.coupons.readOnly")}</ReadOnlyNote>}

      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <fieldset disabled={disabled} className="grid min-w-0 gap-section">
            <Section icon={PercentIcon} title={t("orders.coupons.discount")}>
              <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("orders.coupons.code")}</FormLabel>
                      <div className="flex items-start gap-2">
                        <FormControl>
                          <Input className="font-mono tracking-wide uppercase" autoComplete="off" {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase().replace(/\s+/g, ""))} />
                        </FormControl>
                        <Button type="button" variant="outline" size="icon" onClick={() => form.setValue("code", randomCode(), { shouldDirty: true, shouldValidate: true })} aria-label={t("orders.coupons.generate")}>
                          <ShuffleIcon />
                        </Button>
                      </div>
                      <FormDescription>{t("orders.coupons.codeHint")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("orders.coupons.description")}
                        <Optional />
                      </FormLabel>
                      <FormControl>
                        <Input placeholder={t("orders.coupons.descriptionPlaceholder")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("orders.coupons.typeLabel")}</FormLabel>
                    <ChipGroup<CouponType>
                      aria-label={t("orders.coupons.typeLabel")}
                      value={field.value as CouponType}
                      onChange={(v) => {
                        field.onChange(v);
                        if (v === "percent" && !form.getValues("value")) form.setValue("value", "10");
                      }}
                      options={COUPON_TYPES.map((c) => ({ value: c, label: t(`orders.coupons.type.${c}`) }))}
                    />
                  </FormItem>
                )}
              />
              {type !== "free_shipping" && (
                <div className="grid items-start gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="value"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{type === "percent" ? t("orders.coupons.percentOff") : t("orders.coupons.amountOff")}</FormLabel>
                        {type === "percent" ? (
                          <InputGroup>
                            <FormControl>
                              <InputGroupInput inputMode="numeric" className="pr-1.5 text-right tabular-nums" {...field} onChange={(e) => field.onChange(e.target.value.replace(/\D/g, "").slice(0, 3))} />
                            </FormControl>
                            <InputGroupAddon aria-hidden>%</InputGroupAddon>
                          </InputGroup>
                        ) : (
                          <FormControl>
                            <MoneyInput {...field} />
                          </FormControl>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {type === "percent" && (
                    <FormField
                      control={form.control}
                      name="maxDiscount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("orders.coupons.maxDiscount")}
                            <Optional />
                          </FormLabel>
                          <FormControl>
                            <MoneyInput {...field} placeholder={t("orders.coupons.noCap")} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              )}
              <FormField
                control={form.control}
                name="minOrder"
                render={({ field }) => (
                  <FormItem className="sm:max-w-[calc(50%-0.5rem)]">
                    <FormLabel>
                      {t("orders.coupons.minOrderLabel")}
                      <Optional />
                    </FormLabel>
                    <FormControl>
                      <MoneyInput {...field} placeholder="0" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Section>

            <Section icon={CalendarRangeIcon} tone="text-info-ink" title={t("orders.coupons.validity")} description={t("orders.coupons.validityHint")}>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="startsAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("orders.coupons.starts")}
                        <Optional />
                      </FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endsAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("orders.coupons.ends")}
                        <Optional />
                      </FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </Section>

            <Section icon={ShieldCheckIcon} tone="text-warning-ink" title={t("orders.coupons.limits")}>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="usageLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("orders.coupons.usageLimit")}
                        <Optional />
                      </FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" className="tabular-nums" placeholder={t("orders.coupons.unlimited")} {...field} onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ""))} />
                      </FormControl>
                      <FormDescription>{t("orders.coupons.usageLimitHint")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="perCustomerLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("orders.coupons.perCustomer")}
                        <Optional />
                      </FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" className="tabular-nums" placeholder={t("orders.coupons.unlimited")} {...field} onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ""))} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="firstOrderOnly"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between gap-3 rounded-xl border p-3">
                    <div className="grid gap-0.5">
                      <FormLabel>{t("orders.coupons.firstOrder")}</FormLabel>
                      <FormDescription>{t("orders.coupons.firstOrderHint")}</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="channels"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("orders.coupons.channels")}</FormLabel>
                    <div className="flex flex-wrap gap-2">
                      {COUPON_CHANNELS.map((c) => {
                        const on = (field.value as string[]).includes(c);
                        return (
                          <label key={c} className={cn("flex h-10 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm", on ? "border-primary bg-primary/8" : "bg-card")}>
                            <Checkbox
                              checked={on}
                              onCheckedChange={(v) => field.onChange(v === true ? [...field.value, c] : (field.value as string[]).filter((x) => x !== c))}
                            />
                            {t(`orders.coupons.channel.${c}`)}
                          </label>
                        );
                      })}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Section>

            <Section icon={TargetIcon} title={t("orders.coupons.appliesTo")}>
              <FormField
                control={form.control}
                name="appliesTo"
                render={({ field }) => (
                  <FormItem>
                    <ChipGroup<CouponAppliesTo>
                      aria-label={t("orders.coupons.appliesTo")}
                      value={field.value as CouponAppliesTo}
                      onChange={(v) => {
                        field.onChange(v);
                        form.setValue("targetIds", []);
                      }}
                      options={COUPON_APPLIES_TO.map((a) => ({ value: a, label: t(`orders.coupons.applies.${a}`) }))}
                    />
                  </FormItem>
                )}
              />
              {appliesTo !== "all" && (
                <FormField
                  control={form.control}
                  name="targetIds"
                  render={({ field }) => (
                    <FormItem>
                      {appliesTo === "categories" ? (
                        <CategoryChecklist value={field.value} onChange={field.onChange} disabled={disabled} />
                      ) : (
                        <ProductMultiPicker value={field.value} onChange={field.onChange} disabled={disabled} />
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </Section>

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-3 rounded-2xl border border-card-ring bg-card p-4 shadow-elevated">
                  <div className="grid gap-0.5">
                    <FormLabel>{t("orders.coupons.activeLabel")}</FormLabel>
                    <FormDescription>{t("orders.coupons.activeHint")}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
          </fieldset>

          {canManage && (
            <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
              <div className="mx-auto flex max-w-4xl justify-end gap-2">
                <Button asChild type="button" variant="outline" size="lg">
                  <ModuleLink to="coupons">{t("orders.common.cancel")}</ModuleLink>
                </Button>
                <Button type="submit" size="lg" className="flex-1 md:flex-none" disabled={save.isPending || (!!coupon && !form.formState.isDirty)}>
                  {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
                  {coupon ? t("orders.common.save") : normalizeCode(code) ? t("orders.coupons.create", { code: normalizeCode(code) }) : t("orders.coupons.add")}
                </Button>
              </div>
            </div>
          )}
        </form>
      </Form>

      {coupon && <Redemptions couponId={coupon.id} />}

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("orders.coupons.deleteTitle", { code: coupon?.code ?? "" })}
        description={t("orders.coupons.deleteBody")}
        confirmLabel={t("orders.coupons.delete")}
        onConfirm={async () => {
          if (!coupon) return;
          try {
            await del.mutateAsync(coupon.id);
            toast.success(t("orders.coupons.deleted", { code: coupon.code }));
            navigate("coupons", { replace: true });
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </Page>
  );
}

function Redemptions({ couponId }: { couponId: string }) {
  const { t, formatDate } = useI18n();
  const r = useRedemptions(couponId);
  return (
    <Section icon={HistoryIcon} title={t("orders.coupons.redemptions")} className="mt-4" bodyClassName="px-0 py-0 sm:px-0">
      {r.isError ? (
        <QueryError compact error={r.error} onRetry={() => void r.refetch()} />
      ) : r.isPending ? (
        <div className="grid gap-2 p-4">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : (r.data?.items ?? []).length === 0 ? (
        <EmptyState compact icon={HistoryIcon} title={t("orders.coupons.noRedemptions")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4 sm:pl-5">{t("orders.coupons.col.date")}</TableHead>
              <TableHead>{t("orders.coupons.col.ref")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("orders.coupons.col.customer")}</TableHead>
              <TableHead className="text-right">{t("orders.coupons.col.amount")}</TableHead>
              <TableHead className="pr-4 sm:pr-5">{t("orders.coupons.col.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.data!.items.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="pl-4 whitespace-nowrap tabular-nums sm:pl-5">{formatDate(x.createdAt, { day: "numeric", month: "short", year: "numeric" })}</TableCell>
                <TableCell>
                  {x.refType === "order" ? (
                    <ModuleLink to={`orders/${x.refId}`} className="text-primary hover:underline">
                      {t("orders.coupons.viewOrder")}
                    </ModuleLink>
                  ) : (
                    t("orders.coupons.bill")
                  )}
                </TableCell>
                <TableCell className="hidden max-w-[12rem] truncate text-muted-foreground sm:table-cell">{maskKey(x.customerKey)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{money(x.amount)}</TableCell>
                <TableCell className="pr-4 sm:pr-5">
                  <StatusPill tone={x.status === "active" ? "success" : "neutral"} icon={x.status === "active" ? CheckCircle2Icon : Undo2Icon}>{t(`orders.coupons.redemption.${x.status}`)}</StatusPill>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

/** "ph:+919876543210" → "+91 ••••• 43210"; accounts and emails shortened. */
function maskKey(key: string | null): string {
  if (!key) return "—";
  const [kind, rest = ""] = key.split(/:(.*)/s);
  if (kind === "ph") return `${rest.slice(0, 3)} ••••• ${rest.slice(-5)}`;
  if (kind === "em") return rest.replace(/^(.).*(@.*)$/, "$1•••$2");
  return "•••";
}
