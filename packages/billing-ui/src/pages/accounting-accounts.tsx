"use client";

import * as React from "react";
import { ListTreeIcon, PlusIcon, SearchIcon } from "lucide-react";
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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
} from "@rbms/ui";
import { ConfirmDialog, describeError, ModuleLink, QueryError, useI18n } from "@rbms/web";
import { AccountingPage, Balance, Panel, TableSkeleton } from "../components/accounting/parts";
import { MoneyInput } from "../components/money-input";
import { ACCOUNT_GROUPS, ACCOUNT_TYPES, ACC_POST, useAccounts, useDeleteAccount, useSaveAccount, type Account, type AccountType } from "../lib/accounting";
import { useHasPermission } from "../lib/access";
import { paiseToInput, rupeesToPaise } from "../lib/format";

type Side = "dr" | "cr";

/** Chart of accounts: every account with its balance, grouped the way the reports are. */
export default function AccountingAccountsPage() {
  const { t } = useI18n();
  const canPost = useHasPermission(ACC_POST);
  const accounts = useAccounts(true);
  const [type, setType] = React.useState<AccountType | "all">("all");
  const [q, setQ] = React.useState("");
  const [dialog, setDialog] = React.useState<{ account: Account | null } | null>(null);

  const rows = (accounts.data ?? []).filter(
    (a) => (type === "all" || a.type === type) && (!q || `${a.code} ${a.name}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const groups = ACCOUNT_GROUPS.filter((g) => rows.some((a) => a.group === g.key));

  return (
    <AccountingPage
      title={t("billing.accounting.nav.accounts")}
      description={t("billing.accounting.accounts.subtitle")}
      icon={ListTreeIcon}
      actions={
        canPost ? (
          <Button size="lg" onClick={() => setDialog({ account: null })}>
            <PlusIcon /> {t("billing.accounting.accounts.add")}
          </Button>
        ) : undefined
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ChipGroup
          size="sm"
          aria-label={t("billing.accounting.accounts.type")}
          value={type}
          onChange={setType}
          options={[{ value: "all" as const, label: t("billing.accounting.all") }, ...ACCOUNT_TYPES.map((x) => ({ value: x, label: t(`billing.accounting.type.${x}`) }))]}
        />
        <div className="relative ml-auto w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder={t("billing.accounting.accounts.search")} aria-label={t("billing.accounting.accounts.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {accounts.isError && !accounts.data ? (
        <QueryError error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : accounts.isPending ? (
        <TableSkeleton />
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">{t("billing.accounting.code")}</TableHead>
                  <TableHead>{t("billing.accounting.account")}</TableHead>
                  <TableHead className="text-right">{t("billing.accounting.balance")}</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <React.Fragment key={g.key}>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={4} className="py-2">
                        <span className="font-semibold">{t(`billing.accounting.group.${g.key}`)}</span>
                        <span className="ml-2 text-meta text-muted-foreground">{t(`billing.accounting.groupAbout.${g.key}`)}</span>
                      </TableCell>
                    </TableRow>
                    {rows
                      .filter((a) => a.group === g.key)
                      .map((a) => (
                        <TableRow key={a.id} className={a.active ? undefined : "opacity-60"}>
                          <TableCell className="tabular-nums text-muted-foreground">{a.code}</TableCell>
                          <TableCell className="max-w-96">
                            <ModuleLink to={`accounting/ledger?accountId=${a.id}`} className="font-medium hover:text-primary hover:underline">
                              {a.name}
                            </ModuleLink>
                            <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                              {a.system && <StatusPill tone="neutral">{t("billing.accounting.standard")}</StatusPill>}
                              {a.isBank && <StatusPill tone="info">{t("billing.accounting.bank")}</StatusPill>}
                              {!a.active && <StatusPill tone="neutral">{t("billing.accounting.off")}</StatusPill>}
                            </span>
                            {a.description && <span className="block truncate text-meta text-muted-foreground">{a.description}</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            <Balance net={a.balance ?? 0} />
                          </TableCell>
                          <TableCell className="text-right">
                            {canPost && (
                              <Button size="sm" variant="outline" onClick={() => setDialog({ account: a })}>
                                {t("billing.common.edit")}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
          {rows.length === 0 && <p className="p-6 text-center text-muted-foreground">{t("billing.accounting.accounts.none")}</p>}
        </Panel>
      )}
      <AccountDialog state={dialog} onClose={() => setDialog(null)} />
    </AccountingPage>
  );
}

function AccountDialog({ state, onClose }: { state: { account: Account | null } | null; onClose: () => void }) {
  const { t } = useI18n();
  const save = useSaveAccount();
  const del = useDeleteAccount();
  const a = state?.account ?? null;
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<AccountType>("asset");
  const [group, setGroup] = React.useState("current_assets");
  const [opening, setOpening] = React.useState("");
  const [side, setSide] = React.useState<Side>("dr");
  const [isBank, setIsBank] = React.useState(false);
  const [bankName, setBankName] = React.useState("");
  const [last4, setLast4] = React.useState("");
  const [ifsc, setIfsc] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [active, setActive] = React.useState(true);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  React.useEffect(() => {
    if (!state) return;
    setName(a?.name ?? "");
    setType(a?.type ?? "asset");
    setGroup(a?.group ?? "current_assets");
    setOpening(a && a.openingBalance !== 0 ? paiseToInput(Math.abs(a.openingBalance)) : "");
    setSide(a && a.openingBalance < 0 ? "cr" : a ? (a.normalSide === "cr" && a.openingBalance === 0 ? "cr" : "dr") : "dr");
    setIsBank(a?.isBank ?? false);
    setBankName(a?.bankName ?? "");
    setLast4(a?.bankAccountLast4 ?? "");
    setIfsc(a?.bankIfsc ?? "");
    setDescription(a?.description ?? "");
    setActive(a?.active ?? true);
  }, [state, a]);

  const groups = ACCOUNT_GROUPS.filter((g) => g.type === type);
  const nameOk = name.trim().length > 0;

  const submit = async () => {
    const amount = rupeesToPaise(opening) ?? 0;
    const signed = side === "dr" ? amount : -amount;
    try {
      await save.mutateAsync({
        id: a?.id,
        body: {
          name: name.trim(),
          ...(a?.system ? {} : { type, group, isBank }),
          description: description.trim() || null,
          bankName: isBank ? bankName.trim() || null : null,
          bankAccountLast4: isBank ? last4.trim() || null : null,
          bankIfsc: isBank ? ifsc.trim().toUpperCase() || null : null,
          openingBalance: signed,
          ...(a ? { active } : {}),
        },
      });
      toast.success(t(a ? "billing.accounting.accounts.updated" : "billing.accounting.accounts.created"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const remove = async () => {
    if (!a) return;
    try {
      await del.mutateAsync(a.id);
      toast.success(t("billing.accounting.accounts.deleted"));
      setConfirmDelete(false);
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <>
      <Dialog open={!!state} onOpenChange={(o) => !o && !save.isPending && onClose()}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" closeLabel={t("billing.common.close")}>
          <DialogHeader>
            <DialogTitle>{a ? t("billing.accounting.accounts.editTitle") : t("billing.accounting.accounts.addTitle")}</DialogTitle>
            <DialogDescription>{a?.system ? t("billing.accounting.accounts.systemHint") : t("billing.accounting.accounts.hint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ac-name">{t("billing.accounting.accounts.name")}</Label>
              <Input id="ac-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </div>
            {!a?.system && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="ac-type">{t("billing.accounting.accounts.type")}</Label>
                  <Select
                    value={type}
                    onValueChange={(v) => {
                      const next = v as AccountType;
                      setType(next);
                      setGroup(ACCOUNT_GROUPS.find((g) => g.type === next)!.key);
                    }}
                    disabled={!!a}
                  >
                    <SelectTrigger id="ac-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_TYPES.map((x) => (
                        <SelectItem key={x} value={x}>
                          {t(`billing.accounting.type.${x}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ac-group">{t("billing.accounting.accounts.group")}</Label>
                  <Select value={group} onValueChange={setGroup}>
                    <SelectTrigger id="ac-group" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((g) => (
                        <SelectItem key={g.key} value={g.key}>
                          {t(`billing.accounting.group.${g.key}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-1.5">
                <Label htmlFor="ac-open">{t("billing.accounting.accounts.opening")}</Label>
                <MoneyInput id="ac-open" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
                <p className="text-meta text-muted-foreground">{t("billing.accounting.accounts.openingHint")}</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ac-side">{t("billing.accounting.accounts.openingSide")}</Label>
                <Select value={side} onValueChange={(v) => setSide(v as Side)}>
                  <SelectTrigger id="ac-side" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dr">{t("billing.accounting.debit")}</SelectItem>
                    <SelectItem value="cr">{t("billing.accounting.credit")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {(type === "asset" || a?.isBank) && !a?.system && (
              <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
                <div>
                  <p className="font-medium">{t("billing.accounting.accounts.isBank")}</p>
                  <p className="text-meta text-muted-foreground">{t("billing.accounting.accounts.isBankHint")}</p>
                </div>
                <Switch checked={isBank} onCheckedChange={setIsBank} aria-label={t("billing.accounting.accounts.isBank")} />
              </div>
            )}
            {isBank && (
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-1.5 sm:col-span-1">
                  <Label htmlFor="ac-bank">{t("billing.accounting.accounts.bankName")}</Label>
                  <Input id="ac-bank" value={bankName} maxLength={80} onChange={(e) => setBankName(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ac-last4">{t("billing.accounting.accounts.last4")}</Label>
                  <Input id="ac-last4" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ac-ifsc">IFSC</Label>
                  <Input id="ac-ifsc" maxLength={20} value={ifsc} onChange={(e) => setIfsc(e.target.value)} />
                </div>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="ac-desc">{t("billing.accounting.accounts.about")}</Label>
              <Textarea id="ac-desc" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            {a && !a.system && (
              <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
                <p className="font-medium">{t("billing.accounting.accounts.inUse")}</p>
                <Switch checked={active} onCheckedChange={setActive} aria-label={t("billing.accounting.accounts.inUse")} />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {a && !a.system ? (
              <Button type="button" variant="ghost" className="text-danger-ink" onClick={() => setConfirmDelete(true)}>
                {t("billing.common.delete")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
                {t("billing.common.cancel")}
              </Button>
              <Button type="button" onClick={submit} disabled={!nameOk || save.isPending}>
                {t("billing.common.save")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("billing.accounting.accounts.deleteTitle", { name: a?.name ?? "" })}
        description={t("billing.accounting.accounts.deleteBody")}
        confirmLabel={t("billing.common.delete")}
        destructive
        onConfirm={remove}
      />
    </>
  );
}
