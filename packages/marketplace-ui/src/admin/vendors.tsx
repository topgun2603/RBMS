"use client";

import * as React from "react";
import { ChevronRightIcon, PlusIcon, SettingsIcon, StoreIcon } from "lucide-react";
import {
  Button,
  Card,
  ChipGroup,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  Skeleton,
  Stagger,
  StaggerItem,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@srirealtime/ui";
import {
  describeError,
  ModuleLink,
  Page,
  PageHeading,
  QueryError,
  SearchField,
  useDebounced,
  useI18n,
  useModuleNavigate,
  useQueryParams,
} from "@srirealtime/web";
import { KycPill, VendorLogo, VendorStatusPill } from "../components/bits";
import { Pager, RowsSkeleton } from "../components/lists";
import { SubmitButton } from "../components/account";
import { bpsToPercent, money, PHONE_RE } from "../lib/logic";
import { useCreateVendor, useVendorDetail, useVendorList, VENDOR_PAGE } from "../lib/queries";
import { VENDOR_STATUSES, type Vendor, type VendorStatus } from "../lib/types";

type Tab = "all" | VendorStatus;

export default function VendorsPage() {
  const { t } = useI18n();
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const initial = params.get("status");
  const [tab, setTab] = React.useState<Tab>((VENDOR_STATUSES as readonly string[]).includes(initial ?? "") ? (initial as VendorStatus) : "all");
  const [q, setQ] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const [adding, setAdding] = React.useState(false);
  const debounced = useDebounced(q.trim(), 300);
  React.useEffect(() => setOffset(0), [tab, debounced]);

  const list = useVendorList({ status: tab === "all" ? undefined : tab, q: debounced || undefined, offset });
  const counts = list.data?.counts;
  const all = counts ? counts.pending + counts.active + counts.suspended : undefined;
  const items = list.data?.items ?? [];

  return (
    <Page width="full">
      <PageHeading
        icon={StoreIcon}
        title={t("marketplace.vendors.title")}
        description={t("marketplace.vendors.subtitle")}
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <ModuleLink to="settings">
                <SettingsIcon /> <span className="hidden sm:inline">{t("marketplace.nav.settings")}</span>
              </ModuleLink>
            </Button>
            <Button size="lg" onClick={() => setAdding(true)}>
              <PlusIcon /> {t("marketplace.vendors.add")}
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3">
        <SearchField value={q} onChange={setQ} placeholder={t("marketplace.vendors.search")} />
        <ChipGroup<Tab>
          value={tab}
          onChange={(v) => {
            setTab(v);
            navigate(v === "all" ? "?" : `?status=${v}`, { replace: true, scroll: false });
          }}
          size="sm"
          aria-label={t("marketplace.vendors.filter")}
          options={[
            { value: "all", label: t("marketplace.vendors.tabAll"), meta: all },
            { value: "pending", label: t("marketplace.status.pending"), meta: counts?.pending || undefined },
            { value: "active", label: t("marketplace.status.active"), meta: counts?.active },
            { value: "suspended", label: t("marketplace.status.suspended"), meta: counts?.suspended || undefined },
          ]}
        />
      </div>

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <RowsSkeleton rows={6} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={StoreIcon}
          title={debounced || tab !== "all" ? t("marketplace.vendors.noMatch") : t("marketplace.vendors.emptyTitle")}
          description={debounced || tab !== "all" ? t("marketplace.vendors.noMatchBody") : t("marketplace.vendors.emptyBody")}
          action={
            <Button size="lg" onClick={() => setAdding(true)}>
              <PlusIcon /> {t("marketplace.vendors.add")}
            </Button>
          }
        />
      ) : (
        <div className={cn("transition-opacity", list.isPlaceholderData && "opacity-60")}>
          <Card className="hidden gap-0 overflow-hidden py-0 md:flex">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">{t("marketplace.vendors.col.seller")}</TableHead>
                  <TableHead>{t("marketplace.vendors.col.status")}</TableHead>
                  <TableHead>{t("marketplace.vendors.col.kyc")}</TableHead>
                  <TableHead className="text-right">{t("marketplace.vendors.col.commission")}</TableHead>
                  <TableHead className="text-right">{t("marketplace.vendors.col.products")}</TableHead>
                  <TableHead className="text-right">{t("marketplace.vendors.col.sales")}</TableHead>
                  <TableHead className="w-10 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((v) => (
                  <VendorRow key={v.id} vendor={v} />
                ))}
              </TableBody>
            </Table>
          </Card>
          <Stagger key={`${tab}-${debounced}-${offset}`} className="grid gap-2 md:hidden">
            {items.map((v) => (
              <StaggerItem key={v.id}>
                <VendorCard vendor={v} />
              </StaggerItem>
            ))}
          </Stagger>
          <Pager offset={offset} limit={VENDOR_PAGE} total={list.data?.total ?? 0} onChange={setOffset} />
        </div>
      )}

      <AddVendorDialog open={adding} onOpenChange={setAdding} />
    </Page>
  );
}

/** Products and sales come from the seller's detail (the list has neither). */
function useFigures(id: string) {
  const d = useVendorDetail(id);
  return { loading: d.isPending, products: d.data?.productCount ?? null, sales: d.data?.balance.sales ?? 0 };
}

function VendorRow({ vendor: v }: { vendor: Vendor }) {
  const { t } = useI18n();
  const f = useFigures(v.id);
  return (
    <TableRow className="group">
      <TableCell className="pl-4">
        <ModuleLink to={`vendors/${v.id}`} className="flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <VendorLogo name={v.name} url={v.logoUrl} />
          <div className="min-w-0">
            <p className="truncate font-medium group-hover:text-primary">{v.name}</p>
            <p className="mt-0.5 truncate text-meta text-muted-foreground">{[v.contactName, v.contactPhone].filter(Boolean).join(" · ") || `/${v.slug}`}</p>
          </div>
        </ModuleLink>
      </TableCell>
      <TableCell>
        <VendorStatusPill status={v.status} />
      </TableCell>
      <TableCell>
        <KycPill status={v.kycStatus} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {bpsToPercent(v.effectiveCommissionBps)}
        {v.commissionBps === null && <span className="block text-xs text-muted-foreground">{t("marketplace.vendors.shopDefault")}</span>}
      </TableCell>
      <TableCell className="text-right tabular-nums">{f.loading ? <Skeleton className="ml-auto h-4 w-8" /> : (f.products ?? "—")}</TableCell>
      <TableCell className="text-right font-semibold tabular-nums">{f.loading ? <Skeleton className="ml-auto h-4 w-16" /> : money(f.sales)}</TableCell>
      <TableCell className="pr-4">
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </TableCell>
    </TableRow>
  );
}

function VendorCard({ vendor: v }: { vendor: Vendor }) {
  const { t } = useI18n();
  const f = useFigures(v.id);
  return (
    <ModuleLink to={`vendors/${v.id}`} className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="flex-row items-center gap-3 p-3 active:scale-[0.99]">
        <VendorLogo name={v.name} url={v.logoUrl} className="size-12" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate font-medium">{v.name}</p>
          <div className="flex flex-wrap gap-1.5">
            <VendorStatusPill status={v.status} />
            <KycPill status={v.kycStatus} />
          </div>
          <p className="text-meta text-muted-foreground tabular-nums">
            {t("marketplace.vendors.cardLine", { rate: bpsToPercent(v.effectiveCommissionBps), products: f.products ?? "—", sales: money(f.sales) })}
          </p>
        </div>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
      </Card>
    </ModuleLink>
  );
}

function AddVendorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const create = useCreateVendor();
  const [name, setName] = React.useState("");
  const [contactName, setContactName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [active, setActive] = React.useState(true);
  const [tried, setTried] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setName("");
    setContactName("");
    setPhone("");
    setEmail("");
    setActive(true);
    setTried(false);
  }, [open]);

  const errors = {
    name: name.trim().length < 2 ? t("marketplace.validation.name") : null,
    phone: phone.trim() && !PHONE_RE.test(phone.replace(/[\s-]/g, "")) ? t("marketplace.validation.phone") : null,
    email: email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim()) ? t("marketplace.validation.email") : null,
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (errors.name || errors.phone || errors.email) return;
    try {
      const v = (await create.mutateAsync({
        name: name.trim(),
        contactName: contactName.trim() || null,
        contactPhone: phone.trim() || null,
        contactEmail: email.trim() || null,
        status: active ? "active" : "pending",
      })) as { id: string };
      toast.success(t("marketplace.vendors.added", { name: name.trim() }));
      onOpenChange(false);
      navigate(`vendors/${v.id}`);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("marketplace.common.close")}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("marketplace.vendors.addTitle")}</DialogTitle>
            <DialogDescription>{t("marketplace.vendors.addBody")}</DialogDescription>
          </DialogHeader>
          <Field invalid={tried && !!errors.name}>
            <FieldLabel>{t("marketplace.profile.name")}</FieldLabel>
            <FieldControl>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </FieldControl>
            <FieldError>{tried ? errors.name : null}</FieldError>
          </Field>
          <FieldRow>
            <Field>
              <FieldLabel optional={t("marketplace.common.optional")}>{t("marketplace.profile.contactName")}</FieldLabel>
              <FieldControl>
                <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </FieldControl>
            </Field>
            <Field invalid={tried && !!errors.phone}>
              <FieldLabel optional={t("marketplace.common.optional")}>{t("marketplace.profile.phone")}</FieldLabel>
              <FieldControl>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
              </FieldControl>
              <FieldError>{tried ? errors.phone : null}</FieldError>
            </Field>
          </FieldRow>
          <Field invalid={tried && !!errors.email}>
            <FieldLabel optional={t("marketplace.common.optional")}>{t("marketplace.profile.email")}</FieldLabel>
            <FieldControl>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" />
            </FieldControl>
            <FieldError>{tried ? errors.email : null}</FieldError>
          </Field>
          <Field>
            <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <div>
                <FieldLabel>{t("marketplace.vendors.activeNow")}</FieldLabel>
                <FieldHint>{t("marketplace.vendors.activeNowHint")}</FieldHint>
              </div>
              <FieldControl>
                <Switch checked={active} onCheckedChange={setActive} />
              </FieldControl>
            </div>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("marketplace.common.cancel")}
            </Button>
            <SubmitButton pending={create.isPending}>{t("marketplace.vendors.add")}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
