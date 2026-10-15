"use client";

import * as React from "react";
import { BoxesIcon, ImageIcon, InfoIcon, LayersIcon, Loader2Icon, PlusIcon, ReceiptIndianRupeeIcon, SendIcon, Trash2Icon, UndoIcon, XIcon } from "lucide-react";
import { GST_RATES } from "@srirealtime/gst";
import {
  AnimatePresence,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, Page, PageHeading, QueryError, useI18n, useModuleNavigate, useRouteParams } from "@srirealtime/web";
import { cartesian, comboKey, discountPct, money, paiseToInput, rupeesToPaise, variantTitle } from "../lib/logic";
import { useAddVariant, useCreateProduct, useDeleteProduct, useDeleteVariant, useMyProduct, useUpdateProduct, useUpdateVariant } from "../lib/vendor";
import type { CatalogProduct, ProductImage, ProductOption, ProductStatus } from "../lib/types";
import { ImageManager, ProductStatusPill } from "./product-bits";

interface Row {
  key: string;
  id?: string;
  optionValues: Record<string, string>;
  price: string;
  mrp: string;
  sku: string;
}

interface Draft {
  name: string;
  description: string;
  hsn: string;
  gstRate: number;
  taxInclusive: boolean;
  unit: string;
  images: ProductImage[];
  hasVariants: boolean;
  options: ProductOption[];
  /** Simple product (no options): the single row. */
  rows: Row[];
}

const newRow = (optionValues: Record<string, string> = {}): Row => ({ key: comboKey(optionValues) || "default", optionValues, price: "", mrp: "", sku: "" });

const emptyDraft = (): Draft => ({
  name: "",
  description: "",
  hsn: "",
  gstRate: 5,
  taxInclusive: true,
  unit: "pcs",
  images: [],
  hasVariants: false,
  options: [],
  rows: [newRow()],
});

function fromProduct(p: CatalogProduct): Draft {
  const hasVariants = p.options.length > 0;
  return {
    name: p.name,
    description: p.description ?? "",
    hsn: p.hsn ?? "",
    gstRate: p.gstRate,
    taxInclusive: p.taxInclusive,
    unit: p.unit,
    images: p.images,
    hasVariants,
    options: p.options,
    rows: [...p.variants]
      .sort((a, b) => a.position - b.position)
      .map((v) => ({ key: hasVariants ? comboKey(v.optionValues) : "default", id: v.id, optionValues: v.optionValues, price: paiseToInput(v.price), mrp: paiseToInput(v.mrp), sku: v.sku ?? "" })),
  };
}

/** Rows for the current options: one per combination, keeping what was typed for combinations that still exist. */
function syncRows(options: ProductOption[], rows: Row[]): Row[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const combos = cartesian(options);
  if (combos.length === 0) return [rows.find((r) => r.key === "default") ?? rows[0] ?? newRow()].map((r) => ({ ...r, key: "default", optionValues: {} }));
  const first = rows[0];
  return combos.map((c) => byKey.get(comboKey(c)) ?? { ...newRow(c), price: first?.price ?? "", mrp: first?.mrp ?? "" });
}

type Errors = Partial<Record<"name" | "hsn" | "options", string>> & { rows?: Record<string, Partial<Record<"price" | "mrp" | "sku", string>>> };

function validate(d: Draft): Errors {
  const e: Errors = {};
  if (d.name.trim().length < 2) e.name = "marketplace.validation.name";
  if (d.hsn.trim() && !/^[0-9]{2,8}$/.test(d.hsn.trim())) e.hsn = "marketplace.validation.hsn";
  if (d.hasVariants && cartesian(d.options).length === 0) e.options = "marketplace.validation.options";
  const rows: NonNullable<Errors["rows"]> = {};
  for (const r of d.rows) {
    const re: Partial<Record<"price" | "mrp" | "sku", string>> = {};
    const price = rupeesToPaise(r.price);
    const mrp = r.mrp.trim() ? rupeesToPaise(r.mrp) : null;
    if (price === null || price <= 0) re.price = "marketplace.validation.price";
    if (r.mrp.trim() && (mrp === null || (price !== null && mrp < price))) re.mrp = "marketplace.validation.mrp";
    if (r.sku.trim() && /\s/.test(r.sku.trim())) re.sku = "marketplace.validation.sku";
    if (Object.keys(re).length) rows[r.key] = re;
  }
  if (Object.keys(rows).length) e.rows = rows;
  return e;
}

const variantBody = (r: Row, options: ProductOption[], i: number) => ({
  optionValues: r.optionValues,
  title: options.length ? variantTitle(r.optionValues, options) : null,
  price: rupeesToPaise(r.price)!,
  mrp: r.mrp.trim() ? rupeesToPaise(r.mrp) : null,
  sku: r.sku.trim() || null,
  position: i,
});

/** Create (products/new) or edit (products/:id) one of the seller's products. */
export default function ProductEditorPage() {
  const { id } = useRouteParams<{ id?: string }>();
  const { t } = useI18n();
  const isNew = !id || id === "new";
  const q = useMyProduct(isNew ? null : id);
  if (!isNew && q.isError)
    return (
      <Page className="max-w-4xl">
        <PageHeading title={t("marketplace.editor.editTitle")} back={{ href: "products", label: t("marketplace.portal.nav.products") }} />
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      </Page>
    );
  if (!isNew && q.isPending)
    return (
      <Page className="max-w-4xl">
        <Skeleton className="mb-5 h-10 w-64" />
        <div className="grid gap-4">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      </Page>
    );
  return <Editor key={q.data?.id ?? "new"} product={isNew ? null : (q.data ?? null)} />;
}

function Editor({ product }: { product: CatalogProduct | null }) {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const addVariant = useAddVariant();
  const updateVariant = useUpdateVariant();
  const deleteVariant = useDeleteVariant();
  const del = useDeleteProduct();
  const [d, setD] = React.useState<Draft>(() => (product ? fromProduct(product) : emptyDraft()));
  const [tried, setTried] = React.useState(false);
  const [saving, setSaving] = React.useState<ProductStatus | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const errors = validate(d);
  const shown: Errors = tried ? errors : {};
  const status: ProductStatus = product?.status ?? "draft";

  const setOptions = (options: ProductOption[]) => setD((x) => ({ ...x, options, rows: syncRows(options, x.rows) }));
  const toggleVariants = (on: boolean) => {
    const options = on ? (d.options.length ? d.options : [{ name: t("marketplace.editor.sizeOption"), values: [] }]) : [];
    setD((x) => ({ ...x, hasVariants: on, options, rows: syncRows(options, x.rows) }));
  };

  const save = async (next: ProductStatus) => {
    setTried(true);
    if (Object.keys(errors).length) {
      toast.error(t("marketplace.validation.fixErrors"));
      return;
    }
    setSaving(next);
    const fields = {
      name: d.name.trim(),
      description: d.description.trim() || null,
      hsn: d.hsn.trim() || null,
      gstRate: d.gstRate,
      taxInclusive: d.taxInclusive,
      unit: d.unit,
      images: d.images,
      status: next,
      channels: ["store"],
    };
    const options = d.hasVariants ? d.options.filter((o) => o.name.trim() && o.values.length) : [];
    try {
      if (!product) {
        const body: Record<string, unknown> = { ...fields, options };
        if (options.length) body.variants = d.rows.map((r, i) => variantBody(r, options, i));
        else {
          const r = d.rows[0]!;
          Object.assign(body, { price: rupeesToPaise(r.price), mrp: r.mrp.trim() ? rupeesToPaise(r.mrp) : null, sku: r.sku.trim() || null });
        }
        const created = await create.mutateAsync(body);
        toast.success(t(next === "active" ? "marketplace.editor.submitted" : "marketplace.editor.savedDraft"));
        navigate(`products/${created.id}`, { replace: true });
      } else {
        await update.mutateAsync({ id: product.id, patch: { ...fields, options } });
        const keep = new Set<string>();
        for (const [i, r] of d.rows.entries()) {
          const body = variantBody(r, options, i);
          if (r.id) {
            keep.add(r.id);
            await updateVariant.mutateAsync({ id: r.id, patch: body });
          } else await addVariant.mutateAsync({ productId: product.id, variant: body });
        }
        for (const v of product.variants) if (!keep.has(v.id)) await deleteVariant.mutateAsync(v.id);
        toast.success(t(next !== status ? (next === "active" ? "marketplace.editor.submitted" : "marketplace.editor.movedToDraft") : "marketplace.common.saved"));
      }
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setSaving(null);
    }
  };

  const busy = saving !== null;

  return (
    <Page className="max-w-4xl">
      <PageHeading
        back={{ href: "products", label: t("marketplace.portal.nav.products") }}
        title={product ? product.name : t("marketplace.editor.newTitle")}
        description={product ? <ProductStatusPill status={product.status} /> : t("marketplace.editor.newBody")}
        actions={
          product && (
            <Button variant="ghost" onClick={() => setDeleting(true)} className="text-danger-ink">
              <Trash2Icon /> {t("marketplace.common.delete")}
            </Button>
          )
        }
      />

      <div className="grid gap-4 pb-28 md:pb-20">
        <Section icon={ImageIcon} title={t("marketplace.editor.basics")}>
          <Field invalid={!!shown.name}>
            <FieldLabel>{t("marketplace.editor.name")}</FieldLabel>
            <FieldControl>
              <Input value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={200} />
            </FieldControl>
            <FieldError>{shown.name ? t(shown.name) : null}</FieldError>
          </Field>
          <Field>
            <FieldLabel optional={t("marketplace.common.optional")}>{t("marketplace.editor.description")}</FieldLabel>
            <FieldControl>
              <Textarea value={d.description} onChange={(e) => set({ description: e.target.value })} rows={5} maxLength={20_000} />
            </FieldControl>
            <FieldHint>{t("marketplace.editor.descriptionHint")}</FieldHint>
          </Field>
          <Field>
            <FieldLabel htmlFor={null} aside={<span className="tabular-nums">{d.images.length}/8</span>}>
              {t("marketplace.editor.photos")}
            </FieldLabel>
            <ImageManager images={d.images} onChange={(images) => set({ images })} />
            <FieldHint>{t("marketplace.editor.photosHint")}</FieldHint>
          </Field>
        </Section>

        <Section icon={ReceiptIndianRupeeIcon} title={t("marketplace.editor.tax")}>
          <FieldRow cols={3}>
            <Field>
              <FieldLabel>{t("marketplace.editor.gstRate")}</FieldLabel>
              <Select value={String(d.gstRate)} onValueChange={(v) => set({ gstRate: Number(v) })}>
                <FieldControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {GST_RATES.map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {r}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field invalid={!!shown.hsn}>
              <FieldLabel optional={t("marketplace.common.optional")}>{t("marketplace.editor.hsn")}</FieldLabel>
              <FieldControl>
                <Input value={d.hsn} onChange={(e) => set({ hsn: e.target.value.replace(/\D/g, "").slice(0, 8) })} inputMode="numeric" />
              </FieldControl>
              <FieldError>{shown.hsn ? t(shown.hsn) : null}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("marketplace.editor.unit")}</FieldLabel>
              <Select value={d.unit} onValueChange={(unit) => set({ unit })}>
                <FieldControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {["pcs", "kg", "g", "l", "ml", "m", "pair", "set", "box"].map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldRow>
          <Field>
            <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <div className="grid gap-1">
                <FieldLabel>{t("marketplace.editor.taxInclusive")}</FieldLabel>
                <FieldHint>{t("marketplace.editor.taxInclusiveHint")}</FieldHint>
              </div>
              <FieldControl>
                <Switch checked={d.taxInclusive} onCheckedChange={(taxInclusive) => set({ taxInclusive })} />
              </FieldControl>
            </div>
          </Field>
        </Section>

        <Section icon={LayersIcon} title={t("marketplace.editor.pricing")}>
          <Field>
            <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <div className="grid gap-1">
                <FieldLabel>{t("marketplace.editor.hasVariants")}</FieldLabel>
                <FieldHint>{t("marketplace.editor.hasVariantsHint")}</FieldHint>
              </div>
              <FieldControl>
                <Switch checked={d.hasVariants} onCheckedChange={toggleVariants} />
              </FieldControl>
            </div>
          </Field>
          {d.hasVariants ? (
            <>
              <OptionsBuilder options={d.options} onChange={setOptions} />
              {shown.options && <p className="text-xs text-destructive">{t(shown.options)}</p>}
              <VariantRows rows={d.rows} options={d.options} errors={shown.rows} onChange={(rows) => set({ rows })} />
            </>
          ) : (
            <PriceFields row={d.rows[0]!} errors={shown.rows?.[d.rows[0]!.key]} onChange={(r) => set({ rows: [r] })} />
          )}
        </Section>

        <Section icon={BoxesIcon} title={t("marketplace.editor.stock")}>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <InfoIcon className="mt-0.5 size-4 shrink-0" /> {t("marketplace.editor.stockNote")}
          </p>
        </Section>
      </div>

      {/* Sticky action bar above the phone tab bar. */}
      <div className="fixed inset-x-0 bottom-16 z-30 border-t bg-card/95 px-4 py-3 backdrop-blur md:sticky md:bottom-4 md:mx-auto md:max-w-4xl md:rounded-2xl md:border md:shadow-elevated">
        <div className="mx-auto flex max-w-4xl items-center justify-end gap-2">
          <p className="mr-auto hidden text-xs text-muted-foreground sm:block">{t(status === "active" ? "marketplace.editor.liveNote" : "marketplace.editor.draftNote")}</p>
          {status === "active" && product ? (
            <>
              <Button variant="outline" onClick={() => void save("draft")} disabled={busy}>
                {saving === "draft" ? <Loader2Icon className="animate-spin" /> : <UndoIcon />} {t("marketplace.editor.toDraft")}
              </Button>
              <Button onClick={() => void save("active")} disabled={busy}>
                {saving === "active" && <Loader2Icon className="animate-spin" />} {t("marketplace.common.save")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => void save("draft")} disabled={busy}>
                {saving === "draft" && <Loader2Icon className="animate-spin" />} {t("marketplace.editor.saveDraft")}
              </Button>
              <Button onClick={() => void save("active")} disabled={busy}>
                {saving === "active" ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {t("marketplace.editor.submit")}
              </Button>
            </>
          )}
        </div>
      </div>

      {product && (
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={t("marketplace.editor.deleteTitle", { name: product.name })}
          description={t("marketplace.editor.deleteBody")}
          confirmLabel={t("marketplace.common.delete")}
          onConfirm={async () => {
            try {
              await del.mutateAsync(product.id);
              toast.success(t("marketplace.editor.deleted"));
              navigate("products", { replace: true });
            } catch (err) {
              toast.error(describeError(err, t));
              throw err;
            }
          }}
        />
      )}
    </Page>
  );
}

function Section({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-4 sm:px-6">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="icon-chip size-8 text-primary">
            <Icon className="size-4" />
          </span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 px-4 sm:px-6">{children}</CardContent>
    </Card>
  );
}

function PriceFields({ row, errors, onChange }: { row: Row; errors?: Partial<Record<"price" | "mrp" | "sku", string>>; onChange: (r: Row) => void }) {
  const { t } = useI18n();
  const price = rupeesToPaise(row.price);
  const off = price !== null ? discountPct(price, rupeesToPaise(row.mrp)) : null;
  return (
    <FieldRow cols={3}>
      <Field invalid={!!errors?.price}>
        <FieldLabel>{t("marketplace.editor.price")}</FieldLabel>
        <InputGroup>
          <InputGroupAddon>₹</InputGroupAddon>
          <FieldControl>
            <InputGroupInput value={row.price} onChange={(e) => onChange({ ...row, price: e.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" />
          </FieldControl>
        </InputGroup>
        <FieldError>{errors?.price ? t(errors.price) : null}</FieldError>
      </Field>
      <Field invalid={!!errors?.mrp}>
        <FieldLabel optional={t("marketplace.common.optional")} aside={off ? <Badge variant="secondary">{t("marketplace.editor.off", { pct: off })}</Badge> : undefined}>
          {t("marketplace.editor.mrp")}
        </FieldLabel>
        <InputGroup>
          <InputGroupAddon>₹</InputGroupAddon>
          <FieldControl>
            <InputGroupInput value={row.mrp} onChange={(e) => onChange({ ...row, mrp: e.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" />
          </FieldControl>
        </InputGroup>
        <FieldError>{errors?.mrp ? t(errors.mrp) : null}</FieldError>
      </Field>
      <Field invalid={!!errors?.sku}>
        <FieldLabel optional={t("marketplace.common.optional")}>{t("marketplace.editor.sku")}</FieldLabel>
        <FieldControl>
          <Input value={row.sku} onChange={(e) => onChange({ ...row, sku: e.target.value })} maxLength={64} />
        </FieldControl>
        <FieldError>{errors?.sku ? t(errors.sku) : null}</FieldError>
      </Field>
    </FieldRow>
  );
}

/** Up to three options (Size, Colour…) with their values as chips. */
function OptionsBuilder({ options, onChange }: { options: ProductOption[]; onChange: (o: ProductOption[]) => void }) {
  const { t } = useI18n();
  const setAt = (i: number, o: ProductOption) => onChange(options.map((x, k) => (k === i ? o : x)));
  return (
    <div className="grid gap-3">
      <AnimatePresence initial={false}>
        {options.map((o, i) => (
          <motion.div key={i} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="grid gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-start">
            <Field>
              <FieldLabel>{t("marketplace.editor.optionName")}</FieldLabel>
              <FieldControl>
                <Input value={o.name} onChange={(e) => setAt(i, { ...o, name: e.target.value })} maxLength={40} />
              </FieldControl>
            </Field>
            <ValuesInput values={o.values} onChange={(values) => setAt(i, { ...o, values })} />
            <Button type="button" variant="ghost" size="icon" className="sm:mt-7" onClick={() => onChange(options.filter((_, k) => k !== i))} aria-label={t("marketplace.common.remove")}>
              <Trash2Icon />
            </Button>
          </motion.div>
        ))}
      </AnimatePresence>
      {options.length < 3 && (
        <Button type="button" variant="outline" className="justify-self-start" onClick={() => onChange([...options, { name: "", values: [] }])}>
          <PlusIcon /> {t("marketplace.editor.addOption")}
        </Button>
      )}
    </div>
  );
}

function ValuesInput({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const { t } = useI18n();
  const [text, setText] = React.useState("");
  const commit = () => {
    const add = text
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !values.some((v) => v.toLowerCase() === s.toLowerCase()));
    if (add.length) onChange([...values, ...add].slice(0, 30));
    setText("");
  };
  return (
    <Field>
      <FieldLabel>{t("marketplace.editor.optionValues")}</FieldLabel>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
        {values.map((v) => (
          <motion.span key={v} layout initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="inline-flex h-7 items-center gap-1 rounded-md bg-primary/10 pr-1 pl-2 text-sm text-primary">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="rounded p-0.5 hover:bg-primary/15" aria-label={t("marketplace.common.removeNamed", { name: v })}>
              <XIcon className="size-3" />
            </button>
          </motion.span>
        ))}
        <FieldControl>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commit();
              } else if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1));
            }}
            onBlur={commit}
            placeholder={values.length ? "" : t("marketplace.editor.optionValuesPlaceholder")}
            className="h-7 min-w-24 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
          />
        </FieldControl>
      </div>
      <FieldHint>{t("marketplace.editor.optionValuesHint")}</FieldHint>
    </Field>
  );
}

function VariantRows({ rows, options, errors, onChange }: { rows: Row[]; options: ProductOption[]; errors?: Errors["rows"]; onChange: (r: Row[]) => void }) {
  const { t } = useI18n();
  const setRow = (key: string, patch: Partial<Row>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const applyAll = () => {
    const first = rows[0];
    if (first) onChange(rows.map((r) => ({ ...r, price: first.price, mrp: first.mrp })));
  };
  if (rows.length === 0 || cartesian(options).length === 0) return null;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("marketplace.editor.variantCount", { count: rows.length })}</p>
        {rows.length > 1 && (
          <Button type="button" variant="ghost" size="sm" onClick={applyAll}>
            {t("marketplace.editor.applyFirst")}
          </Button>
        )}
      </div>
      <div className="grid gap-2">
        {rows.map((r) => {
          const e = errors?.[r.key];
          return (
            <motion.div key={r.key} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={cn("grid items-start gap-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_9rem]", e && "border-destructive/40")}>
              <p className="self-center text-sm font-medium">
                {variantTitle(r.optionValues, options)}
                {!r.id && <span className="ml-2 text-xs font-normal text-primary">{t("marketplace.editor.newVariant")}</span>}
              </p>
              <Field invalid={!!e?.price}>
                <InputGroup size="sm">
                  <InputGroupAddon>₹</InputGroupAddon>
                  <FieldControl>
                    <InputGroupInput value={r.price} onChange={(ev) => setRow(r.key, { price: ev.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" placeholder={t("marketplace.editor.price")} aria-label={t("marketplace.editor.priceFor", { name: variantTitle(r.optionValues, options) })} />
                  </FieldControl>
                </InputGroup>
                <FieldError>{e?.price ? t(e.price) : null}</FieldError>
              </Field>
              <Field invalid={!!e?.mrp}>
                <InputGroup size="sm">
                  <InputGroupAddon>₹</InputGroupAddon>
                  <FieldControl>
                    <InputGroupInput value={r.mrp} onChange={(ev) => setRow(r.key, { mrp: ev.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" placeholder={t("marketplace.editor.mrp")} aria-label={t("marketplace.editor.mrpFor", { name: variantTitle(r.optionValues, options) })} />
                  </FieldControl>
                </InputGroup>
                <FieldError>{e?.mrp ? t(e.mrp) : null}</FieldError>
              </Field>
              <Field invalid={!!e?.sku}>
                <FieldControl>
                  <Input size="sm" value={r.sku} onChange={(ev) => setRow(r.key, { sku: ev.target.value })} placeholder={t("marketplace.editor.sku")} aria-label={t("marketplace.editor.sku")} />
                </FieldControl>
                <FieldError>{e?.sku ? t(e.sku) : null}</FieldError>
              </Field>
            </motion.div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t("marketplace.editor.priceRange", { range: priceRangeOf(rows) })}</p>
    </div>
  );
}

function priceRangeOf(rows: Row[]) {
  const ps = rows.map((r) => rupeesToPaise(r.price)).filter((p): p is number => p !== null && p > 0);
  if (!ps.length) return "—";
  const min = Math.min(...ps);
  const max = Math.max(...ps);
  return min === max ? money(min) : `${money(min)} – ${money(max)}`;
}
