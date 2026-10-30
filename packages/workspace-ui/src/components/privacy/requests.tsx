"use client";

import * as React from "react";
import { ArrowLeftIcon, DownloadIcon, Loader2Icon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { Button, Card, CardContent, EmptyState, Field, FieldControl, FieldLabel, Input, Skeleton, StatusPill, Textarea, toast } from "@rbms/ui";
import { ConfirmDialog, describeError, useI18n } from "@rbms/web";
import { RIGHTS_STATUSES, RIGHTS_TYPES, useRight, useRights, useRightsAction, type RightsRequest, type RightsStatus } from "../../lib/queries-privacy";

const STATUS_TONE: Record<RightsStatus, "info" | "warning" | "success" | "danger" | "neutral"> = {
  open: "warning",
  in_progress: "info",
  completed: "success",
  rejected: "danger",
  cancelled: "neutral",
};

/** Settings > Privacy & data > Requests: the queue of customers' data requests, with due dates, actions and history. */
export function RequestsTab() {
  const { t } = useI18n();
  const [open, setOpen] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const list = useRights({ limit: 50, ...(status ? { status } : {}) });

  if (open) return <RequestDetail id={open} onBack={() => setOpen(null)} />;
  if (adding) return <NewRequest onDone={() => setAdding(false)} />;
  return (
    <>
      <Card>
        <CardContent className="grid gap-3 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold">{t("workspace.privacy.req.title")}</h3>
              <p className="text-sm text-muted-foreground">{t("workspace.privacy.req.hint")}</p>
            </div>
            <Button onClick={() => setAdding(true)}>
              <PlusIcon /> {t("workspace.privacy.req.new")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select aria-label={t("workspace.privacy.req.allStatuses")} value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">{t("workspace.privacy.req.allStatuses")}</option>
              {RIGHTS_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`workspace.privacy.req.status.${s}`)}
                </option>
              ))}
            </select>
            {!!list.data?.overdueCount && <StatusPill tone="danger">{t("workspace.privacy.req.pastDue", { count: list.data.overdueCount })}</StatusPill>}
          </div>
        </CardContent>
      </Card>
      {list.isLoading ? (
        <Skeleton className="h-40" />
      ) : list.isError ? (
        <p className="text-sm text-destructive">{t("workspace.privacy.loadError")}</p>
      ) : list.data!.items.length === 0 ? (
        <EmptyState compact title={t("workspace.privacy.req.none")} />
      ) : (
        <ul className="grid gap-2" data-testid="privacy-requests">
          {list.data!.items.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpen(r.id)} className="grid w-full gap-1 rounded-xl border bg-card p-4 text-left hover:bg-accent/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {t(`workspace.privacy.req.type.${r.type}`)} · {r.subjectName || r.subjectPhone || r.subjectEmail || "—"}
                  </span>
                  <StatusPill tone={STATUS_TONE[r.status]}>{t(`workspace.privacy.req.status.${r.status}`)}</StatusPill>
                </div>
                <DueLine r={r} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function DueLine({ r }: { r: RightsRequest }) {
  const { t, formatDate } = useI18n();
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{t(`workspace.privacy.req.source.${r.source}`)}</span>
      {(r.status === "open" || r.status === "in_progress") && <span>{t("workspace.privacy.req.due", { date: formatDate(r.dueAt) })}</span>}
      {r.overdue && <StatusPill tone="danger">{t("workspace.privacy.req.overdue")}</StatusPill>}
    </p>
  );
}

function NewRequest({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { create } = useRightsAction();
  const [f, setF] = React.useState({ type: "access", name: "", phone: "", email: "", details: "", nomineeName: "", nomineePhone: "", nomineeRelation: "" });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const valid = (f.name.trim() || f.phone.trim() || f.email.trim()) && (f.type !== "nominate" || f.nomineeName.trim()) && (f.type !== "correction" || f.details.trim());
  const input = (k: keyof typeof f, label: string) => (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <FieldControl>
        <Input value={f[k]} onChange={(e) => set(k, e.target.value)} />
      </FieldControl>
    </Field>
  );
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <Button variant="ghost" className="justify-self-start" onClick={onDone}>
          <ArrowLeftIcon /> {t("workspace.privacy.cancel")}
        </Button>
        <h3 className="font-semibold">{t("workspace.privacy.req.new")}</h3>
        <Field>
          <FieldLabel>{t("workspace.privacy.req.type")}</FieldLabel>
          <select value={f.type} onChange={(e) => set("type", e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
            {RIGHTS_TYPES.map((k) => (
              <option key={k} value={k}>
                {t(`workspace.privacy.req.type.${k}`)}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          {input("name", t("workspace.privacy.req.name"))}
          {input("phone", t("workspace.privacy.req.phone"))}
          {input("email", t("workspace.privacy.req.email"))}
        </div>
        {f.type === "nominate" && (
          <div className="grid gap-4 sm:grid-cols-3">
            {input("nomineeName", t("workspace.privacy.req.nomineeName"))}
            {input("nomineePhone", t("workspace.privacy.req.nomineePhone"))}
            {input("nomineeRelation", t("workspace.privacy.req.nomineeRelation"))}
          </div>
        )}
        <Field>
          <FieldLabel>{t("workspace.privacy.req.details")}</FieldLabel>
          <FieldControl>
            <Textarea rows={3} maxLength={2000} value={f.details} onChange={(e) => set("details", e.target.value)} />
          </FieldControl>
        </Field>
        <Button
          className="justify-self-start"
          disabled={!valid || create.isPending}
          onClick={() =>
            create.mutate(
              {
                type: f.type,
                name: f.name.trim() || undefined,
                phone: f.phone.trim() || undefined,
                email: f.email.trim() || undefined,
                details: f.details.trim() || undefined,
                ...(f.type === "nominate" ? { nominee: { name: f.nomineeName.trim(), phone: f.nomineePhone.trim() || undefined, relation: f.nomineeRelation.trim() || undefined } } : {}),
                ...(f.type === "withdraw_consent" ? { purposes: ["marketing"] } : {}),
              },
              {
                onSuccess: () => {
                  toast.success(t("workspace.privacy.req.created"));
                  onDone();
                },
                onError: (e) => toast.error(describeError(e, t)),
              },
            )
          }
        >
          {create.isPending && <Loader2Icon className="animate-spin" />}
          {t("workspace.privacy.req.create")}
        </Button>
      </CardContent>
    </Card>
  );
}

function RequestDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, formatDate } = useI18n();
  const formatDateTime = (d: string) => formatDate(d, { dateStyle: "medium", timeStyle: "short" });
  const q = useRight(id);
  const act = useRightsAction();
  const [note, setNote] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [rejecting, setRejecting] = React.useState(false);
  const [eraseOpen, setEraseOpen] = React.useState(false);
  const [found, setFound] = React.useState<number | null>(null);
  const [erased, setErased] = React.useState<string | null>(null);

  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError || !q.data) return <p className="text-sm text-destructive">{t("workspace.privacy.loadError")}</p>;
  const { request: r, events, result } = q.data;
  const isOpen = r.status === "open" || r.status === "in_progress";
  const fail = (e: unknown) => toast.error(describeError(e, t));
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `data-copy-${r.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-4">
      <Button variant="ghost" className="justify-self-start" onClick={onBack}>
        <ArrowLeftIcon /> {t("workspace.privacy.req.title")}
      </Button>
      <Card>
        <CardContent className="grid gap-3 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{t(`workspace.privacy.req.type.${r.type}`)}</h3>
            <StatusPill tone={STATUS_TONE[r.status]}>{t(`workspace.privacy.req.status.${r.status}`)}</StatusPill>
          </div>
          <p className="text-sm">
            {[r.subjectName, r.subjectPhone, r.subjectEmail].filter(Boolean).join(" · ") || "—"}
          </p>
          <DueLine r={r} />
          {r.details && <p className="rounded-md bg-muted/50 p-3 text-sm">{r.details}</p>}
          {r.nominee && (
            <p className="text-sm">
              {t("workspace.privacy.req.type.nominate")}: {[r.nominee.name, r.nominee.phone, r.nominee.relation].filter(Boolean).join(" · ")}
            </p>
          )}
          {r.resolution && (
            <p className="text-sm">
              <span className="font-medium">{t("workspace.privacy.req.resolution")}:</span> {r.resolution}
            </p>
          )}
          {r.type === "correction" && isOpen && <p className="text-sm text-muted-foreground">{t("workspace.privacy.req.correctionHint")}</p>}
          {erased && <p className="text-sm font-medium">{erased}</p>}

          {isOpen && (
            <div className="flex flex-wrap gap-2">
              {r.status === "open" && (
                <Button variant="outline" onClick={() => act.status.mutate({ id, status: "in_progress" }, { onError: fail })}>
                  {t("workspace.privacy.req.start")}
                </Button>
              )}
              {(r.type === "access" || r.type === "erasure") && (
                <Button
                  variant="outline"
                  disabled={act.locate.isPending}
                  onClick={() => act.locate.mutate(id, { onSuccess: (d) => setFound(d.items.length), onError: fail })}
                >
                  <SearchIcon /> {t("workspace.privacy.req.locate")}
                </Button>
              )}
              {r.type === "access" && (
                <Button variant="outline" disabled={act.access.isPending} onClick={() => act.access.mutate(id, { onSuccess: () => toast.success(t("workspace.privacy.req.accessDone")), onError: fail })}>
                  {act.access.isPending && <Loader2Icon className="animate-spin" />}
                  {t("workspace.privacy.req.access")}
                </Button>
              )}
              {r.type === "erasure" && (
                <Button variant="destructive" onClick={() => setEraseOpen(true)}>
                  <Trash2Icon /> {t("workspace.privacy.req.erase")}
                </Button>
              )}
              {r.type !== "erasure" && (
                <Button onClick={() => act.status.mutate({ id, status: "completed", note: note.trim() || undefined }, { onError: fail })}>{t("workspace.privacy.req.done")}</Button>
              )}
              <Button variant="outline" onClick={() => setRejecting(!rejecting)}>
                {t("workspace.privacy.req.reject")}
              </Button>
            </div>
          )}
          {found !== null && <p className="text-sm text-muted-foreground">{t("workspace.privacy.req.found", { count: found })}</p>}
          {r.type === "access" && !!result && (
            <Button variant="outline" className="justify-self-start" onClick={download}>
              <DownloadIcon /> {t("workspace.privacy.req.download")}
            </Button>
          )}
          {rejecting && isOpen && (
            <div className="grid gap-2">
              <Field>
                <FieldLabel>{t("workspace.privacy.req.reason")}</FieldLabel>
                <FieldControl>
                  <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                </FieldControl>
              </Field>
              <Button variant="destructive" className="justify-self-start" disabled={!reason.trim()} onClick={() => act.status.mutate({ id, status: "rejected", note: reason.trim() }, { onError: fail })}>
                {t("workspace.privacy.req.reject")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 pt-6">
          <h3 className="font-semibold">{t("workspace.privacy.req.timeline")}</h3>
          <ul className="grid gap-2 text-sm" data-testid="privacy-timeline">
            {events.map((e) => (
              <li key={e.id} className="grid gap-0.5 border-l-2 pl-3">
                <span className="font-medium">{t.has(`workspace.privacy.req.event.${e.action}`) ? t(`workspace.privacy.req.event.${e.action}`) : e.action}</span>
                {e.note && <span>{e.note}</span>}
                <span className="text-xs text-muted-foreground">{formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("workspace.privacy.req.addNote")} aria-label={t("workspace.privacy.req.addNote")} />
            <Button
              variant="outline"
              disabled={!note.trim() || act.note.isPending}
              onClick={() =>
                act.note.mutate(
                  { id, note: note.trim() },
                  {
                    onSuccess: () => setNote(""),
                    onError: fail,
                  },
                )
              }
            >
              {t("workspace.privacy.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={eraseOpen}
        onOpenChange={setEraseOpen}
        title={t("workspace.privacy.req.eraseTitle")}
        description={t("workspace.privacy.req.eraseBody")}
        confirmLabel={t("workspace.privacy.req.erase")}
        confirmWord="ERASE"
        onConfirm={async () => {
          const res = await act.erase.mutateAsync(id);
          const kept = res.result.kept;
          setErased(kept.length ? t("workspace.privacy.req.erased", { kept: kept.join("; ") }) : t("workspace.privacy.req.erasedNone"));
        }}
      />
    </div>
  );
}
