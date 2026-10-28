"use client";

import * as React from "react";
import { Loader2Icon, MessageCircleIcon, PhoneIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog, DetailRow, describeError, Page, PageHeading, useI18n, useModuleNavigate, useRouteParams } from "@srirealtime/web";
import { EnquiryStatusPill, InlineError, useAgo, useStatusLabel } from "../components/bits";
import { phoneLabel, telUrl, whatsappUrl } from "../lib/format";
import { useIsSchool } from "../lib/pack";
import { useEnquiry, useEnquiryActions } from "../lib/queries";
import { ENQUIRY_STATUSES, type Enquiry, type EnquiryStatus } from "../lib/types";

export default function EnquiryPage() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const q = useEnquiry(id);
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
  return <EnquiryView enquiry={q.data} />;
}

function EnquiryView({ enquiry: e }: { enquiry: Enquiry }) {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const school = useIsSchool();
  const ago = useAgo();
  const statusLabel = useStatusLabel();
  const { update, remove } = useEnquiryActions(e.id);
  const [note, setNote] = React.useState(e.note ?? "");
  const [deleting, setDeleting] = React.useState(false);
  React.useEffect(() => setNote(e.note ?? ""), [e.note]);
  const noteDirty = note.trim() !== (e.note ?? "").trim();

  const setStatus = async (status: EnquiryStatus) => {
    try {
      await update.mutateAsync({ status });
      toast.success(t("enquiries.detail.statusSaved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const saveNote = async () => {
    try {
      await update.mutateAsync({ note: note.trim() || null });
      toast.success(t("enquiries.detail.noteSaved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const doDelete = async () => {
    try {
      await remove.mutateAsync();
      toast.success(t("enquiries.detail.deleted"));
      navigate("");
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const when = (iso: string) => formatDate(iso, { dateStyle: "medium", timeStyle: "short" });
  return (
    <Page>
      <PageHeading
        back={{ href: "", label: t("enquiries.nav.enquiries") }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {e.name}
            <EnquiryStatusPill status={e.status} />
          </span>
        }
        description={`${e.number} · ${ago(e.createdAt)}`}
        actions={
          <>
            <Button asChild size="lg">
              <a href={telUrl(e.phone)}>
                <PhoneIcon /> {t("enquiries.detail.call")}
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={whatsappUrl(e.phone)} target="_blank" rel="noopener noreferrer">
                <MessageCircleIcon /> {t("enquiries.detail.whatsapp")}
              </a>
            </Button>
          </>
        }
      />
      <div className="grid gap-section lg:grid-cols-3">
        <div className="grid content-start gap-section lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("enquiries.detail.details")}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <DetailRow label={t("enquiries.detail.phone")}>
                <a className="tabular-nums hover:underline" href={telUrl(e.phone)}>
                  {phoneLabel(e.phone)}
                </a>
              </DetailRow>
              <DetailRow label={t("enquiries.detail.email")}>
                {e.email ? (
                  <a className="hover:underline" href={`mailto:${e.email}`}>
                    {e.email}
                  </a>
                ) : (
                  "—"
                )}
              </DetailRow>
              <DetailRow label={t("enquiries.detail.topic")}>{e.topic ?? "—"}</DetailRow>
              <DetailRow label={t(school ? "enquiries.detail.studentSchool" : "enquiries.detail.student")}>{e.studentName ?? "—"}</DetailRow>
              <DetailRow label={t("enquiries.detail.option")}>{e.option ?? "—"}</DetailRow>
              <DetailRow label={t("enquiries.detail.message")}>
                <span className="whitespace-pre-wrap">{e.message ?? "—"}</span>
              </DetailRow>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("enquiries.detail.noteTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Textarea rows={4} maxLength={2000} value={note} placeholder={t("enquiries.detail.notePlaceholder")} onChange={(ev) => setNote(ev.target.value)} />
              <div>
                <Button onClick={saveNote} disabled={!noteDirty || update.isPending}>
                  {update.isPending && <Loader2Icon className="animate-spin" />} {t("enquiries.detail.saveNote")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="grid content-start gap-section">
          <Card>
            <CardHeader>
              <CardTitle>{t("enquiries.detail.status")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Select value={e.status} onValueChange={(v) => void setStatus(v as EnquiryStatus)} disabled={update.isPending}>
                <SelectTrigger aria-label={t("enquiries.detail.status")} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENQUIRY_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {statusLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {e.status === "new" && <p className="text-sm text-muted-foreground">{t("enquiries.detail.statusHint")}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("enquiries.detail.record")}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <DetailRow label={t("enquiries.detail.received")}>{when(e.createdAt)}</DetailRow>
              <DetailRow label={t("enquiries.detail.contacted")}>{e.contactedAt ? when(e.contactedAt) : "—"}</DetailRow>
              <DetailRow label={t("enquiries.detail.source")}>{e.source ?? "—"}</DetailRow>
              <DetailRow label={t("enquiries.detail.notice")}>{e.noticeVersion ?? "—"}</DetailRow>
            </CardContent>
          </Card>
          <Button variant="outline" className="text-destructive" onClick={() => setDeleting(true)}>
            <Trash2Icon /> {t("enquiries.detail.delete")}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("enquiries.detail.deleteTitle", { name: e.name })}
        description={t("enquiries.detail.deleteBody")}
        confirmLabel={t("enquiries.detail.delete")}
        onConfirm={doDelete}
      />
    </Page>
  );
}
