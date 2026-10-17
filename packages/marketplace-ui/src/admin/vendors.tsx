"use client";

import * as React from "react";
import { PlusIcon, SettingsIcon, StoreIcon } from "lucide-react";
import {
  Button,
  ChipGroup,
  DataTable,
  DataTableToolbar,
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
  Switch,
  toast,
  type DataTableColumn,
} from "@srirealtime/ui";
import { describeError, ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { KycPill, VendorLogo, VendorStatusPill } from "../components/bits";
import { SubmitButton } from "../components/account";
import { bpsToPercent, money, PHONE_RE } from "../lib/logic";
import { MP, mk, useCreateVendor, useVendorDetail } from "../lib/queries";
import { VENDOR_KYC_STATUSES, VENDOR_STATUSES, type VendorListItem } from "../lib/types";

export default function VendorsPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <VendorsList />
    </React.Suspense>
  );
}

function VendorsList() {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const [adding, setAdding] = React.useState(false);

  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("marketplace.vendors.filterStatus"),
          options: VENDOR_STATUSES.map((s) => ({ value: s, label: t(`marketplace.status.${s}`) })),
        },
        kycStatus: {
          kind: "options",
          label: t("marketplace.vendors.filterKyc"),
          options: VENDOR_KYC_STATUSES.map((s) => ({ value: s, label: t(`marketplace.kyc.status.${s}`) })),
        },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<VendorListItem>[]>(
    () => [
      {
        id: "name",
        header: t("marketplace.vendors.col.seller"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[22rem]",
        cell: (v) => (
          <ModuleLink to={`vendors/${v.id}`} className="flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <VendorLogo name={v.name} url={v.logoUrl} />
            <div className="min-w-0">
              <p className="truncate font-medium hover:text-primary">{v.name}</p>
              <p className="mt-0.5 truncate text-meta text-muted-foreground">{[v.contactName, v.contactPhone].filter(Boolean).join(" · ") || `/${v.slug}`}</p>
            </div>
          </ModuleLink>
        ),
        cardCell: (v) => v.name,
      },
      {
        id: "contact",
        header: t("marketplace.profile.phone"),
        defaultHidden: true,
        card: "subtitle",
        cell: (v) => <span className="text-muted-foreground">{[v.contactName, v.contactPhone].filter(Boolean).join(" · ") || `/${v.slug}`}</span>,
      },
      { id: "status", header: t("marketplace.vendors.col.status"), sortable: true, card: "meta", cell: (v) => <VendorStatusPill status={v.status} /> },
      { id: "kyc", header: t("marketplace.vendors.col.kyc"), card: "meta", cell: (v) => <KycPill status={v.kycStatus} /> },
      {
        id: "commission",
        header: t("marketplace.vendors.col.commission"),
        sortable: true,
        numeric: true,
        card: "meta",
        cell: (v) => (
          <>
            {bpsToPercent(v.effectiveCommissionBps)}
            {v.commissionBps === null && <span className="block text-xs text-muted-foreground">{t("marketplace.vendors.shopDefault")}</span>}
          </>
        ),
        cardCell: (v) => <span className="tabular-nums">{bpsToPercent(v.effectiveCommissionBps)}</span>,
      },
      { id: "products", header: t("marketplace.vendors.col.products"), numeric: true, hideBelow: "lg", cell: (v) => <ProductCount id={v.id} /> },
      {
        id: "sales",
        header: t("marketplace.vendors.col.sales"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (v) => <span className="font-semibold">{money(v.sales)}</span>,
      },
      {
        id: "joined",
        header: t("marketplace.vendors.col.joined"),
        sortable: true,
        sortDescFirst: true,
        hideBelow: "md",
        cell: (v) => <span className="text-muted-foreground tabular-nums">{formatDate(v.createdAt, { day: "numeric", month: "short", year: "numeric" })}</span>,
      },
    ],
    [t, formatDate],
  );

  const st = useServerTable<VendorListItem, typeof filters>({
    queryKey: [...mk.all, "vendors", "table"],
    path: `${MP}/vendors`,
    columns,
    filters,
    defaultSort: "-joined",
    search: t("marketplace.vendors.searchAll"),
    storageKey: "marketplace-vendors",
  });

  const status = st.filters.status;
  const counts = st.facets?.status;
  const all = counts ? Object.values(counts).reduce((n, c) => n + c, 0) : undefined;
  const pill = status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : "";
  const filtered = st.table.activeFilterCount > 0;

  const addButton = (
    <Button size="lg" onClick={() => setAdding(true)}>
      <PlusIcon /> {t("marketplace.vendors.add")}
    </Button>
  );

  return (
    <Page width="full">
      <PageHeading
        icon={StoreIcon}
        title={t("marketplace.vendors.title")}
        description={st.total !== undefined && st.total > 0 ? t("marketplace.vendors.count", { count: st.total }) : t("marketplace.vendors.subtitle")}
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <ModuleLink to="settings">
                <SettingsIcon /> <span className="hidden sm:inline">{t("marketplace.nav.settings")}</span>
              </ModuleLink>
            </Button>
            {addButton}
          </>
        }
      />

      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("marketplace.vendors.filter")}
            value={pill}
            onChange={(v) => status.set(v === "all" ? [] : [v])}
            options={[
              { value: "all", label: t("marketplace.vendors.tabAll"), meta: all || undefined },
              ...VENDOR_STATUSES.map((s) => ({ value: s, label: t(`marketplace.status.${s}`), meta: counts ? counts[s] || undefined : undefined })),
            ]}
          />
        }
      />

      <DataTable
        table={st.table}
        onRowClick={(v) => navigate(`vendors/${v.id}`)}
        empty={
          filtered ? undefined : (
            <EmptyState
              className="border-0 bg-transparent"
              icon={StoreIcon}
              title={t("marketplace.vendors.emptyTitle")}
              description={t("marketplace.vendors.emptyBody")}
              action={addButton}
            />
          )
        }
      />

      <AddVendorDialog open={adding} onOpenChange={setAdding} />
    </Page>
  );
}

/** Product count comes from the seller's detail (the catalogue counts it; the list doesn't). */
function ProductCount({ id }: { id: string }) {
  const d = useVendorDetail(id);
  if (d.isPending) return <Skeleton className="ml-auto h-4 w-8" />;
  return <>{d.data?.productCount ?? "—"}</>;
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
