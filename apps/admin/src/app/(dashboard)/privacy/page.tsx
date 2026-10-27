"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  DownloadIcon,
  FileJsonIcon,
  Loader2Icon,
  ShieldCheckIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UndoIcon,
  XCircleIcon,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Skeleton,
  toast,
} from "@srirealtime/ui";
import { StatusBadge } from "@/components/badges";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { api } from "@/lib/api";
import { humanizeKey } from "@/lib/format";
import { describeError, tOr, useI18n } from "@/lib/i18n";
import { qk } from "@/lib/queries";
import { readStored, writeStored } from "@/lib/session";
import type { ConsentMe, DataRequest } from "@/lib/types";

interface NoticeBody {
  title: string;
  intro: string;
  sections: { id: string; heading: string; paragraphs: string[]; items?: string[] }[];
}
/** RBMS's own privacy notice for shop owners and staff (`GET /v1/consent/notice` without a shop). */
interface PlatformNotice {
  version: number;
  content: { en: NoticeBody; ta: NoticeBody };
  contact: { name: string; role: string; phone: string; email: string; address: string };
}

const LAST_EXPORT_KEY = "sr_last_export";
const OPEN = ["pending", "processing"];

export default function PrivacyPage() {
  const { t, locale, formatDate, formatDateTime } = useI18n();
  const qc = useQueryClient();
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [exportId, setExportId] = React.useState<string | null>(null);
  React.useEffect(() => setExportId(readStored(LAST_EXPORT_KEY)), []);

  const me = useQuery({ queryKey: qk.consentMe, queryFn: () => api.get<ConsentMe>("/consent/me") });

  const notice = useQuery({ queryKey: ["consent", "platform-notice"], queryFn: () => api.get<PlatformNotice>("/consent/notice", undefined, { tenant: null }), staleTime: 5 * 60_000 });

  const exportReq = useQuery({
    queryKey: ["consent", "export", exportId],
    queryFn: () => api.get<DataRequest & { result: unknown }>(`/consent/export/${exportId}`),
    enabled: !!exportId,
    retry: false,
    refetchInterval: (q) => (q.state.data && OPEN.includes(q.state.data.status) ? 5000 : false),
  });

  const requestExport = useMutation({
    mutationFn: () => api.post<{ request: DataRequest }>("/consent/export"),
    onSuccess: ({ request }) => {
      writeStored(LAST_EXPORT_KEY, request.id);
      setExportId(request.id);
      void qc.invalidateQueries({ queryKey: qk.consentMe });
      toast.success(t("admin.privacy.exportRequested"));
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const requestDelete = useMutation({
    mutationFn: () => api.post<{ id: string; scheduledFor: string }>("/consent/delete-account"),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.consentMe });
      toast.success(t("admin.privacy.deleteScheduled", { date: formatDate(r.scheduledFor) }));
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const cancelDelete = useMutation({
    mutationFn: () => api.post("/consent/delete-account/cancel"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.consentMe });
      toast.success(t("admin.privacy.deleteCancelled"));
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const download = () => {
    const data = exportReq.data?.result;
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pendingDelete = me.data?.requests.find((r) => r.type === "delete" && OPEN.includes(r.status));
  const consents = Object.entries(me.data?.consents ?? {});
  const exp = exportReq.data;

  return (
    <Page className="max-w-4xl">
      <PageHeader title={t("admin.privacy.title")} description={t("admin.privacy.subtitle")} />

      {me.isError ? (
        <QueryError error={me.error} onRetry={() => void me.refetch()} />
      ) : (
        <div className="grid gap-6">
          {pendingDelete && (
            <Alert variant="warning">
              <TriangleAlertIcon />
              <AlertTitle>{t("admin.privacy.deletePendingTitle")}</AlertTitle>
              <AlertDescription>
                <p>{t("admin.privacy.deletePending", { date: formatDateTime(pendingDelete.scheduledFor) })}</p>
                <Button size="sm" variant="outline" className="mt-2" disabled={cancelDelete.isPending} onClick={() => cancelDelete.mutate()}>
                  {cancelDelete.isPending ? <Loader2Icon className="animate-spin" /> : <UndoIcon />}
                  {t("admin.privacy.cancelDeletion")}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>{t("admin.privacy.consents")}</CardTitle>
              <CardDescription>{t("admin.privacy.consentsHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              {me.isLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-10" />
                  ))}
                </div>
              ) : consents.length === 0 ? (
                <EmptyState compact icon={ShieldCheckIcon} title={t("admin.privacy.noConsents")} />
              ) : (
                <ul className="divide-y rounded-lg border">
                  {consents.map(([purpose, d]) => (
                    <li key={purpose} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                      {d.granted ? <CheckCircle2Icon className="size-4 text-success" /> : <XCircleIcon className="size-4 text-muted-foreground" />}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{tOr(t, `admin.privacy.purpose.${purpose}`, humanizeKey(purpose))}</div>
                        <div className="text-xs text-muted-foreground">
                          {t("admin.privacy.consentMeta", { version: d.version, date: formatDate(d.at) })}
                        </div>
                      </div>
                      <span className="text-xs font-medium">{d.granted ? t("admin.privacy.granted") : t("admin.privacy.denied")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {notice.data && (
            <Card className="gap-4">
              <CardHeader>
                <CardTitle>{t("admin.dp.platformNotice")}</CardTitle>
                <CardDescription>
                  {t("admin.dp.platformContact").split(" (")[0]}:{" "}
                  {[notice.data.contact.name, notice.data.contact.phone, notice.data.contact.email].filter(Boolean).join(" · ") || "—"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <details>
                  <summary className="cursor-pointer text-sm font-medium">{notice.data.content[locale === "ta" ? "ta" : "en"].title}</summary>
                  <div className="mt-3 grid gap-3 text-sm leading-relaxed" data-testid="platform-notice">
                    <p>{notice.data.content[locale === "ta" ? "ta" : "en"].intro}</p>
                    {notice.data.content[locale === "ta" ? "ta" : "en"].sections.map((sec) => (
                      <div key={sec.id} className="grid gap-1">
                        <h4 className="font-semibold">{sec.heading}</h4>
                        {sec.paragraphs.map((p, i) => (
                          <p key={i}>{p}</p>
                        ))}
                        {sec.items && (
                          <ul className="list-disc space-y-0.5 pl-5">
                            {sec.items.map((it, i) => (
                              <li key={i}>{it}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              </CardContent>
            </Card>
          )}

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>{t("admin.privacy.exportTitle")}</CardTitle>
              <CardDescription>{t("admin.privacy.exportHint")}</CardDescription>
            </CardHeader>
            {exp && (
              <CardContent>
                <div className="flex items-center gap-3 rounded-lg border p-3">
                  <FileJsonIcon className="size-5 text-muted-foreground" />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-medium">{t("admin.privacy.exportRequestedOn", { date: formatDateTime(exp.createdAt) })}</div>
                    {exp.error && <div className="text-xs text-destructive">{exp.error}</div>}
                  </div>
                  <StatusBadge status={exp.status} />
                  {exp.status === "completed" && !!exp.result && (
                    <Button size="sm" onClick={download}>
                      <DownloadIcon /> {t("admin.privacy.download")}
                    </Button>
                  )}
                </div>
              </CardContent>
            )}
            <CardFooter>
              <Button
                variant="outline"
                disabled={requestExport.isPending || (!!exp && OPEN.includes(exp.status))}
                onClick={() => requestExport.mutate()}
              >
                {requestExport.isPending ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
                {t("admin.privacy.requestExport")}
              </Button>
            </CardFooter>
          </Card>

          <Card className="gap-4 border-destructive/40">
            <CardHeader>
              <CardTitle className="text-destructive">{t("admin.privacy.deleteTitle")}</CardTitle>
              <CardDescription>{t("admin.privacy.deleteHint")}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button variant="destructive" disabled={!!pendingDelete || me.isLoading} onClick={() => setDeleteOpen(true)}>
                <Trash2Icon /> {t("admin.privacy.deleteButton")}
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("admin.privacy.deleteConfirmTitle")}
        description={t("admin.privacy.deleteConfirm")}
        confirmWord="DELETE"
        confirmLabel={t("admin.privacy.deleteButton")}
        onConfirm={() => requestDelete.mutateAsync()}
      />
    </Page>
  );
}
