"use client";

import * as React from "react";
import { BadgeCheckIcon, ChevronDownIcon, InfoIcon, Loader2Icon, PackageIcon, SearchIcon, StarIcon, XIcon } from "lucide-react";
import {
  Button,
  ChipGroup,
  cn,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { absoluteUrl, ApiError, describeError, useDebounced, useI18n } from "@srirealtime/web";
import { Thumb } from "./bits";
import { ImageField } from "./image-field";
import { useCreateReview, useProductSearch, useProductsByIds } from "../lib/queries";
import { REVIEW_PLATFORMS, STAFF_REVIEW_SOURCES, type ReviewPlatform, type StaffReviewSource } from "../lib/types";

const MAX_PHOTOS = 5;
/** Today in IST, "YYYY-MM-DD" (the latest date a review can have). */
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

interface FormState {
  productId: string;
  rating: number;
  title: string;
  body: string;
  authorName: string;
  city: string;
  date: string;
  photos: string[];
  source: StaffReviewSource;
  platform: ReviewPlatform;
  sourceUrl: string;
  orderNumber: string;
  status: "approved" | "pending";
}

const empty = (productId = ""): FormState => ({
  productId,
  rating: 0,
  title: "",
  body: "",
  authorName: "",
  city: "",
  date: istToday(),
  photos: [],
  source: "in_store",
  platform: "google",
  sourceUrl: "",
  orderNumber: "",
  status: "approved",
});

/**
 * "Add review": a review a customer gave the shop elsewhere, entered by staff. The source is required and shown on
 * the store; "Verified purchase" only comes from a delivered order number (checked by the API).
 */
export function AddReviewSheet({ open, onOpenChange, productId }: { open: boolean; onOpenChange: (o: boolean) => void; productId?: string }) {
  const { t } = useI18n();
  const create = useCreateReview();
  const [f, setF] = React.useState<FormState>(() => empty(productId));
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({});
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF((s) => ({ ...s, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  React.useEffect(() => {
    if (open) {
      setF(empty(productId));
      setErrors({});
    }
  }, [open, productId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!f.productId) errs.productId = t("site.reviews.f.productRequired");
    if (!f.rating) errs.rating = t("site.reviews.f.ratingRequired");
    if (!f.authorName.trim()) errs.authorName = t("site.reviews.f.nameRequired");
    if (f.date && f.date > istToday()) errs.date = t("site.reviews.f.dateFuture");
    if (f.source === "imported" && f.sourceUrl.trim() && !/^https?:\/\//i.test(f.sourceUrl.trim())) errs.sourceUrl = t("site.reviews.f.urlInvalid");
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const r = await create.mutateAsync({
        productId: f.productId,
        rating: f.rating,
        title: f.title.trim() || undefined,
        body: f.body.trim() || undefined,
        authorName: f.authorName.trim(),
        city: f.city.trim() || undefined,
        date: f.date || undefined,
        photos: f.photos.map((p) => absoluteUrl(p) ?? p),
        source: f.source,
        platform: f.source === "imported" ? f.platform : undefined,
        sourceUrl: f.source === "imported" ? f.sourceUrl.trim() || undefined : undefined,
        orderNumber: f.orderNumber.trim() || undefined,
        status: f.status,
      });
      toast.success(r.status === "approved" ? t("site.reviews.f.saved") : t("site.reviews.f.savedPending"), r.verified ? { description: t("site.reviews.f.savedVerified") } : undefined);
      onOpenChange(false);
    } catch (err) {
      // Order-number problems come back as a 400 with a readable message: show it under the field.
      if (err instanceof ApiError && f.orderNumber.trim() && /order/i.test(err.message)) setErrors({ orderNumber: err.message });
      else toast.error(describeError(err, t));
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" closeLabel={t("site.reviews.close")} className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>{t("site.reviews.addTitle")}</SheetTitle>
          <SheetDescription>{t("site.reviews.addBody")}</SheetDescription>
        </SheetHeader>
        <form id="review-add" onSubmit={submit} noValidate className="grid flex-1 content-start gap-5 overflow-y-auto p-4">
          <Field invalid={!!errors.productId}>
            <FieldLabel>{t("site.reviews.f.product")}</FieldLabel>
            <ProductPick value={f.productId} onChange={(id) => set("productId", id)} invalid={!!errors.productId} />
            <FieldError>{errors.productId}</FieldError>
          </Field>

          <Field invalid={!!errors.rating}>
            <FieldLabel htmlFor={null}>{t("site.reviews.f.rating")}</FieldLabel>
            <RatingInput value={f.rating} onChange={(n) => set("rating", n)} />
            <FieldError>{errors.rating}</FieldError>
          </Field>

          <Field>
            <FieldLabel optional={t("site.common.optional")}>{t("site.reviews.f.title")}</FieldLabel>
            <FieldControl>
              <Input value={f.title} maxLength={120} onChange={(e) => set("title", e.target.value)} />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel optional={t("site.common.optional")}>{t("site.reviews.f.text")}</FieldLabel>
            <FieldControl>
              <Textarea rows={4} maxLength={5000} value={f.body} onChange={(e) => set("body", e.target.value)} placeholder={t("site.reviews.f.textPlaceholder")} />
            </FieldControl>
          </Field>

          <FieldRow>
            <Field invalid={!!errors.authorName}>
              <FieldLabel>{t("site.reviews.f.name")}</FieldLabel>
              <FieldControl>
                <Input value={f.authorName} maxLength={80} autoComplete="off" onChange={(e) => set("authorName", e.target.value)} />
              </FieldControl>
              {errors.authorName ? <FieldError>{errors.authorName}</FieldError> : <FieldHint>{t("site.reviews.f.nameHint")}</FieldHint>}
            </Field>
            <Field>
              <FieldLabel optional={t("site.common.optional")}>{t("site.reviews.f.city")}</FieldLabel>
              <FieldControl>
                <Input value={f.city} maxLength={60} onChange={(e) => set("city", e.target.value)} />
              </FieldControl>
            </Field>
          </FieldRow>

          <Field invalid={!!errors.date}>
            <FieldLabel>{t("site.reviews.f.date")}</FieldLabel>
            <FieldControl>
              <Input type="date" className="sm:w-56" value={f.date} max={istToday()} onChange={(e) => set("date", e.target.value)} />
            </FieldControl>
            {errors.date ? <FieldError>{errors.date}</FieldError> : <FieldHint>{t("site.reviews.f.dateHint")}</FieldHint>}
          </Field>

          <Field>
            <FieldLabel htmlFor={null}>{t("site.reviews.f.source")}</FieldLabel>
            <ChipGroup<StaffReviewSource>
              size="sm"
              aria-label={t("site.reviews.f.source")}
              value={f.source}
              onChange={(v) => set("source", v)}
              options={STAFF_REVIEW_SOURCES.map((s) => ({ value: s, label: t(`site.reviews.source.${s}`) }))}
            />
            <FieldHint>{t(`site.reviews.f.sourceHint.${f.source}`)}</FieldHint>
          </Field>

          {f.source === "imported" && (
            <FieldRow>
              <Field>
                <FieldLabel>{t("site.reviews.f.platform")}</FieldLabel>
                <Select value={f.platform} onValueChange={(v) => set("platform", v as ReviewPlatform)}>
                  <FieldControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FieldControl>
                  <SelectContent>
                    {REVIEW_PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {t(`site.reviews.platform.${p}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field invalid={!!errors.sourceUrl}>
                <FieldLabel optional={t("site.common.optional")}>{t("site.reviews.f.sourceUrl")}</FieldLabel>
                <FieldControl>
                  <Input type="url" inputMode="url" placeholder="https://" value={f.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} />
                </FieldControl>
                {errors.sourceUrl ? <FieldError>{errors.sourceUrl}</FieldError> : <FieldHint>{t("site.reviews.f.sourceUrlHint")}</FieldHint>}
              </Field>
            </FieldRow>
          )}

          <Field invalid={!!errors.orderNumber}>
            <FieldLabel optional={t("site.common.optional")}>{t("site.reviews.f.order")}</FieldLabel>
            <FieldControl>
              <Input className="sm:w-64" value={f.orderNumber} maxLength={40} placeholder="ORD/26-27/0001" onChange={(e) => set("orderNumber", e.target.value)} />
            </FieldControl>
            {errors.orderNumber ? (
              <FieldError>{errors.orderNumber}</FieldError>
            ) : (
              <FieldHint className="flex items-start gap-1.5">
                <BadgeCheckIcon className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> {t("site.reviews.f.orderHint")}
              </FieldHint>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor={null} optional={t("site.common.optional")}>
              {t("site.reviews.f.photos")}
            </FieldLabel>
            <PhotosInput value={f.photos} onChange={(v) => set("photos", v)} />
            <FieldHint>{t("site.reviews.f.photosHint")}</FieldHint>
          </Field>

          <Field>
            <FieldLabel htmlFor={null}>{t("site.reviews.f.status")}</FieldLabel>
            <ChipGroup<"approved" | "pending">
              size="sm"
              aria-label={t("site.reviews.f.status")}
              value={f.status}
              onChange={(v) => set("status", v)}
              options={[
                { value: "approved", label: t("site.reviews.f.publish") },
                { value: "pending", label: t("site.reviews.f.hold") },
              ]}
            />
          </Field>

          <p className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-meta text-muted-foreground">
            <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("site.reviews.f.honesty")}
          </p>
        </form>
        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("site.common.cancel")}
          </Button>
          <Button type="submit" form="review-add" disabled={create.isPending}>
            {create.isPending && <Loader2Icon className="animate-spin" />}
            {t("site.reviews.f.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function RatingInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { t } = useI18n();
  const [hover, setHover] = React.useState(0);
  return (
    <div role="radiogroup" aria-label={t("site.reviews.f.rating")} className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={t("site.reviews.stars", { count: n })}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          className="rounded-md p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StarIcon className={cn("size-8 transition-colors", n <= (hover || value) ? "fill-warning text-warning" : "text-muted-foreground/40")} />
        </button>
      ))}
      {value > 0 && <span className="ms-2 text-sm text-muted-foreground tabular-nums">{value} / 5</span>}
    </div>
  );
}

/** Up to five photos: thumbnails with remove, plus one upload / media library slot. */
function PhotosInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useI18n();
  const latest = React.useRef(value);
  latest.current = value;
  return (
    <div className="grid gap-3">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((src, i) => (
            <li key={`${src}#${i}`} className="relative">
              <Thumb src={src} className="size-20" />
              <button
                type="button"
                aria-label={t("site.reviews.f.removePhoto", { n: i + 1 })}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 inline-flex size-6 items-center justify-center rounded-full bg-background shadow ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <XIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.length < MAX_PHOTOS && (
        <ImageField
          key={value.length}
          value=""
          aspect="aspect-[3/1]"
          label={t("site.reviews.f.addPhoto")}
          onChange={(url) => url && !latest.current.includes(url) && onChange([...latest.current, url].slice(0, MAX_PHOTOS))}
        />
      )}
    </div>
  );
}

/** Searchable product picker showing the chosen product's thumbnail and name. */
function ProductPick({ value, onChange, invalid }: { value: string; onChange: (id: string) => void; invalid?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const debounced = useDebounced(q.trim(), 250);
  const search = useProductSearch(debounced, open);
  const picked = useProductsByIds(value ? [value] : []);
  const p = value ? picked.data?.get(value) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" aria-invalid={invalid || undefined} className={cn("h-auto min-h-11 w-full justify-start gap-2 py-1.5 font-normal", invalid && "border-destructive")}>
          {p ? <Thumb src={p.image} className="size-8 rounded-lg" /> : <PackageIcon className="text-muted-foreground" />}
          <span className={cn("min-w-0 flex-1 truncate text-left", !p && "text-muted-foreground")}>
            {p?.name ?? (value && picked.isPending ? t("site.common.loading") : t("site.reviews.f.productPick"))}
          </span>
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-2">
        <div className="relative mb-2">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus type="search" className="pl-9" value={q} placeholder={t("site.pickers.searchProducts")} aria-label={t("site.pickers.searchProducts")} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="max-h-72 overflow-y-auto">
          {search.isPending ? (
            <li className="p-2">
              <Skeleton className="h-10 w-full" />
            </li>
          ) : (search.data?.items.length ?? 0) === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">{t("site.pickers.noProducts")}</li>
          ) : (
            search.data!.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                  onClick={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                >
                  <Thumb src={item.image} className="size-8 rounded-lg" />
                  <span className="truncate">{item.name}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

