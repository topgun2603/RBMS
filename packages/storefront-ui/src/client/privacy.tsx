"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, Loader2Icon, ShieldCheckIcon } from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { toast } from "@srirealtime/ui/components/sonner";
import { formatDate } from "../lib/format";
import { Empty } from "../components/bits";
import { call, errorMessage } from "./api";
import { useStore } from "./store-context";

/** The shop's current notice, as `GET /v1/consent/notice` answers it (text is shown on /policies/privacy). */
interface NoticeInfo {
  version: number;
  label: string;
  createdAt: string;
  contact: { name: string; role: string; phone: string; email: string; address: string };
  responseDays: number;
}

interface RightsRequest {
  id: string;
  type: string;
  status: string;
  dueAt: string;
  overdue: boolean;
  resolution: string | null;
  hasResult: boolean;
  createdAt: string;
}

const TYPES = ["access", "correction", "erasure", "withdraw_consent", "nominate", "grievance"] as const;
const noticeKey = ["privacy", "notice"] as const;
const useNotice = (enabled = true) => useQuery({ queryKey: noticeKey, queryFn: () => call<NoticeInfo>("/consent/notice", { auth: false }), enabled, staleTime: 5 * 60_000 });

/**
 * Records that the signed-in shopper accepted the shop's privacy notice (and, optionally, other purposes such as
 * `marketing`) with the notice version, in the consent log. Fire and forget: it never blocks sign-in or checkout, and a
 * version already recorded in this browser is not sent again.
 */
export async function recordNoticeAcceptance(purposes: Record<string, boolean> = { privacy_notice: true }) {
  try {
    const n = await call<NoticeInfo>("/consent/notice", { auth: false });
    const key = `sr_consent_${n.label}_${Object.keys(purposes).sort().join(",")}`;
    const only = Object.keys(purposes).length === 1 && "privacy_notice" in purposes;
    if (only && sessionStorage.getItem(key)) return;
    await call("/consent", { method: "POST", body: { purposes, version: n.label, source: "web" } });
    if (only) sessionStorage.setItem(key, "1");
  } catch {
    /* consent logging must never block the shopper */
  }
}

/** "By continuing you accept our privacy notice." for sign-in, checkout and loyalty. */
export function NoticeLine({ className }: { className?: string }) {
  const { t } = useStore();
  return (
    <p className={className ?? "text-center text-xs text-muted-foreground"} data-testid="privacy-notice-line">
      {t("privacy.noticeBefore")}{" "}
      <Link href="/policies/privacy" className="font-medium text-primary underline-offset-2 hover:underline">
        {t("privacy.noticeLink")}
      </Link>
      {t("privacy.noticeAfter")}
    </p>
  );
}

/** The account's Privacy tab: the notice, what was accepted, new requests and their progress. */
export function PrivacyPanel() {
  const { t, locale } = useStore();
  const qc = useQueryClient();
  const notice = useNotice();
  const me = useQuery({ queryKey: ["consent", "me"], queryFn: () => call<{ consents: Record<string, { granted: boolean; version: string; at: string }> }>("/consent/me") });
  const mine = useQuery({ queryKey: ["privacy", "mine"], queryFn: () => call<{ items: RightsRequest[] }>("/consent/rights/mine") });
  const [type, setType] = React.useState<(typeof TYPES)[number]>("access");
  const [details, setDetails] = React.useState("");
  const [nominee, setNominee] = React.useState({ name: "", phone: "", relation: "" });
  const [confirm, setConfirm] = React.useState(false);

  const send = useMutation({
    mutationFn: () =>
      call<{ request: RightsRequest }>("/consent/rights", {
        method: "POST",
        body: {
          type,
          ...(details.trim() ? { details: details.trim() } : {}),
          ...(type === "nominate" ? { nominee: { name: nominee.name.trim(), ...(nominee.phone.trim() ? { phone: nominee.phone.trim() } : {}), ...(nominee.relation.trim() ? { relation: nominee.relation.trim() } : {}) } } : {}),
          ...(type === "withdraw_consent" ? { purposes: ["marketing"] } : {}),
        },
      }),
    onSuccess: ({ request }) => {
      toast.success(request.status === "completed" ? t("privacy.withdrawn") : t("privacy.sent", { date: formatDate(request.dueAt, locale) }));
      setDetails("");
      setConfirm(false);
      setNominee({ name: "", phone: "", relation: "" });
      void qc.invalidateQueries({ queryKey: ["privacy", "mine"] });
      void qc.invalidateQueries({ queryKey: ["consent", "me"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => toast.error(errorMessage(err, t)),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => call(`/consent/rights/mine/${id}/cancel`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["privacy", "mine"] }),
    onError: (err) => toast.error(errorMessage(err, t)),
  });

  const download = async (id: string) => {
    try {
      const data = await call<unknown>(`/consent/rights/mine/${id}/data`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "my-data.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(errorMessage(err, t));
    }
  };

  const accepted = me.data?.consents?.privacy_notice;
  const n = notice.data;
  const c = n?.contact;
  const contact = c ? [c.name && (c.role ? `${c.name} (${c.role})` : c.name), c.phone, c.email].filter(Boolean).join(" · ") : "";
  const canSend = !send.isPending && (type !== "nominate" || nominee.name.trim().length > 0) && (type !== "correction" || details.trim().length > 0) && (type !== "erasure" || confirm);

  return (
    <div className="grid max-w-2xl gap-6" data-testid="privacy-panel">
      <div className="grid gap-2">
        <h2 className="font-display text-xl font-semibold">{t("privacy.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("privacy.intro")}</p>
        <p className="text-sm">
          <Link href="/policies/privacy" className="font-medium text-primary hover:underline">
            {t("privacy.notice")}
          </Link>
          {n && <span className="text-muted-foreground"> · {t("privacy.noticeVersion", { version: n.version, date: formatDate(n.createdAt, locale) })}</span>}
        </p>
        {accepted?.granted && <p className="text-xs text-muted-foreground">{t("privacy.accepted", { version: accepted.version.replace("notice-v", ""), date: formatDate(accepted.at, locale) })}</p>}
      </div>

      <form
        className="grid gap-4 rounded-3xl border bg-card p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) send.mutate();
        }}
      >
        <h3 className="font-semibold">{t("privacy.new")}</h3>
        <div className="grid gap-1.5">
          <label htmlFor="pv-type" className="text-sm font-medium">
            {t("privacy.type")}
          </label>
          <select id="pv-type" value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])} className="h-11 rounded-xl border border-input bg-background px-3 text-sm">
            {TYPES.map((k) => (
              <option key={k} value={k}>
                {t(`privacy.type.${k}`)}
              </option>
            ))}
          </select>
        </div>
        {type === "withdraw_consent" && <p className="text-sm text-muted-foreground">{t("privacy.withdrawNote")}</p>}
        {type === "erasure" && (
          <>
            <p className="text-sm text-muted-foreground">{t("privacy.erasureNote")}</p>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
              {t("privacy.erasureConfirm")}
            </label>
          </>
        )}
        {type === "nominate" && (
          <div className="grid gap-3 sm:grid-cols-3">
            {(["name", "phone", "relation"] as const).map((f) => (
              <input
                key={f}
                aria-label={t(`privacy.nominee${f[0]!.toUpperCase()}${f.slice(1)}`)}
                placeholder={t(`privacy.nominee${f[0]!.toUpperCase()}${f.slice(1)}`)}
                value={nominee[f]}
                onChange={(e) => setNominee({ ...nominee, [f]: e.target.value })}
                className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
              />
            ))}
          </div>
        )}
        {type !== "withdraw_consent" && (
          <div className="grid gap-1.5">
            <label htmlFor="pv-details" className="text-sm font-medium">
              {type === "correction" ? t("privacy.detailsCorrection") : t("privacy.details")}
            </label>
            <textarea id="pv-details" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} rows={3} className="rounded-xl border border-input bg-background px-3 py-2 text-sm" />
          </div>
        )}
        <Button type="submit" className="justify-self-start rounded-full px-6" disabled={!canSend}>
          {send.isPending && <Loader2Icon className="animate-spin" />}
          {t("privacy.submit")}
        </Button>
      </form>

      <div className="grid gap-3">
        <h3 className="font-semibold">{t("privacy.yours")}</h3>
        {mine.data && mine.data.items.length === 0 && <Empty icon={<ShieldCheckIcon />} title={t("privacy.none")} />}
        <ul className="grid gap-2">
          {(mine.data?.items ?? []).map((r) => (
            <li key={r.id} className="grid gap-1 rounded-2xl border p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{t(`privacy.type.${r.type}`)}</span>
                <span className="rounded-full bg-muted px-3 py-0.5 text-xs">{t(`privacy.status.${r.status}`)}</span>
              </div>
              {(r.status === "open" || r.status === "in_progress") && <p className="text-xs text-muted-foreground">{t("privacy.due", { date: formatDate(r.dueAt, locale) })}</p>}
              {r.resolution && (
                <p className="text-xs text-muted-foreground">
                  {t("privacy.resolution")}: {r.resolution}
                </p>
              )}
              <div className="flex gap-2">
                {r.status === "open" && (
                  <Button size="sm" variant="outline" className="rounded-full" onClick={() => cancel.mutate(r.id)}>
                    {t("privacy.cancel")}
                  </Button>
                )}
                {r.type === "access" && r.status === "completed" && r.hasResult && (
                  <Button size="sm" variant="outline" className="rounded-full" onClick={() => void download(r.id)}>
                    <DownloadIcon /> {t("privacy.download")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{t("privacy.grievance")}:</span> {contact || t("privacy.noContact")}
      </p>
    </div>
  );
}
