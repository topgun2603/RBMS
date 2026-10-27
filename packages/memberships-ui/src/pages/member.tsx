"use client";

import * as React from "react";
import {
  CalendarIcon,
  CheckCircle2Icon,
  HistoryIcon,
  Loader2Icon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  ReceiptIcon,
  RefreshCwIcon,
  Trash2Icon,
  Undo2Icon,
  XCircleIcon,
} from "lucide-react";
import { Button, Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, InitialsAvatar, Skeleton, toast } from "@srirealtime/ui";
import { ConfirmDialog, DetailRow, describeError, ModuleLink, Page, PageHeading, useFeature, useI18n, useModuleNavigate, usePermission, useRouteParams } from "@srirealtime/web";
import { dash, EndsOn, InlineError, SessionsBar, StatePill } from "../components/bits";
import { MemberDialog } from "../components/member-dialog";
import { ReasonDialog } from "../components/reason-dialog";
import { SellDialog } from "../components/sell-dialog";
import { DESK_ACCESS, MEMBERSHIPS_FEATURES, MEMBERSHIPS_PERMISSIONS } from "../lib/access";
import { membershipsConfig } from "../lib/config";
import { money, phoneLabel } from "../lib/format";
import { useCheckIn, useMember, useMemberActions, useMembershipSettings, useSubscriptionActions, useUndoCheckin } from "../lib/queries";
import type { MemberDetail, Subscription } from "../lib/types";

export default function MemberPage() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const q = useMember(id);
  if (q.isError)
    return (
      <Page>
        <InlineError title={describeError(q.error, t)} />
      </Page>
    );
  if (!q.data)
    return (
      <Page>
        <Skeleton className="h-96" />
      </Page>
    );
  return <MemberView member={q.data} />;
}

function MemberView({ member }: { member: MemberDetail }) {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const canManage = usePermission(MEMBERSHIPS_PERMISSIONS.manage);
  const deskOn = useFeature(MEMBERSHIPS_FEATURES.checkin);
  const deskAllowed = usePermission(DESK_ACCESS);
  const desk = deskOn && deskAllowed;
  const settings = useMembershipSettings();
  const expiringDays = settings.data?.expiringDays ?? 7;
  const checkIn = useCheckIn();
  const undo = useUndoCheckin();
  const { remove } = useMemberActions(member.id);
  const [editing, setEditing] = React.useState(false);
  const [selling, setSelling] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const doCheckIn = async () => {
    try {
      const r = await checkIn.mutateAsync({ memberId: member.id });
      if (r.ok) toast.success(r.sessionsLeft !== null ? t("memberships.checkin.okSessions", { count: r.sessionsLeft }) : t("memberships.checkin.ok"));
      else toast.error(t(`memberships.checkin.reason.${r.reason ?? "no_active_plan"}`));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const cur = member.current;
  const live = cur && (cur.state === "active" || cur.state === "frozen" || cur.state === "upcoming");
  return (
    <Page>
      <PageHeading
        back={{ href: "", label: t("memberships.nav.members") }}
        title={
          <span className="flex items-center gap-3">
            {member.photoUrl ? <img src={member.photoUrl} alt="" className="size-10 rounded-full object-cover" /> : <InitialsAvatar name={member.name} className="size-10" />}
            {member.name}
          </span>
        }
        description={[member.memberCode, phoneLabel(member.phone)].filter(Boolean).join(" · ")}
        actions={
          <>
            {desk && (
              <Button onClick={doCheckIn} disabled={checkIn.isPending}>
                {checkIn.isPending ? <Loader2Icon className="animate-spin" /> : <CheckCircle2Icon />} {t("memberships.member.checkInNow")}
              </Button>
            )}
            {canManage && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <PencilIcon /> {t("memberships.common.edit")}
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-section lg:grid-cols-3">
        <div className="grid content-start gap-section lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("memberships.member.currentPlan")}</CardTitle>
              {canManage && !live && (
                <CardAction>
                  <Button size="sm" onClick={() => setSelling(true)}>
                    <PlusIcon /> {t("memberships.sell.title")}
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {cur ? (
                <CurrentPlan sub={cur} memberId={member.id} expiringDays={expiringDays} canManage={canManage} />
              ) : (
                <EmptyState compact icon={CalendarIcon} title={t("memberships.member.noPlanTitle")} description={t("memberships.member.noPlanBody")} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HistoryIcon className="size-4 text-primary" /> {t("memberships.member.history")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {member.subscriptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("memberships.member.noHistory")}</p>
              ) : (
                <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
                  {member.subscriptions.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2 odd:bg-muted/40">
                      <span className="grid gap-0.5">
                        <span className="font-medium">{s.planName}</span>
                        <span className="text-meta text-muted-foreground tabular-nums">
                          {formatDate(s.startDate)} – {formatDate(s.endDate)}
                          {s.cancelReason ? ` · ${s.cancelReason}` : ""}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-sm tabular-nums">{money(s.price)}</span>
                        {s.invoiceId && (
                          <ModuleLink href={membershipsConfig().invoiceHref(s.invoiceId)} className="text-meta text-primary hover:underline">
                            {t("memberships.member.bill")}
                          </ModuleLink>
                        )}
                        <StatePill state={s.state} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-section">
          <Card>
            <CardHeader>
              <CardTitle>{t("memberships.member.profile")}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-2">
              <DetailRow label={t("memberships.members.col.code")}>
                <span className="font-mono">{member.memberCode}</span>
              </DetailRow>
              <DetailRow label={t("memberships.member.phone")}>{dash(phoneLabel(member.phone))}</DetailRow>
              <DetailRow label={t("memberships.members.col.joined")}>{formatDate(member.createdAt)}</DetailRow>
              <DetailRow label={t("memberships.members.col.lastVisit")}>{member.lastVisitAt ? formatDate(member.lastVisitAt) : "—"}</DetailRow>
              {member.notes && <p className="mt-2 rounded-md bg-muted/40 p-3 text-sm whitespace-pre-line">{member.notes}</p>}
              {canManage && member.subscriptions.length === 0 && (
                <Button variant="ghost" size="sm" className="mt-2 justify-self-start text-destructive" onClick={() => setDeleting(true)}>
                  <Trash2Icon /> {t("memberships.member.delete")}
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("memberships.member.visits")}</CardTitle>
              <CardDescription>{t("memberships.member.visitsBody")}</CardDescription>
            </CardHeader>
            <CardContent>
              {member.checkins.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("memberships.member.noVisits")}</p>
              ) : (
                <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
                  {member.checkins.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40">
                      <span className="grid">
                        <span className="text-sm tabular-nums">{formatDate(c.at, { dateStyle: "medium", timeStyle: "short" })}</span>
                        {c.planName && <span className="text-meta text-muted-foreground">{c.planName}</span>}
                      </span>
                      {canManage && deskOn && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={t("memberships.checkin.undo")}
                          disabled={undo.isPending}
                          onClick={() => undo.mutateAsync(c.id).then(() => toast.success(t("memberships.checkin.undone")), (err) => toast.error(describeError(err, t)))}
                        >
                          <Undo2Icon />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <MemberDialog open={editing} onOpenChange={setEditing} member={member} />
      <SellDialog open={selling} onOpenChange={setSelling} memberId={member.id} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("memberships.member.deleteTitle", { name: member.name })}
        description={t("memberships.member.deleteBody")}
        confirmLabel={t("memberships.member.delete")}
        onConfirm={async () => {
          try {
            await remove.mutateAsync();
            setDeleting(false);
            navigate("");
          } catch (err) {
            toast.error(describeError(err, t));
          }
        }}
      />
    </Page>
  );
}

/** The plan that decides check-in: state, dates, sessions and the actions on it. */
function CurrentPlan({ sub, memberId, expiringDays, canManage }: { sub: Subscription; memberId: string; expiringDays: number; canManage: boolean }) {
  const { t, formatDate } = useI18n();
  const billing = useFeature(MEMBERSHIPS_FEATURES.invoices);
  const a = useSubscriptionActions();
  const [renewing, setRenewing] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      toast.success(ok);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const busy = a.freeze.isPending || a.unfreeze.isPending || a.bill.isPending;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-lg font-semibold">{sub.planName}</span>
        <StatePill state={sub.state} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <DetailRow label={t("memberships.member.period")}>
          <span className="tabular-nums">
            {formatDate(sub.startDate)} – {formatDate(sub.endDate)}
          </span>
        </DetailRow>
        <DetailRow label={t("memberships.members.col.endsOn")}>
          <EndsOn sub={sub} expiringDays={expiringDays} />
        </DetailRow>
        <DetailRow label={t("memberships.members.col.sessions")}>
          <SessionsBar sub={sub} />
        </DetailRow>
        <DetailRow label={t("memberships.member.freezeLeft")}>
          {sub.state === "frozen" && sub.frozenFrom
            ? t("memberships.member.frozenSince", { date: formatDate(sub.frozenFrom) })
            : t("memberships.member.freezeDaysN", { left: sub.freezeDaysLeft, total: sub.freezeDaysAllowed })}
        </DetailRow>
        <DetailRow label={t("memberships.sell.price")}>
          <span className="flex flex-wrap items-center gap-2">
            {money(sub.price)}
            {sub.invoiceId ? (
              <ModuleLink href={membershipsConfig().invoiceHref(sub.invoiceId)} className="text-sm text-primary hover:underline">
                <ReceiptIcon className="inline size-3.5" /> {t("memberships.member.openBill")}
              </ModuleLink>
            ) : (
              <span className="text-meta text-muted-foreground">{t("memberships.member.notBilled")}</span>
            )}
          </span>
        </DetailRow>
      </div>
      {canManage && sub.state !== "cancelled" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setRenewing(true)} disabled={sub.state === "frozen"}>
            <RefreshCwIcon /> {t("memberships.member.renew")}
          </Button>
          {sub.state === "frozen" ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(a.unfreeze.mutateAsync(sub.id), t("memberships.member.unfrozen"))}>
              <PlayIcon /> {t("memberships.member.unfreeze")}
            </Button>
          ) : (
            sub.state === "active" &&
            sub.freezeDaysLeft > 0 && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(a.freeze.mutateAsync({ id: sub.id }), t("memberships.member.frozen"))}>
                <PauseIcon /> {t("memberships.member.freeze")}
              </Button>
            )
          )}
          {billing && !sub.invoiceId && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(a.bill.mutateAsync(sub.id), t("memberships.member.billed"))}>
              <ReceiptIcon /> {t("memberships.member.billNow")}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelling(true)}>
            <XCircleIcon /> {t("memberships.member.cancelPlan")}
          </Button>
        </div>
      )}
      <SellDialog open={renewing} onOpenChange={setRenewing} memberId={memberId} renew={sub} />
      <ReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t("memberships.member.cancelTitle", { plan: sub.planName })}
        description={t("memberships.member.cancelBody")}
        confirmLabel={t("memberships.member.cancelPlan")}
        onConfirm={(reason) => a.cancel.mutateAsync({ id: sub.id, reason }).then(() => toast.success(t("memberships.member.cancelled")))}
      />
    </div>
  );
}
