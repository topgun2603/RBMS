"use client";

import * as React from "react";
import { PencilIcon, Trash2Icon, UserPlusIcon, UsersIcon } from "lucide-react";
import { Button, ChipGroup, EmptyState, Skeleton, StatusPill, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@rbms/ui";
import { ConfirmDialog, describeError, Page, PageHeading, useI18n, usePermission, useQueryParams } from "@rbms/web";
import { BranchFilter, InlineError, dash, useBranchName } from "../components/bits";
import { EmployeeDialog } from "../components/employee-dialog";
import { PAYROLL_PERMISSIONS } from "../lib/access";
import { money } from "../lib/format";
import { useDeleteEmployee, useEmployees } from "../lib/queries";
import type { Employee } from "../lib/types";

/** Staff records. Salary columns only for payroll managers. */
export default function PeoplePage() {
  return (
    <React.Suspense fallback={null}>
      <People />
    </React.Suspense>
  );
}

function People() {
  const { t, formatDate } = useI18n();
  const params = useQueryParams();
  const canManage = usePermission(PAYROLL_PERMISSIONS.manage);
  const [status, setStatus] = React.useState<"active" | "left" | "all">("active");
  const [branchId, setBranchId] = React.useState("");
  const list = useEmployees(status, branchId || undefined);
  const remove = useDeleteEmployee();
  const branchName = useBranchName();
  const [editing, setEditing] = React.useState<Employee | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [deleting, setDeleting] = React.useState<Employee | null>(null);
  const items = list.data?.items ?? [];

  React.useEffect(() => {
    if (params.get("add") === "1" && canManage) setAdding(true);
  }, [params, canManage]);

  return (
    <Page>
      <PageHeading
        title={t("payroll.people.title")}
        description={list.data ? t("payroll.people.count", { count: list.data.total }) : t("payroll.people.description")}
        actions={
          canManage && (
            <Button onClick={() => setAdding(true)}>
              <UserPlusIcon /> {t("payroll.people.add")}
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <ChipGroup
          size="sm"
          aria-label={t("payroll.col.status")}
          value={status}
          onChange={(v) => setStatus(v as typeof status)}
          options={[
            { value: "active", label: t("payroll.people.active") },
            { value: "left", label: t("payroll.people.left") },
            { value: "all", label: t("payroll.common.all") },
          ]}
        />
        <BranchFilter value={branchId} onChange={setBranchId} />
      </div>
      {list.isError ? (
        <InlineError title={describeError(list.error, t)} />
      ) : list.isPending ? (
        <Skeleton className="h-48" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={t("payroll.people.emptyTitle")}
          description={t("payroll.people.emptyBody")}
          action={
            canManage && (
              <Button onClick={() => setAdding(true)}>
                <UserPlusIcon /> {t("payroll.people.add")}
              </Button>
            )
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("payroll.col.code")}</TableHead>
              <TableHead>{t("payroll.col.name")}</TableHead>
              <TableHead>{t("payroll.people.designation")}</TableHead>
              <TableHead>{t("payroll.people.joinDate")}</TableHead>
              {canManage && <TableHead>{t("payroll.people.payType")}</TableHead>}
              {canManage && <TableHead numeric>{t("payroll.col.rate")}</TableHead>}
              {canManage && <TableHead>{t("payroll.people.payMethod")}</TableHead>}
              <TableHead>{t("payroll.people.login")}</TableHead>
              {canManage && <TableHead className="text-right" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono text-meta">{e.code}</TableCell>
                <TableCell>
                  <span className="grid">
                    <span className="font-medium">{e.name}</span>
                    <span className="text-meta text-muted-foreground">{[e.phone, branchName(e.branchId)].filter(Boolean).join(" · ")}</span>
                  </span>
                </TableCell>
                <TableCell>{dash(e.designation)}</TableCell>
                <TableCell>
                  {formatDate(e.joinDate)}
                  {e.leaveDate && (
                    <span className="block text-meta text-muted-foreground">
                      {e.status === "left" ? t("payroll.people.leftOn", { date: formatDate(e.leaveDate) }) : t("payroll.people.leavesOn", { date: formatDate(e.leaveDate) })}
                    </span>
                  )}
                </TableCell>
                {canManage && <TableCell>{t(`payroll.payType.${e.payType}`)}</TableCell>}
                {canManage && (
                  <TableCell numeric>
                    {e.salary?.payType === "daily"
                      ? t("payroll.people.perDay", { amount: money(e.salary.dailyRate) })
                      : e.salary?.payType === "hourly"
                        ? t("payroll.people.perHour", { amount: money(e.salary.hourlyRate) })
                        : money(e.monthlyGross)}
                  </TableCell>
                )}
                {canManage && (
                  <TableCell>
                    {t(`payroll.method.${e.payMethod}`)}
                    {e.accountMasked && <span className="block text-meta text-muted-foreground">{e.accountMasked}</span>}
                  </TableCell>
                )}
                <TableCell>{e.userId ? <StatusPill tone="success">{t("payroll.people.linked")}</StatusPill> : <span className="text-muted-foreground">—</span>}</TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" className="size-8" aria-label={t("payroll.common.edit")} onClick={() => setEditing(e)}>
                      <PencilIcon />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label={t("payroll.common.delete")} onClick={() => setDeleting(e)}>
                      <Trash2Icon />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <EmployeeDialog
        open={adding || !!editing}
        employee={editing}
        onOpenChange={(o) => {
          if (!o) {
            setAdding(false);
            setEditing(null);
          }
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("payroll.people.deleteTitle", { name: deleting?.name ?? "" })}
        description={t("payroll.people.deleteBody")}
        confirmLabel={t("payroll.common.delete")}
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success(t("payroll.people.deleted"));
            setDeleting(null);
          } catch (err) {
            toast.error(describeError(err, t));
          }
        }}
      />
    </Page>
  );
}
