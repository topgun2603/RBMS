"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BanIcon, CheckCircle2Icon, FileTextIcon, ImagePlusIcon, InfoIcon, Loader2Icon, XIcon } from "lucide-react";
import { isValidGstin } from "@srirealtime/gst";
import {
  Button,
  ChipGroup,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
  useI18n,
} from "@srirealtime/web";
import { GstRateSelect } from "../gst-rate-select";
import { MoneyInput } from "../money-input";
import { money, paiseToInput, rupeesToPaise, todayIST } from "../../lib/format";
import {
  EXPENSE_PAYMENT_METHODS,
  gstFromInclusive,
  itcFor,
  uploadReceipt,
  useCancelExpense,
  useExpenseCategories,
  useSaveExpense,
  type Expense,
  type ExpensePaymentMethod,
} from "../../lib/expenses";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "billing.validation.required"),
  categoryId: z.string(),
  amount: z.string().refine((v) => (rupeesToPaise(v) ?? 0) > 0, "billing.validation.amount"),
  gstRate: z.string(),
  vendorName: z.string().trim().max(200),
  vendorGstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || isValidGstin(v), "billing.validation.gstin"),
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS),
  reference: z.string().trim().max(100),
  note: z.string().trim().max(1000),
  receiptUrl: z.string(),
});
type Values = z.infer<typeof schema>;

const toValues = (e: Expense | null, categoryId: string): Values => ({
  date: e?.date ?? todayIST(),
  categoryId: e?.categoryId ?? categoryId,
  amount: e ? paiseToInput(e.amount) : "",
  gstRate: String(e?.gstRate ?? 0),
  vendorName: e?.vendorName ?? "",
  vendorGstin: e?.vendorGstin ?? "",
  paymentMethod: e?.paymentMethod ?? "cash",
  reference: e?.reference ?? "",
  note: e?.note ?? "",
  receiptUrl: e?.receiptUrl ?? "",
});

const isPdf = (url: string) => /\.pdf($|\?)/i.test(url);

/** Add or edit an expense: amount incl. GST with the GST and ITC worked out live, receipt photo, cancel. */
export function ExpenseDialog({ open, onOpenChange, expense }: { open: boolean; onOpenChange: (o: boolean) => void; expense: Expense | null }) {
  const { t } = useI18n();
  const categories = useExpenseCategories(open);
  const save = useSaveExpense();
  const cancel = useCancelExpense();
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [uploadPct, setUploadPct] = React.useState<number | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const fallbackCategory = categories.data?.find((c) => c.builtin && c.name === "Other")?.id ?? categories.data?.[0]?.id ?? "";
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(expense, fallbackCategory) });
  const readOnly = expense?.status === "cancelled";

  React.useEffect(() => {
    if (open) {
      form.reset(toValues(expense, fallbackCategory));
      setUploadPct(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when (re)opened
  }, [open, expense?.id]);
  React.useEffect(() => {
    if (open && !form.getValues("categoryId") && fallbackCategory) form.setValue("categoryId", fallbackCategory);
  }, [open, fallbackCategory, form]);

  const [amountText, rateText, gstinText, receiptUrl] = form.watch(["amount", "gstRate", "vendorGstin", "receiptUrl"]);
  const amount = rupeesToPaise(amountText) ?? 0;
  const gst = gstFromInclusive(amount, Number(rateText) || 0);
  const gstinOk = isValidGstin(gstinText.trim().toUpperCase());
  const itc = itcFor(gst, gstinText.trim().toUpperCase());

  const onReceipt = async (file: File) => {
    if (!/^image\/|application\/pdf/.test(file.type)) {
      toast.error(t("billing.expenses.receiptType"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("billing.expenses.receiptTooBig"));
      return;
    }
    setUploadPct(0);
    try {
      const url = await uploadReceipt(file, setUploadPct);
      form.setValue("receiptUrl", url, { shouldDirty: true });
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setUploadPct(null);
    }
  };

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        id: expense?.id,
        body: {
          date: v.date,
          categoryId: v.categoryId || undefined,
          amount: rupeesToPaise(v.amount) ?? 0,
          gstRate: Number(v.gstRate) || 0,
          vendorName: v.vendorName || null,
          vendorGstin: v.vendorGstin || null,
          paymentMethod: v.paymentMethod,
          reference: v.reference || null,
          note: v.note || null,
          receiptUrl: v.receiptUrl || null,
        },
      });
      toast.success(expense ? t("billing.expenses.updated") : t("billing.expenses.created", { amount: money(rupeesToPaise(v.amount)) }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  });

  const busy = save.isPending || uploadPct !== null;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl" closeLabel={t("billing.common.close")}>
          <DialogHeader>
            <DialogTitle>{expense ? t("billing.expenses.editTitle") : t("billing.expenses.addTitle")}</DialogTitle>
            <DialogDescription>{readOnly ? t("billing.expenses.cancelledHint") : t("billing.expenses.dialogHint")}</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={onSubmit} className="grid gap-4" noValidate>
              <fieldset disabled={readOnly} className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("billing.expenses.amount")}</FormLabel>
                        <FormControl>
                          <MoneyInput autoFocus className="h-11 text-lg font-semibold" placeholder="0" {...field} />
                        </FormControl>
                        <FormDescription>{t("billing.expenses.amountHint")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("billing.expenses.date")}</FormLabel>
                        <FormControl>
                          <Input type="date" className="h-11" max={todayIST()} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="categoryId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("billing.expenses.category")}</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="h-11 w-full" aria-label={t("billing.expenses.category")}>
                            <SelectValue placeholder={t("billing.expenses.pickCategory")} />
                          </SelectTrigger>
                          <SelectContent>
                            {(categories.data ?? []).map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {categoryLabel(t, c)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="gstRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("billing.expenses.gstRate")}</FormLabel>
                        <GstRateSelect value={field.value} onChange={field.onChange} className="h-11 w-full" aria-label={t("billing.expenses.gstRate")} />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {gst > 0 && (
                  <div className="grid grid-cols-3 gap-2 rounded-xl border bg-muted/30 px-3 py-2.5 text-sm" aria-live="polite">
                    <span className="grid">
                      <span className="text-xs text-muted-foreground">{t("billing.expenses.taxable")}</span>
                      <span className="font-semibold tabular-nums">{money(amount - gst)}</span>
                    </span>
                    <span className="grid">
                      <span className="text-xs text-muted-foreground">{t("billing.expenses.gst")}</span>
                      <span className="font-semibold tabular-nums">{money(gst)}</span>
                    </span>
                    <span className="grid">
                      <span className="text-xs text-muted-foreground">{t("billing.expenses.itc")}</span>
                      <span className={cn("font-semibold tabular-nums", itc > 0 ? "text-success-ink" : "text-muted-foreground")}>{money(itc)}</span>
                    </span>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="vendorName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("billing.expenses.vendor")}</FormLabel>
                        <FormControl>
                          <Input className="h-11" autoComplete="off" placeholder={t("billing.expenses.vendorPlaceholder")} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="vendorGstin"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("billing.expenses.vendorGstin")}</FormLabel>
                        <div className="relative">
                          <FormControl>
                            <Input
                              className="h-11 pr-9 font-mono uppercase"
                              autoComplete="off"
                              autoCapitalize="characters"
                              spellCheck={false}
                              maxLength={15}
                              placeholder="33ABCDE1234F1Z5"
                              {...field}
                              onChange={(e) => field.onChange(e.target.value.toUpperCase().replace(/\s/g, ""))}
                            />
                          </FormControl>
                          {gstinOk && (
                            <CheckCircle2Icon className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-success-ink" aria-label={t("billing.customers.gstinValid")} />
                          )}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                {gst > 0 && !gstinOk && (
                  <p className="-mt-2 flex items-start gap-1.5 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-ink">
                    <InfoIcon className="mt-px size-3.5 shrink-0" /> {t("billing.expenses.noItcHint")}
                  </p>
                )}

                <FormField
                  control={form.control}
                  name="paymentMethod"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("billing.expenses.method")}</FormLabel>
                      <ChipGroup
                        aria-label={t("billing.expenses.method")}
                        value={field.value}
                        onChange={(v) => field.onChange(v as ExpensePaymentMethod)}
                        options={EXPENSE_PAYMENT_METHODS.map((m) => ({ value: m, label: t(`billing.payment.methods.${m}`) }))}
                      />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <FormField
                    control={form.control}
                    name="note"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("billing.expenses.note")}</FormLabel>
                        <FormControl>
                          <Textarea rows={3} placeholder={t("billing.expenses.notePlaceholder")} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid content-start gap-2">
                    <span className="text-sm font-medium">{t("billing.expenses.receipt")}</span>
                    {receiptUrl ? (
                      <div className="relative">
                        <a href={receiptUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border">
                          {isPdf(receiptUrl) ? (
                            <span className="flex h-24 items-center justify-center bg-muted text-muted-foreground">
                              <FileTextIcon className="size-8" />
                            </span>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element -- UI modules don't use next/image
                            <img src={receiptUrl} alt={t("billing.expenses.receipt")} className="h-24 w-full object-cover" />
                          )}
                        </a>
                        {!readOnly && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon-sm"
                            className="absolute top-1 right-1 rounded-full"
                            aria-label={t("billing.expenses.removeReceipt")}
                            onClick={() => form.setValue("receiptUrl", "", { shouldDirty: true })}
                          >
                            <XIcon />
                          </Button>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        disabled={uploadPct !== null || readOnly}
                        className="flex h-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-xs text-muted-foreground outline-none hover:border-primary/50 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                      >
                        {uploadPct !== null ? <Loader2Icon className="size-5 animate-spin" /> : <ImagePlusIcon className="size-5" />}
                        {uploadPct !== null ? `${uploadPct}%` : t("billing.expenses.addReceipt")}
                      </button>
                    )}
                    {uploadPct !== null && <Progress value={uploadPct} className="h-1.5" aria-label={t("billing.expenses.uploading")} />}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*,application/pdf"
                      capture="environment"
                      className="sr-only"
                      tabIndex={-1}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void onReceipt(f);
                        e.target.value = "";
                      }}
                    />
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="reference"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("billing.expenses.reference")}</FormLabel>
                      <FormControl>
                        <Input className="h-11" autoComplete="off" placeholder={t("billing.expenses.referencePlaceholder")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </fieldset>

              <DialogFooter className="gap-2 sm:justify-between">
                {expense && !readOnly ? (
                  <Button type="button" variant="ghost" size="lg" className="text-danger-ink" onClick={() => setConfirmCancel(true)} disabled={busy}>
                    <BanIcon /> {t("billing.expenses.cancelExpense")}
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={busy}>
                    {readOnly ? t("billing.common.close") : t("billing.common.cancel")}
                  </Button>
                  {!readOnly && (
                    <Button type="submit" size="lg" disabled={busy}>
                      {save.isPending && <Loader2Icon className="animate-spin" />}
                      {t("billing.common.save")}
                    </Button>
                  )}
                </div>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t("billing.expenses.cancelTitle")}
        description={t("billing.expenses.cancelBody")}
        confirmLabel={t("billing.expenses.cancelExpense")}
        onConfirm={async () => {
          if (!expense) return;
          try {
            await cancel.mutateAsync(expense.id);
            toast.success(t("billing.expenses.cancelled"));
            onOpenChange(false);
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </>
  );
}

/** Built-in category names are translated; the owner's own names show as typed. */
export function categoryLabel(t: ReturnType<typeof useI18n>["t"], c: { name: string; builtin?: boolean }): string {
  const key = `billing.expenses.categories.${c.name.toLowerCase()}`;
  return c.builtin !== false && t.has(key) ? t(key) : c.name;
}
