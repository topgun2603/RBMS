"use client";

import * as React from "react";
import {
  BadgeCheckIcon,
  BanIcon,
  CheckCircle2Icon,
  DownloadIcon,
  LandmarkIcon,
  MoreVerticalIcon,
  PackageIcon,
  PencilIcon,
  PercentIcon,
  ArrowUpDownIcon,
  ShieldCheckIcon,
  StoreIcon,
  Trash2Icon,
  UsersIcon,
  XCircleIcon,
} from "lucide-react";
import {
  AnimatedNumber,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  FadeIn,
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
  Skeleton,
  StatCard,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
  ToggleGroup,
  ToggleGroupItem,
} from "@srirealtime/ui";
import {
  ConfirmDialog,
  DetailRow,
  describeError,
  Page,
  PageHeading,
  QueryError,
  useFeature,
  useI18n,
  useModuleNavigate,
  useRouteParams,
} from "@srirealtime/web";
import { AccountPill, KycPill, Thumb, VendorLogo, VendorStatusPill } from "../components/bits";
import { AccountFields, accountErrors, emptyAccount, KycTimeline, SubmitButton, toAccountInput, type AccountDraft } from "../components/account";
import { LedgerList, PayoutsList, Pager, RowsSkeleton, VendorOrdersList } from "../components/lists";
import { PayoutActions } from "./payout-actions";
import {
  accountText,
  bpsToPercent,
  bpsToPercentInput,
  canSetVendorStatus,
  commissionExample,
  money,
  notesWithReason,
  percentToBps,
  rupeesToPaise,
  withRunningBalance,
} from "../lib/logic";
import {
  exportCsv,
  useAdjustLedger,
  useDeleteVendor,
  useKycSubject,
  useMarketplaceSettings,
  usePublicVendor,
  useSetCommission,
  useSetVendorStatus,
  useStaffLedger,
  useStaffPayouts,
  useStaffPayoutAccount,
  useStaffVendorOrders,
  useUpdateVendor,
  useVendorDetail,
} from "../lib/queries";
import type { VendorDetail } from "../lib/types";
import { ProfileFields, profileErrors, profileFromVendor, profilePatch, type ProfileDraft } from "../components/profile";

const PAGE = 25;

export default function VendorDetailPage() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const q = useVendorDetail(id);
  const [tab, setTab] = React.useState("overview");

  if (q.isError) {
    return (
      <Page>
        <PageHeading title={t("marketplace.vendor.title")} back={{ href: "vendors", label: t("marketplace.nav.vendors") }} />
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      </Page>
    );
  }
  if (q.isPending) return <DetailSkeleton />;
  const v = q.data;

  return (
    <Page>
      <PageHeading
        back={{ href: "vendors", label: t("marketplace.nav.vendors") }}
        title={
          <span className="flex items-center gap-3">
            <VendorLogo name={v.name} url={v.logoUrl} className="size-11" />
            <span className="min-w-0 truncate">{v.name}</span>
          </span>
        }
        description={
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <VendorStatusPill status={v.status} />
            <KycPill status={v.kycStatus} />
            <span className="text-xs text-muted-foreground">/{v.slug}</span>
          </span>
        }
        actions={<StatusActions vendor={v} />}
      />

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
          <TabsList>
            <TabsTrigger value="overview">{t("marketplace.vendor.tab.overview")}</TabsTrigger>
            <TabsTrigger value="orders">{t("marketplace.vendor.tab.orders")}</TabsTrigger>
            <TabsTrigger value="ledger">{t("marketplace.vendor.tab.ledger")}</TabsTrigger>
            <TabsTrigger value="payouts">{t("marketplace.vendor.tab.payouts")}</TabsTrigger>
            <TabsTrigger value="products">{t("marketplace.vendor.tab.products")}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview">
          <Overview vendor={v} />
        </TabsContent>
        <TabsContent value="orders">
          <OrdersTab vendorId={v.id} />
        </TabsContent>
        <TabsContent value="ledger">
          <LedgerTab vendor={v} />
        </TabsContent>
        <TabsContent value="payouts">
          <PayoutsTab vendorId={v.id} />
        </TabsContent>
        <TabsContent value="products">
          <ProductsTab vendor={v} />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function DetailSkeleton() {
  return (
    <Page>
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="size-11 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mt-4 h-72 rounded-2xl" />
    </Page>
  );
}

// ---------------------------------------------------------------- status actions

function StatusActions({ vendor: v }: { vendor: VendorDetail }) {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const setStatus = useSetVendorStatus();
  const update = useUpdateVendor();
  const del = useDeleteVendor();
  const [suspending, setSuspending] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [tried, setTried] = React.useState(false);

  const approve = async () => {
    try {
      await setStatus.mutateAsync({ id: v.id, to: "active" });
      toast.success(t(v.status === "pending" ? "marketplace.vendor.approved" : "marketplace.vendor.reactivated", { name: v.name }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const suspend = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (reason.trim().length < 3) return;
    try {
      await setStatus.mutateAsync({ id: v.id, to: "suspended" });
      await update.mutateAsync({ id: v.id, patch: { notes: notesWithReason(v.notes, t("marketplace.vendor.suspendedNote"), reason, new Date()) } });
      toast.success(t("marketplace.vendor.suspended", { name: v.name }));
      setSuspending(false);
      setReason("");
      setTried(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <>
      {canSetVendorStatus(v.status, "active") && (
        <Button size="lg" onClick={() => void approve()} disabled={setStatus.isPending}>
          <CheckCircle2Icon /> {t(v.status === "pending" ? "marketplace.vendor.approve" : "marketplace.vendor.reactivate")}
        </Button>
      )}
      {canSetVendorStatus(v.status, "suspended") && (
        <Button size="lg" variant="outline" onClick={() => setSuspending(true)}>
          <BanIcon /> {t(v.status === "pending" ? "marketplace.vendor.reject" : "marketplace.vendor.suspend")}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-lg" aria-label={t("marketplace.common.more")}>
            <MoreVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => setDeleting(true)}>
            <Trash2Icon /> {t("marketplace.vendor.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={suspending} onOpenChange={setSuspending}>
        <DialogContent closeLabel={t("marketplace.common.close")}>
          <form onSubmit={suspend} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>{t("marketplace.vendor.suspendTitle", { name: v.name })}</DialogTitle>
              <DialogDescription>{t("marketplace.vendor.suspendBody")}</DialogDescription>
            </DialogHeader>
            <Field invalid={tried && reason.trim().length < 3}>
              <FieldLabel>{t("marketplace.vendor.reason")}</FieldLabel>
              <FieldControl>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} autoFocus />
              </FieldControl>
              <FieldHint>{t("marketplace.vendor.reasonHint")}</FieldHint>
              <FieldError>{tried && reason.trim().length < 3 ? t("marketplace.validation.reason") : null}</FieldError>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSuspending(false)}>
                {t("marketplace.common.cancel")}
              </Button>
              <SubmitButton variant="destructive" pending={setStatus.isPending || update.isPending}>
                {t(v.status === "pending" ? "marketplace.vendor.reject" : "marketplace.vendor.suspend")}
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("marketplace.vendor.deleteTitle", { name: v.name })}
        description={t("marketplace.vendor.deleteBody")}
        confirmLabel={t("marketplace.vendor.delete")}
        onConfirm={async () => {
          try {
            await del.mutateAsync(v.id);
            toast.success(t("marketplace.vendor.deleted"));
            navigate("vendors");
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------- overview

function Overview({ vendor: v }: { vendor: VendorDetail }) {
  const { t } = useI18n();
  const b = v.balance;
  return (
    <div className="grid gap-section">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t("marketplace.balance.payable")} value={<AnimatedNumber value={b.balance} format={money} />} description={t("marketplace.balance.payableHint")} />
        <StatCard title={t("marketplace.balance.sales")} value={<AnimatedNumber value={b.sales} format={money} />} />
        <StatCard title={t("marketplace.balance.commission")} value={<AnimatedNumber value={-b.commission} format={money} />} description={bpsToPercent(v.effectiveCommissionBps)} />
        <StatCard title={t("marketplace.balance.paidOut")} value={<AnimatedNumber value={-b.payouts} format={money} />} description={b.refunds ? t("marketplace.balance.refunds", { amount: money(-b.refunds) }) : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileCard vendor={v} />
        <div className="grid content-start gap-section">
          <CommissionCard vendor={v} />
          <PayoutAccountCard vendor={v} />
        </div>
        <KycCard vendor={v} />
        <UsersCard vendor={v} />
      </div>
    </div>
  );
}

function SectionCard({ icon: Icon, title, action, children }: { icon: React.ComponentType<{ className?: string }>; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="icon-chip size-8 text-primary">
            <Icon className="size-4" />
          </span>
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ProfileCard({ vendor: v }: { vendor: VendorDetail }) {
  const { t, formatDate } = useI18n();
  const [editing, setEditing] = React.useState(false);
  return (
    <SectionCard
      icon={StoreIcon}
      title={t("marketplace.vendor.profile")}
      action={
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <PencilIcon /> {t("marketplace.common.edit")}
        </Button>
      }
    >
      {v.description && <p className="mb-2 text-sm whitespace-pre-line text-muted-foreground">{v.description}</p>}
      <div className="divide-y">
        <DetailRow label={t("marketplace.profile.contactName")}>{v.contactName ?? "—"}</DetailRow>
        <DetailRow label={t("marketplace.profile.phone")}>{v.contactPhone ?? "—"}</DetailRow>
        <DetailRow label={t("marketplace.profile.email")}>{v.contactEmail ?? "—"}</DetailRow>
        <DetailRow label={t("marketplace.profile.gstin")}>{v.gstin ?? "—"}</DetailRow>
        <DetailRow label={t("marketplace.profile.address")}>
          {v.address ? [v.address.line1, v.address.line2, v.address.city, v.address.pincode].filter(Boolean).join(", ") : "—"}
        </DetailRow>
        <DetailRow label={t("marketplace.vendor.joined")}>{formatDate(v.createdAt, { day: "numeric", month: "short", year: "numeric" })}</DetailRow>
        {v.notes && (
          <div className="py-2 text-sm">
            <p className="text-muted-foreground">{t("marketplace.vendor.notes")}</p>
            <p className="mt-1 font-mono text-xs whitespace-pre-line">{v.notes}</p>
          </div>
        )}
      </div>
      <EditProfileDialog vendor={v} open={editing} onOpenChange={setEditing} />
    </SectionCard>
  );
}

function EditProfileDialog({ vendor: v, open, onOpenChange }: { vendor: VendorDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const update = useUpdateVendor();
  const [draft, setDraft] = React.useState<ProfileDraft>(() => profileFromVendor(v));
  const [notes, setNotes] = React.useState(v.notes ?? "");
  const [tried, setTried] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setDraft(profileFromVendor(v));
      setNotes(v.notes ?? "");
      setTried(false);
    }
  }, [open, v]);
  const errors = profileErrors(draft);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length) return;
    try {
      await update.mutateAsync({ id: v.id, patch: { ...profilePatch(draft), notes: notes.trim() || null } });
      toast.success(t("marketplace.common.saved"));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" closeLabel={t("marketplace.common.close")}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("marketplace.vendor.editProfile")}</DialogTitle>
            <DialogDescription>{t("marketplace.vendor.editProfileBody")}</DialogDescription>
          </DialogHeader>
          <ProfileFields value={draft} onChange={setDraft} errors={tried ? errors : {}} />
          <Field>
            <FieldLabel optional={t("marketplace.common.optional")}>{t("marketplace.vendor.notes")}</FieldLabel>
            <FieldControl>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
            </FieldControl>
            <FieldHint>{t("marketplace.vendor.notesHint")}</FieldHint>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("marketplace.common.cancel")}
            </Button>
            <SubmitButton pending={update.isPending}>{t("marketplace.common.save")}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CommissionCard({ vendor: v }: { vendor: VendorDetail }) {
  const { t } = useI18n();
  const settings = useMarketplaceSettings();
  const save = useSetCommission();
  const [own, setOwn] = React.useState(v.commissionBps !== null);
  const [pct, setPct] = React.useState(bpsToPercentInput(v.commissionBps ?? v.effectiveCommissionBps));
  React.useEffect(() => {
    setOwn(v.commissionBps !== null);
    setPct(bpsToPercentInput(v.commissionBps ?? v.effectiveCommissionBps));
  }, [v.commissionBps, v.effectiveCommissionBps]);
  const bps = own ? percentToBps(pct) : null;
  const invalid = own && bps === null;
  const shown = own ? (bps ?? 0) : (settings.data?.defaultCommissionBps ?? v.effectiveCommissionBps);
  const ex = commissionExample(shown);
  const dirty = own ? bps !== v.commissionBps : v.commissionBps !== null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    try {
      await save.mutateAsync({ id: v.id, commissionBps: own ? bps : null });
      toast.success(t("marketplace.commission.saved", { rate: bpsToPercent(shown) }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <SectionCard icon={PercentIcon} title={t("marketplace.commission.title")}>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <Field>
          <div className="flex items-center justify-between gap-3">
            <div>
              <FieldLabel>{t("marketplace.commission.own")}</FieldLabel>
              <FieldHint>
                {t("marketplace.commission.defaultIs", { rate: bpsToPercent(settings.data?.defaultCommissionBps ?? v.effectiveCommissionBps) })}
              </FieldHint>
            </div>
            <FieldControl>
              <Switch checked={own} onCheckedChange={setOwn} />
            </FieldControl>
          </div>
        </Field>
        {own && (
          <FadeIn>
            <Field invalid={invalid}>
              <FieldLabel>{t("marketplace.commission.rate")}</FieldLabel>
              <InputGroup>
                <FieldControl>
                  <InputGroupInput value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" />
                </FieldControl>
                <InputGroupAddon>%</InputGroupAddon>
              </InputGroup>
              <FieldError>{invalid ? t("marketplace.validation.percent") : null}</FieldError>
            </Field>
          </FadeIn>
        )}
        <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {t("marketplace.commission.example", { sale: money(ex.sale), commission: money(ex.commission), net: money(ex.net) })}
        </p>
        <div className="flex justify-end">
          <SubmitButton pending={save.isPending} disabled={!dirty || invalid}>
            {t("marketplace.common.save")}
          </SubmitButton>
        </div>
      </form>
    </SectionCard>
  );
}

function PayoutAccountCard({ vendor: v }: { vendor: VendorDetail }) {
  const { t } = useI18n();
  const update = useUpdateVendor();
  const setAccount = useStaffPayoutAccount();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<AccountDraft>(emptyAccount());
  const [tried, setTried] = React.useState(false);
  const errors = accountErrors(draft);

  const mark = async (status: "verified" | "rejected") => {
    try {
      await update.mutateAsync({ id: v.id, patch: { payoutAccountStatus: status } });
      toast.success(t(status === "verified" ? "marketplace.account.verifiedToast" : "marketplace.account.rejectedToast"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length) return;
    try {
      await setAccount.mutateAsync({ id: v.id, account: toAccountInput(draft) });
      toast.success(t("marketplace.account.savedStaff"));
      setEditing(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <SectionCard
      icon={LandmarkIcon}
      title={t("marketplace.account.title")}
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft(emptyAccount(v.payoutAccount?.type ?? "bank"));
            setTried(false);
            setEditing(true);
          }}
        >
          <PencilIcon /> {t(v.payoutAccount ? "marketplace.account.change" : "marketplace.account.add")}
        </Button>
      }
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-sm">{accountText(v.payoutAccount)}</p>
          <AccountPill status={v.payoutAccountStatus} />
        </div>
        {v.payoutAccountStatus === "pending" && (
          <FadeIn className="grid gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
            <p className="text-sm">{t("marketplace.account.pendingStaff")}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void mark("verified")} disabled={update.isPending}>
                <BadgeCheckIcon /> {t("marketplace.account.verify")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void mark("rejected")} disabled={update.isPending}>
                <XCircleIcon /> {t("marketplace.account.reject")}
              </Button>
            </div>
          </FadeIn>
        )}
      </div>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent closeLabel={t("marketplace.common.close")}>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>{t("marketplace.account.title")}</DialogTitle>
              <DialogDescription>{t("marketplace.account.staffBody")}</DialogDescription>
            </DialogHeader>
            <AccountFields value={draft} onChange={setDraft} errors={tried ? errors : {}} allowRoute />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                {t("marketplace.common.cancel")}
              </Button>
              <SubmitButton pending={setAccount.isPending}>{t("marketplace.common.save")}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

function KycCard({ vendor: v }: { vendor: VendorDetail }) {
  const { t } = useI18n();
  const kycOn = useFeature("kyc");
  const subject = useKycSubject(v.id, kycOn);
  return (
    <SectionCard icon={ShieldCheckIcon} title={t("marketplace.kyc.title")} action={<KycPill status={subject.data?.status ?? v.kycStatus} />}>
      {!kycOn ? (
        <p className="text-sm text-muted-foreground">{t("marketplace.kyc.off")}</p>
      ) : subject.isError ? (
        <QueryError compact error={subject.error} onRetry={() => void subject.refetch()} />
      ) : subject.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : (
        <div className="grid gap-3">
          {subject.data.verifiedName && <p className="text-sm">{t("marketplace.kyc.verifiedAs", { name: subject.data.verifiedName })}</p>}
          {subject.data.missing.length > 0 && (
            <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{t("marketplace.kyc.missing", { items: subject.data.missing.join(", ") })}</p>
          )}
          <KycTimeline checks={subject.data.checks} />
        </div>
      )}
    </SectionCard>
  );
}

function UsersCard({ vendor: v }: { vendor: VendorDetail }) {
  const { t, formatDate } = useI18n();
  return (
    <SectionCard icon={UsersIcon} title={t("marketplace.vendor.users")}>
      {v.users.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("marketplace.vendor.noUsers")}</p>
      ) : (
        <ul className="divide-y text-sm">
          {v.users.map((u) => (
            <li key={u.userId} className="flex items-center justify-between gap-2 py-2">
              <span className="truncate font-mono text-xs">{u.userId}</span>
              <span className="text-muted-foreground">
                {t(`marketplace.role.${u.role}`)} · {formatDate(u.createdAt, { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------- tabs

function OrdersTab({ vendorId }: { vendorId: string }) {
  const { t } = useI18n();
  const [offset, setOffset] = React.useState(0);
  const q = useStaffVendorOrders({ vendorId, limit: PAGE, offset });
  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void exportCsv("vendor-orders", { vendorId }).catch((e) => toast.error(describeError(e, t)))}>
          <DownloadIcon /> {t("marketplace.common.exportCsv")}
        </Button>
      </div>
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <RowsSkeleton />
      ) : (
        <>
          <VendorOrdersList items={q.data.items} />
          <Pager offset={offset} limit={PAGE} total={q.data.total} onChange={setOffset} />
        </>
      )}
    </div>
  );
}

function LedgerTab({ vendor: v }: { vendor: VendorDetail }) {
  const { t } = useI18n();
  const [offset, setOffset] = React.useState(0);
  const [adjusting, setAdjusting] = React.useState(false);
  const q = useStaffLedger({ vendorId: v.id, limit: PAGE, offset });
  // Running balance: the first page ends at today's balance; later pages continue from what earlier pages took off.
  const before = useStaffLedger({ vendorId: v.id, limit: offset || 1, offset: 0 }, offset > 0);
  const startBalance = (q.data?.balance?.balance ?? v.balance.balance) - (offset > 0 ? (before.data?.items.reduce((s, e) => s + e.amount, 0) ?? 0) : 0);
  const rows = q.data ? withRunningBalance(q.data.items, startBalance) : [];
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {t("marketplace.ledger.balanceNow")} <span className="font-semibold text-foreground tabular-nums">{money(q.data?.balance?.balance ?? v.balance.balance)}</span>
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void exportCsv("ledger", { vendorId: v.id }).catch((e) => toast.error(describeError(e, t)))}>
            <DownloadIcon /> {t("marketplace.common.exportCsv")}
          </Button>
          <Button size="sm" onClick={() => setAdjusting(true)}>
            <ArrowUpDownIcon /> {t("marketplace.ledger.adjust")}
          </Button>
        </div>
      </div>
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending || (offset > 0 && before.isPending) ? (
        <RowsSkeleton />
      ) : (
        <>
          <LedgerList rows={rows} />
          <Pager offset={offset} limit={PAGE} total={q.data.total} onChange={setOffset} />
        </>
      )}
      <AdjustDialog vendor={v} open={adjusting} onOpenChange={setAdjusting} />
    </div>
  );
}

function AdjustDialog({ vendor: v, open, onOpenChange }: { vendor: VendorDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const adjust = useAdjustLedger();
  const [dir, setDir] = React.useState<"credit" | "debit">("credit");
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [tried, setTried] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setDir("credit");
      setAmount("");
      setNote("");
      setTried(false);
    }
  }, [open]);
  const paise = rupeesToPaise(amount);
  const errs = {
    amount: !paise ? t("marketplace.validation.amount") : null,
    note: note.trim().length < 3 ? t("marketplace.validation.note") : null,
  };
  const after = v.balance.balance + (paise ?? 0) * (dir === "credit" ? 1 : -1);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (errs.amount || errs.note || !paise) return;
    try {
      await adjust.mutateAsync({ id: v.id, amount: dir === "credit" ? paise : -paise, note: note.trim() });
      toast.success(t("marketplace.ledger.adjusted"));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("marketplace.common.close")}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("marketplace.ledger.adjustTitle")}</DialogTitle>
            <DialogDescription>{t("marketplace.ledger.adjustBody")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={null}>{t("marketplace.ledger.direction")}</FieldLabel>
            <ToggleGroup type="single" variant="outline" value={dir} onValueChange={(x) => x && setDir(x as "credit" | "debit")} className="w-full">
              <ToggleGroupItem value="credit" className="flex-1">
                {t("marketplace.ledger.credit")}
              </ToggleGroupItem>
              <ToggleGroupItem value="debit" className="flex-1">
                {t("marketplace.ledger.debit")}
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <FieldRow>
            <Field invalid={tried && !!errs.amount}>
              <FieldLabel>{t("marketplace.ledger.amount")}</FieldLabel>
              <InputGroup>
                <InputGroupAddon>₹</InputGroupAddon>
                <FieldControl>
                  <InputGroupInput value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" autoFocus />
                </FieldControl>
              </InputGroup>
              <FieldHint>{t("marketplace.ledger.balanceAfter", { amount: money(after) })}</FieldHint>
              <FieldError>{tried ? errs.amount : null}</FieldError>
            </Field>
            <Field invalid={tried && !!errs.note}>
              <FieldLabel>{t("marketplace.ledger.note")}</FieldLabel>
              <FieldControl>
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </FieldControl>
              <FieldError>{tried ? errs.note : null}</FieldError>
            </Field>
          </FieldRow>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("marketplace.common.cancel")}
            </Button>
            <SubmitButton pending={adjust.isPending}>{t("marketplace.ledger.adjust")}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayoutsTab({ vendorId }: { vendorId: string }) {
  const { t } = useI18n();
  const payoutsOn = useFeature("marketplace.payouts");
  const [offset, setOffset] = React.useState(0);
  const q = useStaffPayouts({ vendorId, offset, limit: PAGE }, payoutsOn);
  if (!payoutsOn) return <EmptyState icon={LandmarkIcon} title={t("marketplace.payouts.offTitle")} description={t("marketplace.payouts.offBody")} />;
  return q.isError ? (
    <QueryError error={q.error} onRetry={() => void q.refetch()} />
  ) : q.isPending ? (
    <RowsSkeleton />
  ) : (
    <>
      <PayoutsList items={q.data.items} actions={(p) => <PayoutActions payout={p} />} />
      <Pager offset={offset} limit={PAGE} total={q.data.total} onChange={setOffset} />
    </>
  );
}

function ProductsTab({ vendor: v }: { vendor: VendorDetail }) {
  const { t } = useI18n();
  const q = usePublicVendor(v.slug, v.status === "active");
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        {v.productCount === null ? t("marketplace.vendor.productsUnknown") : t("marketplace.vendor.productCount", { count: v.productCount })}
        {" · "}
        {t("marketplace.vendor.productsPublicNote")}
      </p>
      {v.status !== "active" ? (
        <EmptyState icon={PackageIcon} title={t("marketplace.vendor.productsInactive")} />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <RowsSkeleton rows={4} />
      ) : q.data.products.items.length === 0 ? (
        <EmptyState icon={PackageIcon} title={t("marketplace.products.emptyTitle")} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.products.items.map((p) => (
            <Card key={p.id} className="flex-row items-center gap-3 p-3">
              <Thumb src={p.image} className="size-12" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="text-meta text-muted-foreground tabular-nums">{p.priceMin === p.priceMax ? money(p.priceMin) : `${money(p.priceMin)} – ${money(p.priceMax)}`}</p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

