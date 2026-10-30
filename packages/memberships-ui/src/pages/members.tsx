"use client";

import * as React from "react";
import { ScanLineIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { Button, ChipGroup, DataTable, DataTableToolbar, EmptyState, type DataTableColumn } from "@rbms/ui";
import {
  ModuleLink,
  Page,
  PageHeading,
  useFeature,
  useI18n,
  useModuleNavigate,
  usePermission,
  useQueryParams,
  useServerTable,
  type ServerFilterDefs,
} from "@rbms/web";
import { dash, EndsOn } from "../components/bits";
import { MemberDialog } from "../components/member-dialog";
import { DESK_ACCESS, MEMBERSHIPS_FEATURES, MEMBERSHIPS_PERMISSIONS } from "../lib/access";
import { phoneLabel } from "../lib/format";
import { mk, useMembershipSettings } from "../lib/queries";
import { MEMBER_STATUSES, type Member } from "../lib/types";

export default function MembersPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <Members />
    </React.Suspense>
  );
}

function Members() {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const params = useQueryParams();
  const canManage = usePermission(MEMBERSHIPS_PERMISSIONS.manage);
  const deskOn = useFeature(MEMBERSHIPS_FEATURES.checkin);
  const deskAllowed = usePermission(DESK_ACCESS);
  const desk = deskOn && deskAllowed;
  const settings = useMembershipSettings();
  const expiringDays = settings.data?.expiringDays ?? 7;
  const [adding, setAdding] = React.useState(false);

  // Quick action / dashboard link: /members?add=1 opens the add dialog.
  React.useEffect(() => {
    if (params.get("add") === "1" && canManage) setAdding(true);
  }, [params, canManage]);

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: t("memberships.members.filterStatus"), options: MEMBER_STATUSES.map((s) => ({ value: s, label: t(`memberships.status.${s}`) })) },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<Member>[]>(
    () => [
      {
        id: "code",
        header: t("memberships.members.col.code"),
        sortable: true,
        hideable: false,
        card: "subtitle",
        cell: (r) => (
          <ModuleLink to={`m/${r.id}`} className="font-mono text-meta hover:underline">
            {r.memberCode}
          </ModuleLink>
        ),
        cardCell: (r) => [r.memberCode, phoneLabel(r.phone)].filter(Boolean).join(" · "),
      },
      { id: "name", header: t("memberships.members.col.name"), sortable: true, hideable: false, card: "title", cell: (r) => <span className="font-medium">{r.name}</span> },
      { id: "phone", header: t("memberships.members.col.phone"), cell: (r) => <span className="tabular-nums">{dash(phoneLabel(r.phone))}</span> },
      { id: "plan", header: t("memberships.members.col.plan"), card: "meta", cell: (r) => dash(r.current?.planName) },
      {
        id: "endsOn",
        header: t("memberships.members.col.endsOn"),
        sortable: true,
        card: "right",
        cell: (r) => (r.current ? <EndsOn sub={r.current} expiringDays={expiringDays} /> : <span className="text-muted-foreground">{t("memberships.status.none")}</span>),
      },
      {
        id: "sessions",
        header: t("memberships.members.col.sessions"),
        numeric: true,
        card: "meta",
        cell: (r) => (r.current ? (r.current.sessionsLeft === null ? t("memberships.sessions.unlimitedShort") : r.current.sessionsLeft) : "—"),
        cardCell: (r) => (r.current?.sessionsLeft != null ? t("memberships.sessions.leftN", { count: r.current.sessionsLeft }) : ""),
      },
      {
        id: "lastVisit",
        header: t("memberships.members.col.lastVisit"),
        sortable: true,
        sortDescFirst: true,
        hideBelow: "md",
        cell: (r) => (r.lastVisitAt ? formatDate(r.lastVisitAt) : "—"),
      },
      { id: "joined", header: t("memberships.members.col.joined"), sortable: true, sortDescFirst: true, defaultHidden: true, cell: (r) => formatDate(r.createdAt) },
    ],
    [t, formatDate, expiringDays],
  );

  const st = useServerTable<Member, typeof filters>({
    queryKey: mk.members,
    path: "/memberships/members",
    columns,
    filters,
    defaultSort: "name",
    search: t("memberships.members.search"),
    storageKey: "memberships-members",
  });

  const status = st.filters.status;
  return (
    <Page>
      <PageHeading
        title={t("memberships.members.title")}
        description={st.total !== undefined ? t("memberships.members.count", { count: st.total }) : t("memberships.members.description")}
        actions={
          <>
            {desk && (
              <Button asChild variant="outline">
                <ModuleLink to="checkin">
                  <ScanLineIcon /> {t("memberships.nav.checkin")}
                </ModuleLink>
              </Button>
            )}
            {canManage && (
              <Button onClick={() => setAdding(true)}>
                <UserPlusIcon /> {t("memberships.member.addTitle")}
              </Button>
            )}
          </>
        }
      />
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("memberships.members.filterStatus")}
            value={status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : ""}
            onChange={(v) => status.set(v === "all" ? [] : [v])}
            options={[
              { value: "all", label: t("memberships.common.all") },
              ...MEMBER_STATUSES.map((s) => ({ value: s, label: t(`memberships.status.${s}`), meta: st.facets?.status?.[s] })),
            ]}
          />
        }
      />
      <DataTable
        table={st.table}
        onRowClick={(r) => navigate(`m/${r.id}`)}
        empty={
          <EmptyState
            icon={UsersIcon}
            title={t("memberships.members.emptyTitle")}
            description={t("memberships.members.emptyBody")}
            action={
              canManage && (
                <Button onClick={() => setAdding(true)}>
                  <UserPlusIcon /> {t("memberships.member.addTitle")}
                </Button>
              )
            }
          />
        }
      />
      <MemberDialog open={adding} onOpenChange={setAdding} />
    </Page>
  );
}
