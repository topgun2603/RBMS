"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BanIcon, CheckCircle2Icon, FileTextIcon, ImagePlusIcon, InfoIcon, Loader2Icon, ScanLineIcon, WalletIcon, XIcon } from "lucide-react";
import { isValidGstin } from "@rbms/gst";
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
} from "@rbms/ui";
import {
  AiDraftBanner,
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
  sendAiFeedback,
  useCurrentBranch,
  useI18n,
  useMyBranches,
  type AiOutcome,
} from "@rbms/web";
import { SupplierPicker, type SupplierParty } from "../inventory/supplier-picker";
import { PaySupplierDialog } from "../inventory/payables-dialogs";
import type { Supplier } from "../../lib/types";
import { ScanDialog } from "../ai/scan-dialog";
import { ScanFlags, aiLowClass } from "../ai/scan-bits";
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
  useRecordExpense,
  useSaveExpense,
  type Expense,
  type ExpensePaymentMethod,
} from "../../lib/expenses";
import type { ReceiptDraft, ScanResult } from "../../lib/ai-scan";

/** Branch picker value for "no branch" (the API's null). */
const SHOP_WIDE = "shop-wide";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "billing.validation.required"),
  categoryId: z.string(),
  amount: z.string().refine((v) => (rupeesToPaise(v) ?? 0) > 0, "billing.validation.amount"),
  /** "" = no branch choice (single-branch shops: the server's default). */
  branch: z.string(),
  dueDate: z.string(),
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

const toValues = (e: Expense | null, categoryId: string, branch = ""): Values => ({
  date: e?.date ?? todayIST(),
  categoryId: e?.categoryId ?? categoryId,
  // A draft with no amount yet (ask each time) opens empty.
  amount: e && e.amount > 0 ? paiseToInput(e.amount) : "",
  branch: e ? (e.branchId ?? SHOP_WIDE) : branch,
  dueDate: e?.dueDate ?? "",
  gstRate: String(e?.gstRate ?? 0),
  vendorName: e?.vendorName ?? "",
  vendorGstin: e?.vendorGstin ?? "",
  paymentMethod: e?.paymentMethod ?? "cash",
  reference: e?.reference ?? "",
  note: e?.note ?? "",
  receiptUrl: e?.receiptUrl ?? "",
});

/** Same values give the same text whatever the key order (form values vs parsed values). */
const stable = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, String(o[k] ?? "").trim()]));

const isPdf = (url: string) => /\.pdf($|\?)/i.test(url);

/** The supplier picker's value for an expense (the expense keeps the supplier's name as the vendor). */
const partyOf = (e: Expense | null): SupplierParty =>
  e?.supplierId
    ? { kind: "saved", supplier: { id: e.supplierId, name: e.vendorName ?? "", gstin: e.vendorGstin, phone: null, email: null, address: null, stateCode: null, payable: 0, createdAt: e.createdAt } satisfies Supplier }
    : { kind: "none" };

/**
 * Add or edit an expense: amount incl. GST with the GST and ITC worked out live, supplier (bought on credit = a bill in
 * Payables), branch, receipt photo, cancel. A draft from a recurring expense is filled in and recorded here.
 */
export function ExpenseDialog({ open, onOpenChange, expense }: { open: boolean; onOpenChange: (o: boolean) => void; expense: Expense | null }) {
  const { t } = useI18n();
  const categories = useExpenseCategories(open);
  const save = useSaveExpense();
  const record = useRecordExpense();
  const cancel = useCancelExpense();
  const branches = useMyBranches();
  const current = useCurrentBranch();
  const branchList = branches.data?.items ?? [];
  const defaultBranch = branchList.length ? (current?.id ?? SHOP_WIDE) : "";
  const [party, setParty] = React.useState<SupplierParty>(() => partyOf(expense));
  const [payOpen, setPayOpen] = React.useState(false);
  const [partyError, setPartyError] = React.useState(false);
  const isDraft = expense?.status === "draft";
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [uploadPct, setUploadPct] = React.useState<number | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const fallbackCategory = categories.data?.find((c) => c.builtin && c.name === "Other")?.id ?? categories.data?.[0]?.id ?? "";
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(expense, fallbackCategory, defaultBranch) });
  const readOnly = expense?.status === "cancelled";
  // AI scan of a receipt: fills this form as a draft; the person saves it as usual.
  const [scanOpen, setScanOpen] = React.useState(false);
  const [ai, setAi] = React.useState<{ runId: string; credits: number; mock: boolean; draft: ReceiptDraft; low: string[]; snapshot: string; outcome: AiOutcome | null } | null>(null);
  const [scanFile, setScanFile] = React.useState<File | null>(null);
  const LOW_FIELD: Record<string, string> = { vendor: "vendorName", category: "categoryId", paymentMode: "paymentMethod" };
  const isLow = (name: string) => !!ai?.low.some((f) => (LOW_FIELD[f] ?? f) === name);

  React.useEffect(() => {
    if (open) {
      form.reset(toValues(expense, fallbackCategory, defaultBranch));
      setParty(partyOf(expense));
      setPartyError(false);
      setUploadPct(null);
      setAi(null);
      setScanFile(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when (re)opened
  }, [open, expense?.id]);
  React.useEffect(() => {
    if (open && !form.getValues("categoryId") && fallbackCategory) form.setValue("categoryId", fallbackCategory);
  }, [open, fallbackCategory, form]);
  // The branches load after the dialog opens: a new expense takes the user's current branch.
  React.useEffect(() => {
    if (open && !expense && !form.getValues("branch") && defaultBranch) form.setValue("branch", defaultBranch);
  }, [open, expense, defaultBranch, form]);

  /** A saved supplier fills the vendor fields; "use once" just types the vendor in. */
  const pickParty = (p: SupplierParty) => {
    setPartyError(false);
    if (p.kind === "oneoff") {
      form.setValue("vendorName", p.name, { shouldDirty: true });
      setParty({ kind: "none" });
      return;
    }
    setParty(p);
    if (p.kind === "saved") {
      form.setValue("vendorName", p.supplier.name, { shouldDirty: true });
      if (p.supplier.gstin) form.setValue("vendorGstin", p.supplier.gstin, { shouldDirty: true });
    }
  };

  React.useEffect(() => {
    const sub = form.watch((_v, { name }) => {
      if (name) setAi((a) => (a && a.low.length ? { ...a, low: a.low.filter((f) => (LOW_FIELD[f] ?? f) !== name) } : a));
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- LOW_FIELD is a constant
  }, [form]);

  const applyScan = (res: ScanResult<ReceiptDraft>, files: File[]) => {
    const d = res.draft;
    const base = toValues(null, fallbackCategory);
    form.reset({
      ...base,
      date: d.date ?? base.date,
      categoryId: d.categoryId ?? base.categoryId,
      amount: d.amount === null ? "" : paiseToInput(d.amount),
      gstRate: String(d.gstRate ?? 0),
      vendorName: d.vendor ?? "",
      vendorGstin: d.vendorGstin ?? "",
      paymentMethod: d.paymentMode ?? "cash",
      note: d.note ?? "",
    });
    setScanFile(files[0] ?? null);
    setAi({ runId: res.runId, credits: res.credits, mock: res.provider === "mock", draft: d, low: d.lowFields, snapshot: stable(form.getValues()), outcome: null });
    toast.success(t("billing.ai.receipt.filled"));
  };
  const reportOutcome = (outcome: AiOutcome) => {
    setAi((a) => (a ? { ...a, outcome: a.outcome ?? outcome } : a));
    if (outcome === "rejected") {
      form.reset(toValues(null, fallbackCategory));
      setAi(null);
      setScanFile(null);
    }
  };

  const [amountText, rateText, gstinText, receiptUrl, method] = form.watch(["amount", "gstRate", "vendorGstin", "receiptUrl", "paymentMethod"]);
  const onCredit = method === "credit";
  const paidOnIt = (expense?.amountPaid ?? 0) > 0;
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
    const supplierId = party.kind === "saved" ? party.supplier.id : null;
    if (v.paymentMethod === "credit" && !supplierId) {
      setPartyError(true);
      toast.error(t("billing.expenses.b.creditNeedsSupplier"));
      return;
    }
    const body = {
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
      // Unchanged supplier and method are left out of an edit (a paid credit expense keeps both).
      ...(!paidOnIt ? { supplierId } : {}),
      ...(v.branch ? { branchId: v.branch === SHOP_WIDE ? null : v.branch } : {}),
      dueDate: v.paymentMethod === "credit" && v.dueDate ? v.dueDate : null,
    };
    try {
      if (isDraft && expense) await record.mutateAsync({ id: expense.id, body });
      else await save.mutateAsync({ id: expense?.id, body });
      if (ai && !ai.outcome) void sendAiFeedback(ai.runId, stable(v) === ai.snapshot ? "accepted" : "edited").catch(() => undefined);
      toast.success(
        isDraft ? t("billing.expenses.b.recorded") : expense ? t("billing.expenses.updated") : t("billing.expenses.created", { amount: money(rupeesToPaise(v.amount)) }),
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  });

  const busy = save.isPending || record.isPending || uploadPct !== null;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl" closeLabel={t("billing.common.close")}>
          <DialogHeader>
            <DialogTitle>{expense ? t("billing.expenses.editTitle") : t("billing.expenses.addTitle")}</DialogTitle>
            <DialogDescription>
              {readOnly ? t("billing.expenses.cancelledHint") : isDraft ? t("billing.expenses.b.draftHint") : t("billing.expenses.dialogHint")}
            </DialogDescription>
          </DialogHeader>
          {!expense && (
            ai ? (
              <div className="grid gap-3" data-testid="ai-receipt-draft">
                <AiDraftBanner runId={ai.runId} credits={ai.credits} mock={ai.mock} onOutcome={reportOutcome} />
                <ScanFlags flags={ai.draft.flags} />
                {scanFile && !receiptUrl && (
                  <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={uploadPct !== null} onClick={() => void onReceipt(scanFile)} data-testid="attach-scan">
                    <ImagePlusIcon /> {t("billing.ai.receipt.attach")}
                  </Button>
                )}
              </div>
            ) : (
              <Button type="button" variant="outline" className="h-11 justify-self-start" onClick={() => setScanOpen(true)} data-testid="scan-receipt">
                <ScanLineIcon /> {t("billing.ai.receipt.button")}
              </Button>
            )
          )}
          <Form {...form}>
            <form onSubmit={onSubmit} className="grid gap-5" noValidate>
              <fieldset disabled={readOnly} className="grid gap-4">
                <div className="grid items-start gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem className={aiLowClass(isLow("amount"))}>
                        <FormLabel>{t("billing.expenses.amount")}</FormLabel>
                        <FormControl>
                          <MoneyInput autoFocus className="text-lg font-semibold" placeholder="0" {...field} />
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
                      <FormItem className={aiLowClass(isLow("date"))}>
                        <FormLabel>{t("billing.expenses.date")}</FormLabel>
                        <FormControl>
                          <Input type="date" max={todayIST()} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid items-start gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="categoryId"
                    render={({ field }) => (
                      <FormItem className={aiLowClass(isLow("categoryId"))}>
                        <FormLabel>{t("billing.expenses.category")}</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="w-full" aria-label={t("billing.expenses.category")}>
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
                      <FormItem className={aiLowClass(isLow("gstRate"))}>
                        <FormLabel>{t("billing.expenses.gstRate")}</FormLabel>
                        <GstRateSelect value={field.value} onChange={field.onChange} className="w-full" aria-label={t("billing.expenses.gstRate")} />
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

                <div className="grid gap-2">
                  <span className="text-sm leading-none font-medium">
                    {t("billing.expenses.b.supplier")}
                    {!onCredit && <span className="font-normal text-muted-foreground"> ({t("billing.common.optional")})</span>}
                  </span>
                  {paidOnIt ? (
                    <p className="rounded-xl border bg-muted/30 px-3 py-2.5 text-sm">{expense?.vendorName}</p>
                  ) : (
                    <SupplierPicker value={party} onChange={pickParty} invalid={partyError} />
                  )}
                  <p className="text-meta text-muted-foreground">{t("billing.expenses.b.supplierHint")}</p>
                </div>

                <div className="grid items-start gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="vendorName"
                    render={({ field }) => (
                      <FormItem className={aiLowClass(isLow("vendorName"))}>
                        <FormLabel>{t("billing.expenses.vendor")}</FormLabel>
                        <FormControl>
                          <Input autoComplete="off" placeholder={t("billing.expenses.vendorPlaceholder")} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="vendorGstin"
                    render={({ field }) => (
                      <FormItem className={aiLowClass(isLow("vendorGstin"))}>
                        <FormLabel>{t("billing.expenses.vendorGstin")}</FormLabel>
                        <div className="relative">
                          <FormControl>
                            <Input
                              className="pr-9 font-mono uppercase"
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
                    <FormItem className={aiLowClass(isLow("paymentMethod"))}>
                      <FormLabel>{t("billing.expenses.method")}</FormLabel>
                      <ChipGroup
                        aria-label={t("billing.expenses.method")}
                        value={field.value}
                        onChange={(v) => !paidOnIt && field.onChange(v as ExpensePaymentMethod)}
                        options={EXPENSE_PAYMENT_METHODS.map((m) => ({ value: m, label: m === "credit" ? t("billing.expenses.b.onCredit") : t(`billing.payment.methods.${m}`) }))}
                      />
                      {onCredit && <FormDescription>{t("billing.expenses.b.onCreditHint")}</FormDescription>}
                    </FormItem>
                  )}
                />

                {(onCredit || branchList.length > 0) && (
                  <div className="grid items-start gap-4 sm:grid-cols-2">
                    {onCredit && (
                      <FormField
                        control={form.control}
                        name="dueDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              {t("billing.expenses.b.dueDate")} <span className="font-normal text-muted-foreground">({t("billing.common.optional")})</span>
                            </FormLabel>
                            <FormControl>
                              <Input type="date" min={form.getValues("date") || undefined} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    {branchList.length > 0 && (
                      <FormField
                        control={form.control}
                        name="branch"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("billing.expenses.b.branch")}</FormLabel>
                            <Select value={field.value || SHOP_WIDE} onValueChange={field.onChange}>
                              <SelectTrigger className="w-full" aria-label={t("billing.expenses.b.branch")}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={SHOP_WIDE}>{t("billing.expenses.b.shopWide")}</SelectItem>
                                {branchList.map((b) => (
                                  <SelectItem key={b.id} value={b.id}>
                                    {b.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                )}

                {expense && expense.paymentMethod === "credit" && expense.status === "recorded" && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 px-3 py-2.5 text-sm" aria-live="polite">
                    <span className="grid">
                      <span className="text-xs text-muted-foreground">{t("billing.expenses.b.paidSoFar")}</span>
                      <span className="font-semibold tabular-nums">{money(expense.amountPaid)}</span>
                    </span>
                    <span className="grid">
                      <span className="text-xs text-muted-foreground">{t("billing.expenses.b.balance")}</span>
                      <span className={cn("font-semibold tabular-nums", expense.balance > 0 ? "text-warning-ink" : "text-success-ink")}>{money(expense.balance)}</span>
                    </span>
                    {expense.balance > 0 && expense.supplierId ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => setPayOpen(true)}>
                        <WalletIcon /> {t("billing.expenses.b.paySupplier")}
                      </Button>
                    ) : expense.supplierId ? (
                      <ModuleLink to={`suppliers/${expense.supplierId}`} className="text-sm text-primary underline-offset-4 hover:underline">
                        {t("billing.expenses.b.openStatement")}
                      </ModuleLink>
                    ) : null}
                  </div>
                )}

                <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <FormField
                    control={form.control}
                    name="note"
                    render={({ field }) => (
                      <FormItem className={aiLowClass(isLow("note"))}>
                        <FormLabel>{t("billing.expenses.note")}</FormLabel>
                        <FormControl>
                          <Textarea rows={3} placeholder={t("billing.expenses.notePlaceholder")} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid content-start gap-2">
                    <span className="flex min-h-5 items-end text-sm leading-none font-medium">{t("billing.expenses.receipt")}</span>
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
                        <Input autoComplete="off" placeholder={t("billing.expenses.referencePlaceholder")} {...field} />
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
                      {(save.isPending || record.isPending) && <Loader2Icon className="animate-spin" />}
                      {isDraft ? t("billing.expenses.b.record") : t("billing.common.save")}
                    </Button>
                  )}
                </div>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      <ScanDialog kind="receipt" open={scanOpen} onOpenChange={setScanOpen} onDraft={applyScan} />
      <PaySupplierDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        supplier={expense?.supplierId ? { id: expense.supplierId, name: expense.vendorName ?? "", payable: expense.balance } : null}
        expenseId={expense?.id}
      />
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
