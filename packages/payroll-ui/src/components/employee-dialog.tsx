"use client";

import * as React from "react";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  ChipGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
  Textarea,
  toast,
} from "@rbms/ui";
import { describeError, useFeature, useI18n, useMyBranches } from "@rbms/web";
import { PAYROLL_FEATURES } from "../lib/access";
import { isHm, money, paiseToRupees, rupeesToPaise, todayIst, weekdayName } from "../lib/format";
import { useMembers, useSaveEmployee, type EmployeeBody } from "../lib/queries";
import { PAY_TYPES, type Employee, type PayMethod, type PayType } from "../lib/types";
import { InlineError, MethodSelect } from "./bits";

interface AllowanceRow {
  name: string;
  amount: string;
}

const NONE = "__none";

/** Adds or edits a staff record: personal details, pay structure, statutory switches, own shift and how they're paid. */
export function EmployeeDialog({ open, onOpenChange, employee }: { open: boolean; onOpenChange: (o: boolean) => void; employee?: Employee | null }) {
  const { t, locale } = useI18n();
  const save = useSaveEmployee(employee?.id);
  const members = useMembers(open);
  const branchesOn = useFeature(PAYROLL_FEATURES.branches);
  const branches = useMyBranches();

  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [designation, setDesignation] = React.useState("");
  const [joinDate, setJoinDate] = React.useState(todayIst());
  const [leaveDate, setLeaveDate] = React.useState("");
  const [branchId, setBranchId] = React.useState("");
  const [userId, setUserId] = React.useState("");
  const [payType, setPayType] = React.useState<PayType>("monthly");
  const [basic, setBasic] = React.useState("");
  const [da, setDa] = React.useState("");
  const [hra, setHra] = React.useState("");
  const [allowances, setAllowances] = React.useState<AllowanceRow[]>([]);
  const [dailyRate, setDailyRate] = React.useState("");
  const [hourlyRate, setHourlyRate] = React.useState("");
  const [otRate, setOtRate] = React.useState("");
  const [pf, setPf] = React.useState(false);
  const [esi, setEsi] = React.useState(false);
  const [pt, setPt] = React.useState(false);
  const [ownShift, setOwnShift] = React.useState(false);
  const [shiftStart, setShiftStart] = React.useState("09:30");
  const [shiftEnd, setShiftEnd] = React.useState("20:30");
  const [ownOffs, setOwnOffs] = React.useState(false);
  const [weekOffs, setWeekOffs] = React.useState<number[]>([0]);
  const [payMethod, setPayMethod] = React.useState<PayMethod>("cash");
  const [bankName, setBankName] = React.useState("");
  const [accountNumber, setAccountNumber] = React.useState("");
  const [ifsc, setIfsc] = React.useState("");
  const [upiId, setUpiId] = React.useState("");
  const [uan, setUan] = React.useState("");
  const [esiNumber, setEsiNumber] = React.useState("");
  const [pan, setPan] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const e = employee;
    const s = e?.salary;
    setName(e?.name ?? "");
    setPhone(e?.phone ?? "");
    setDesignation(e?.designation ?? "");
    setJoinDate(e?.joinDate ?? todayIst());
    setLeaveDate(e?.leaveDate ?? "");
    setBranchId(e?.branchId ?? "");
    setUserId(e?.userId ?? "");
    setPayType(s?.payType ?? e?.payType ?? "monthly");
    setBasic(paiseToRupees(s?.basic || null));
    setDa(paiseToRupees(s?.da || null));
    setHra(paiseToRupees(s?.hra || null));
    setAllowances((s?.allowances ?? []).map((a) => ({ name: a.name, amount: paiseToRupees(a.amount) })));
    setDailyRate(paiseToRupees(s?.dailyRate || null));
    setHourlyRate(paiseToRupees(s?.hourlyRate || null));
    setOtRate(paiseToRupees(s?.otRatePerHour ?? null));
    setPf(s?.pf ?? false);
    setEsi(s?.esi ?? false);
    setPt(s?.pt ?? false);
    setOwnShift(!!e?.shiftStart);
    setShiftStart(e?.shiftStart ?? "09:30");
    setShiftEnd(e?.shiftEnd ?? "20:30");
    setOwnOffs(!!e?.weekOffs);
    setWeekOffs(e?.weekOffs ?? [0]);
    setPayMethod(e?.payMethod ?? "cash");
    setBankName(e?.bankName ?? "");
    setAccountNumber(e?.accountNumber ?? "");
    setIfsc(e?.ifsc ?? "");
    setUpiId(e?.upiId ?? "");
    setUan(e?.uan ?? "");
    setEsiNumber(e?.esiNumber ?? "");
    setPan(e?.pan ?? "");
    setNotes(e?.notes ?? "");
    setSubmitted(false);
    setError(null);
  }, [open, employee]);

  const amt = (v: string) => (v.trim() ? rupeesToPaise(v) : 0);
  const req = t("payroll.common.required");
  const bad = t("payroll.common.amountInvalid");
  const allowanceBad = allowances.some((a) => !a.name.trim() || amt(a.amount) === null);
  const errors = {
    name: !name.trim() ? req : null,
    joinDate: !joinDate ? req : null,
    leaveDate: leaveDate && leaveDate < joinDate ? t("payroll.people.leaveBeforeJoin") : null,
    basic: payType === "monthly" && (amt(basic) === null || !amt(basic)) ? (amt(basic) === null ? bad : req) : null,
    da: amt(da) === null ? bad : null,
    hra: amt(hra) === null ? bad : null,
    allowances: allowanceBad ? t("payroll.people.allowanceInvalid") : null,
    dailyRate: payType === "daily" && !amt(dailyRate) ? (amt(dailyRate) === null ? bad : req) : null,
    hourlyRate: payType === "hourly" && !amt(hourlyRate) ? (amt(hourlyRate) === null ? bad : req) : null,
    otRate: otRate.trim() && rupeesToPaise(otRate) === null ? bad : null,
    shift: ownShift && (!isHm(shiftStart) || !isHm(shiftEnd)) ? t("payroll.mark.timeInvalid") : null,
    account: payMethod === "bank" && !/^\d{6,20}$/.test(accountNumber.trim()) ? t("payroll.people.accountInvalid") : accountNumber.trim() && !/^\d{6,20}$/.test(accountNumber.trim()) ? t("payroll.people.accountInvalid") : null,
    ifsc: (payMethod === "bank" || ifsc.trim()) && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase()) ? t("payroll.people.ifscInvalid") : null,
    upi: (payMethod === "upi" || upiId.trim()) && !/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(upiId.trim()) ? t("payroll.people.upiInvalid") : null,
    uan: uan.trim() && !/^\d{12}$/.test(uan.trim()) ? t("payroll.people.uanInvalid") : null,
    esiNumber: esiNumber.trim() && !/^\d{10,17}$/.test(esiNumber.trim()) ? t("payroll.people.esiInvalid") : null,
    pan: pan.trim() && !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan.trim().toUpperCase()) ? t("payroll.people.panInvalid") : null,
  };

  const monthly = (amt(basic) ?? 0) + (amt(da) ?? 0) + (amt(hra) ?? 0) + allowances.reduce((s, a) => s + (amt(a.amount) ?? 0), 0);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.values(errors).some(Boolean)) return;
    const body: EmployeeBody = {
      name: name.trim(),
      phone: phone.trim() || null,
      userId: userId || null,
      branchId: branchId || null,
      designation: designation.trim() || null,
      joinDate,
      leaveDate: leaveDate || null,
      salary: {
        payType,
        basic: payType === "monthly" ? (amt(basic) ?? 0) : 0,
        da: payType === "monthly" ? (amt(da) ?? 0) : 0,
        hra: payType === "monthly" ? (amt(hra) ?? 0) : 0,
        allowances: payType === "monthly" ? allowances.map((a) => ({ name: a.name.trim(), amount: amt(a.amount) ?? 0 })) : [],
        dailyRate: payType === "daily" ? (amt(dailyRate) ?? 0) : 0,
        hourlyRate: payType === "hourly" ? (amt(hourlyRate) ?? 0) : 0,
        otRatePerHour: otRate.trim() ? rupeesToPaise(otRate) : null,
        pf,
        esi,
        pt,
      },
      shiftStart: ownShift ? shiftStart : null,
      shiftEnd: ownShift ? shiftEnd : null,
      weekOffs: ownOffs ? weekOffs : null,
      payMethod,
      bankName: bankName.trim() || null,
      accountNumber: accountNumber.trim() || null,
      ifsc: ifsc.trim().toUpperCase() || null,
      upiId: upiId.trim() || null,
      uan: uan.trim() || null,
      esiNumber: esiNumber.trim() || null,
      pan: pan.trim().toUpperCase() || null,
      notes: notes.trim() || null,
    };
    try {
      const r = await save.mutateAsync(body);
      toast.success(employee ? t("payroll.people.saved") : t("payroll.people.added", { code: r.code }));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  const linkable = (members.data?.items ?? []).filter((m) => !m.employeeId || m.employeeId === employee?.id);
  const branchItems = branches.data?.items ?? [];
  const moneyField = (key: keyof typeof errors, label: string, value: string, set: (v: string) => void, hint?: string, optional?: boolean) => (
    <Field invalid={!!err(key)}>
      <FieldLabel optional={optional}>{label}</FieldLabel>
      <FieldControl>
        <Input inputMode="decimal" value={value} placeholder="0" onChange={(e) => set(e.target.value)} />
      </FieldControl>
      {hint && <FieldHint>{hint}</FieldHint>}
      <FieldError>{err(key)}</FieldError>
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("payroll.common.close")} className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{employee ? t("payroll.people.editTitle") : t("payroll.people.add")}</DialogTitle>
            <DialogDescription>{employee ? employee.code : t("payroll.people.addBody")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field invalid={!!err("name")}>
              <FieldLabel>{t("payroll.people.name")}</FieldLabel>
              <FieldControl>
                <Input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              </FieldControl>
              <FieldError>{err("name")}</FieldError>
            </Field>
            <Field>
              <FieldLabel optional>{t("payroll.people.phone")}</FieldLabel>
              <FieldControl>
                <Input inputMode="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel optional>{t("payroll.people.designation")}</FieldLabel>
              <FieldControl>
                <Input value={designation} maxLength={80} placeholder={t("payroll.people.designationPlaceholder")} onChange={(e) => setDesignation(e.target.value)} />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel optional>{t("payroll.people.login")}</FieldLabel>
              <FieldControl>
                <Select value={userId || NONE} onValueChange={(v) => setUserId(v === NONE ? "" : v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("payroll.people.noLogin")}</SelectItem>
                    {linkable.map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.name ?? m.phone ?? m.userId.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldControl>
              <FieldHint>{t("payroll.people.loginHint")}</FieldHint>
            </Field>
            <Field invalid={!!err("joinDate")}>
              <FieldLabel>{t("payroll.people.joinDate")}</FieldLabel>
              <FieldControl>
                <Input type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} />
              </FieldControl>
              <FieldError>{err("joinDate")}</FieldError>
            </Field>
            <Field invalid={!!err("leaveDate")}>
              <FieldLabel optional>{t("payroll.people.leaveDate")}</FieldLabel>
              <FieldControl>
                <Input type="date" value={leaveDate} min={joinDate} onChange={(e) => setLeaveDate(e.target.value)} />
              </FieldControl>
              <FieldHint>{t("payroll.people.leaveDateHint")}</FieldHint>
              <FieldError>{err("leaveDate")}</FieldError>
            </Field>
            {branchesOn && branchItems.length > 1 && (
              <Field>
                <FieldLabel optional>{t("payroll.common.branch")}</FieldLabel>
                <FieldControl>
                  <Select value={branchId || NONE} onValueChange={(v) => setBranchId(v === NONE ? "" : v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("payroll.common.allBranches")}</SelectItem>
                      {branchItems.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldControl>
              </Field>
            )}
          </div>

          <Separator />
          <section className="grid gap-4">
            <h3 className="text-sm font-semibold">{t("payroll.people.paySection")}</h3>
            <ChipGroup size="sm" aria-label={t("payroll.people.payType")} value={payType} onChange={(v) => setPayType(v as PayType)} options={PAY_TYPES.map((p) => ({ value: p, label: t(`payroll.payType.${p}`) }))} />
            {payType === "monthly" && (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  {moneyField("basic", t("payroll.people.basic"), basic, setBasic)}
                  {moneyField("da", t("payroll.people.da"), da, setDa, undefined, true)}
                  {moneyField("hra", t("payroll.people.hra"), hra, setHra, undefined, true)}
                </div>
                <div className="grid gap-2">
                  <Label>{t("payroll.people.allowances")}</Label>
                  {allowances.map((a, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        aria-label={t("payroll.people.allowanceName")}
                        placeholder={t("payroll.people.allowanceName")}
                        value={a.name}
                        maxLength={60}
                        onChange={(e) => setAllowances((xs) => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      />
                      <Input
                        aria-label={t("payroll.people.allowanceAmount")}
                        className="w-36"
                        inputMode="decimal"
                        placeholder="0"
                        value={a.amount}
                        onChange={(e) => setAllowances((xs) => xs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                      />
                      <Button type="button" size="icon" variant="ghost" aria-label={t("payroll.common.delete")} onClick={() => setAllowances((xs) => xs.filter((_, j) => j !== i))}>
                        <Trash2Icon />
                      </Button>
                    </div>
                  ))}
                  {submitted && errors.allowances && <p className="text-sm text-destructive">{errors.allowances}</p>}
                  <Button type="button" size="sm" variant="outline" className="justify-self-start" disabled={allowances.length >= 12} onClick={() => setAllowances((xs) => [...xs, { name: "", amount: "" }])}>
                    <PlusIcon /> {t("payroll.people.addAllowance")}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">{t("payroll.people.monthlyTotal", { amount: money(monthly) })}</p>
              </>
            )}
            {payType === "daily" && <div className="grid gap-4 sm:grid-cols-3">{moneyField("dailyRate", t("payroll.people.dailyRate"), dailyRate, setDailyRate)}</div>}
            {payType === "hourly" && <div className="grid gap-4 sm:grid-cols-3">{moneyField("hourlyRate", t("payroll.people.hourlyRate"), hourlyRate, setHourlyRate)}</div>}
            <div className="grid gap-4 sm:grid-cols-3">{moneyField("otRate", t("payroll.people.otRate"), otRate, setOtRate, t("payroll.people.otRateHint"), true)}</div>
            <div className="flex flex-wrap gap-6">
              <Label className="flex items-center gap-2 font-normal">
                <Switch checked={pf} onCheckedChange={setPf} /> {t("payroll.people.pf")}
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <Switch checked={esi} onCheckedChange={setEsi} /> {t("payroll.people.esi")}
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <Switch checked={pt} onCheckedChange={setPt} /> {t("payroll.people.pt")}
              </Label>
            </div>
            <p className="text-meta text-muted-foreground">{t("payroll.people.statutoryHint")}</p>
          </section>

          <Separator />
          <section className="grid gap-4">
            <h3 className="text-sm font-semibold">{t("payroll.people.shiftSection")}</h3>
            <Label className="flex items-center gap-2 font-normal">
              <Switch checked={ownShift} onCheckedChange={setOwnShift} /> {t("payroll.people.ownShift")}
            </Label>
            {ownShift && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field invalid={!!err("shift")}>
                  <FieldLabel>{t("payroll.settings.shiftStart")}</FieldLabel>
                  <FieldControl>
                    <Input type="time" className="min-w-32" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} />
                  </FieldControl>
                  <FieldError>{err("shift")}</FieldError>
                </Field>
                <Field>
                  <FieldLabel>{t("payroll.settings.shiftEnd")}</FieldLabel>
                  <FieldControl>
                    <Input type="time" className="min-w-32" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} />
                  </FieldControl>
                </Field>
              </div>
            )}
            <Label className="flex items-center gap-2 font-normal">
              <Switch checked={ownOffs} onCheckedChange={setOwnOffs} /> {t("payroll.people.ownOffs")}
            </Label>
            {ownOffs && <WeekdayPicker value={weekOffs} onChange={setWeekOffs} locale={locale} />}
          </section>

          <Separator />
          <section className="grid gap-4">
            <h3 className="text-sm font-semibold">{t("payroll.people.paidSection")}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>{t("payroll.people.payMethod")}</FieldLabel>
                <FieldControl>
                  <MethodSelect value={payMethod} onChange={(m) => m && setPayMethod(m)} />
                </FieldControl>
              </Field>
              {payMethod === "upi" && (
                <Field invalid={!!err("upi")}>
                  <FieldLabel>{t("payroll.people.upiId")}</FieldLabel>
                  <FieldControl>
                    <Input value={upiId} maxLength={100} placeholder="name@bank" onChange={(e) => setUpiId(e.target.value)} />
                  </FieldControl>
                  <FieldError>{err("upi")}</FieldError>
                </Field>
              )}
            </div>
            {payMethod === "bank" && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel optional>{t("payroll.people.bankName")}</FieldLabel>
                  <FieldControl>
                    <Input value={bankName} maxLength={80} onChange={(e) => setBankName(e.target.value)} />
                  </FieldControl>
                </Field>
                <Field invalid={!!err("account")}>
                  <FieldLabel>{t("payroll.people.account")}</FieldLabel>
                  <FieldControl>
                    <Input inputMode="numeric" value={accountNumber} maxLength={20} onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))} />
                  </FieldControl>
                  <FieldError>{err("account")}</FieldError>
                </Field>
                <Field invalid={!!err("ifsc")}>
                  <FieldLabel>{t("payroll.people.ifsc")}</FieldLabel>
                  <FieldControl>
                    <Input value={ifsc} maxLength={11} placeholder="SBIN0001234" onChange={(e) => setIfsc(e.target.value.toUpperCase())} />
                  </FieldControl>
                  <FieldError>{err("ifsc")}</FieldError>
                </Field>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field invalid={!!err("uan")}>
                <FieldLabel optional>{t("payroll.people.uan")}</FieldLabel>
                <FieldControl>
                  <Input inputMode="numeric" value={uan} maxLength={12} onChange={(e) => setUan(e.target.value.replace(/\D/g, ""))} />
                </FieldControl>
                <FieldError>{err("uan")}</FieldError>
              </Field>
              <Field invalid={!!err("esiNumber")}>
                <FieldLabel optional>{t("payroll.people.esiNumber")}</FieldLabel>
                <FieldControl>
                  <Input inputMode="numeric" value={esiNumber} maxLength={17} onChange={(e) => setEsiNumber(e.target.value.replace(/\D/g, ""))} />
                </FieldControl>
                <FieldError>{err("esiNumber")}</FieldError>
              </Field>
              <Field invalid={!!err("pan")}>
                <FieldLabel optional>{t("payroll.people.pan")}</FieldLabel>
                <FieldControl>
                  <Input value={pan} maxLength={10} onChange={(e) => setPan(e.target.value.toUpperCase())} />
                </FieldControl>
                <FieldError>{err("pan")}</FieldError>
              </Field>
            </div>
            <Field>
              <FieldLabel optional>{t("payroll.people.notes")}</FieldLabel>
              <FieldControl>
                <Textarea value={notes} maxLength={1000} rows={2} onChange={(e) => setNotes(e.target.value)} />
              </FieldControl>
            </Field>
          </section>

          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {t("payroll.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Toggle chips for the days of the week (0 = Sunday). */
export function WeekdayPicker({ value, onChange, locale }: { value: number[]; onChange: (v: number[]) => void; locale: string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {[1, 2, 3, 4, 5, 6, 0].map((d) => {
        const on = value.includes(d);
        return (
          <Button
            key={d}
            type="button"
            size="sm"
            variant={on ? "default" : "outline"}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort())}
          >
            {weekdayName(d, locale)}
          </Button>
        );
      })}
    </div>
  );
}
