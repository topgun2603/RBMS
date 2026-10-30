"use client";

import * as React from "react";
import { ArrowLeftIcon, CheckIcon, ClipboardCopyIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { Alert, AlertDescription, Button, Card, CardContent, EmptyState, Field, FieldControl, FieldLabel, Input, Skeleton, StatusPill, Textarea, toast } from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { BREACH_DATA_TYPES, useBreach, useBreachActions, useBreaches, type Breach } from "../../lib/queries-privacy";

const CLOCK_TONE = { ok: "success", due_soon: "warning", overdue: "danger", done: "success" } as const;
const STATUS_TONE = { open: "warning", contained: "info", reported: "success", closed: "neutral" } as const;

/** The 72-hour countdown pill: hours left, overdue, or reported. Exported for the platform admin. */
export function BreachClock({ b }: { b: Breach }) {
  const { t } = useI18n();
  const c = b.countdown;
  const hours = c.hoursLeft === null ? "" : String(Math.abs(Math.round(c.hoursLeft)));
  return <StatusPill tone={CLOCK_TONE[c.state]}>{t(`workspace.privacy.br.clock.${c.state}`, { hours })}</StatusPill>;
}

/** Settings > Privacy & data > Breaches: the register, with the 72-hour clock, checklist and draft notices (en + ta). */
export function BreachesTab() {
  const { t } = useI18n();
  const [open, setOpen] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const list = useBreaches();
  if (open) return <BreachDetail id={open} onBack={() => setOpen(null)} />;
  if (adding) return <NewBreach onDone={() => setAdding(false)} />;
  return (
    <>
      <Card>
        <CardContent className="grid gap-3 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold">{t("workspace.privacy.br.title")}</h3>
              <p className="text-sm text-muted-foreground">{t("workspace.privacy.br.hint")}</p>
            </div>
            <Button onClick={() => setAdding(true)}>
              <PlusIcon /> {t("workspace.privacy.br.new")}
            </Button>
          </div>
          {!!list.data?.openOverdue && <StatusPill tone="danger">{t("workspace.privacy.br.overdueCount", { count: list.data.openOverdue })}</StatusPill>}
        </CardContent>
      </Card>
      {list.isLoading ? (
        <Skeleton className="h-32" />
      ) : list.isError ? (
        <p className="text-sm text-destructive">{t("workspace.privacy.loadError")}</p>
      ) : list.data!.items.length === 0 ? (
        <EmptyState compact title={t("workspace.privacy.br.none")} />
      ) : (
        <ul className="grid gap-2" data-testid="breach-list">
          {list.data!.items.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => setOpen(b.id)} className="grid w-full gap-1 rounded-xl border bg-card p-4 text-left hover:bg-accent/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {b.reference} · {b.title}
                  </span>
                  <StatusPill tone={STATUS_TONE[b.status]}>{t(`workspace.privacy.br.status.${b.status}`)}</StatusPill>
                </div>
                <BreachClock b={b} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function NewBreach({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { create } = useBreachActions();
  const [f, setF] = React.useState({ title: "", description: "", severity: "medium", discovered: "", occurred: "", people: "", containment: "", cause: "" });
  const [types, setTypes] = React.useState<string[]>([]);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <Button variant="ghost" className="justify-self-start" onClick={onDone}>
          <ArrowLeftIcon /> {t("workspace.privacy.br.back")}
        </Button>
        <Alert>
          <AlertDescription>{t("workspace.privacy.br.nosend")}</AlertDescription>
        </Alert>
        <Field>
          <FieldLabel>{t("workspace.privacy.br.field.title")}</FieldLabel>
          <FieldControl>
            <Input value={f.title} maxLength={200} onChange={(e) => set("title", e.target.value)} />
          </FieldControl>
        </Field>
        <Field>
          <FieldLabel>{t("workspace.privacy.br.field.description")}</FieldLabel>
          <FieldControl>
            <Textarea rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} />
          </FieldControl>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field>
            <FieldLabel>{t("workspace.privacy.br.field.severity")}</FieldLabel>
            <select value={f.severity} onChange={(e) => set("severity", e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              {["low", "medium", "high"].map((s) => (
                <option key={s} value={s}>
                  {t(`workspace.privacy.br.severity.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel>{t("workspace.privacy.br.field.discovered")}</FieldLabel>
            <FieldControl>
              <Input type="datetime-local" value={f.discovered} onChange={(e) => set("discovered", e.target.value)} />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>{t("workspace.privacy.br.field.occurred")}</FieldLabel>
            <FieldControl>
              <Input type="datetime-local" value={f.occurred} onChange={(e) => set("occurred", e.target.value)} />
            </FieldControl>
          </Field>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{t("workspace.privacy.br.field.dataTypes")}</legend>
          <div className="flex flex-wrap gap-3">
            {BREACH_DATA_TYPES.map((k) => (
              <label key={k} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={types.includes(k)} onChange={(e) => setTypes(e.target.checked ? [...types, k] : types.filter((x) => x !== k))} />
                {t(`workspace.privacy.br.type.${k}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <Field>
          <FieldLabel>{t("workspace.privacy.br.field.people")}</FieldLabel>
          <FieldControl>
            <Input type="number" min={0} className="w-32" value={f.people} onChange={(e) => set("people", e.target.value)} />
          </FieldControl>
        </Field>
        <Field>
          <FieldLabel>{t("workspace.privacy.br.field.containment")}</FieldLabel>
          <FieldControl>
            <Textarea rows={2} value={f.containment} onChange={(e) => set("containment", e.target.value)} />
          </FieldControl>
        </Field>
        <Field>
          <FieldLabel>{t("workspace.privacy.br.field.cause")}</FieldLabel>
          <FieldControl>
            <Textarea rows={2} value={f.cause} onChange={(e) => set("cause", e.target.value)} />
          </FieldControl>
        </Field>
        <Button
          className="justify-self-start"
          disabled={f.title.trim().length < 3 || create.isPending}
          onClick={() =>
            create.mutate(
              {
                title: f.title.trim(),
                description: f.description.trim(),
                severity: f.severity,
                dataTypes: types,
                containment: f.containment.trim(),
                cause: f.cause.trim(),
                ...(f.discovered ? { discoveredAt: new Date(f.discovered).toISOString() } : {}),
                ...(f.occurred ? { occurredAt: new Date(f.occurred).toISOString() } : {}),
                ...(f.people !== "" ? { peopleAffected: Number(f.people) } : {}),
              },
              {
                onSuccess: () => {
                  toast.success(t("workspace.privacy.br.created"));
                  onDone();
                },
                onError: (e) => toast.error(describeError(e, t)),
              },
            )
          }
        >
          {create.isPending && <Loader2Icon className="animate-spin" />}
          {t("workspace.privacy.br.create")}
        </Button>
      </CardContent>
    </Card>
  );
}

function Draft({ title, en, ta }: { title: string; en: string; ta: string }) {
  const { t } = useI18n();
  const [lang, setLang] = React.useState<"en" | "ta">("en");
  const text = lang === "en" ? en : ta;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        <div className="flex gap-1">
          {(["en", "ta"] as const).map((l) => (
            <Button key={l} size="sm" variant={lang === l ? "default" : "outline"} onClick={() => setLang(l)}>
              {l === "en" ? t("workspace.privacy.notice.english") : t("workspace.privacy.notice.tamil")}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(() => toast.success(t("workspace.privacy.br.copied")));
            }}
          >
            <ClipboardCopyIcon /> {t("workspace.privacy.br.copy")}
          </Button>
        </div>
      </div>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs whitespace-pre-wrap">{text}</pre>
    </div>
  );
}

function BreachDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, formatDate } = useI18n();
  const formatDateTime = (d: string) => formatDate(d, { dateStyle: "medium", timeStyle: "short" });
  const q = useBreach(id);
  const act = useBreachActions();
  const [ref, setRef] = React.useState("");
  const [note, setNote] = React.useState("");
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError || !q.data) return <p className="text-sm text-destructive">{t("workspace.privacy.loadError")}</p>;
  const { incident: b, checklistKeys, drafts } = q.data;
  const closed = b.status === "closed";
  const fail = (e: unknown) => toast.error(describeError(e, t));
  return (
    <div className="grid gap-4">
      <Button variant="ghost" className="justify-self-start" onClick={onBack}>
        <ArrowLeftIcon /> {t("workspace.privacy.br.back")}
      </Button>
      <Card>
        <CardContent className="grid gap-3 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">
              {b.reference} · {b.title}
            </h3>
            <StatusPill tone={STATUS_TONE[b.status]}>{t(`workspace.privacy.br.status.${b.status}`)}</StatusPill>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BreachClock b={b} />
            <span className="text-xs text-muted-foreground">{t("workspace.privacy.br.deadline", { date: formatDateTime(b.countdown.deadlineAt) })}</span>
          </div>
          {b.description && <p className="text-sm">{b.description}</p>}
          <p className="text-xs text-muted-foreground">{b.dataTypes.map((k) => t(`workspace.privacy.br.type.${k}`)).join(", ")}</p>
          <Alert>
            <AlertDescription>{t("workspace.privacy.br.nosend")}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 pt-6">
          <h3 className="font-semibold">{t("workspace.privacy.br.board")}</h3>
          <p className="text-sm text-muted-foreground">{t("workspace.privacy.br.board.hint")}</p>
          <p className="text-sm">
            {t("workspace.privacy.br.board.intimation")}: {b.boardIntimatedAt ? formatDateTime(b.boardIntimatedAt) : t("workspace.privacy.br.notNotified")}
            <br />
            {t("workspace.privacy.br.board.report")}: {b.boardReportedAt ? formatDateTime(b.boardReportedAt) : t("workspace.privacy.br.notNotified")}
            {b.boardReference ? ` · ${b.boardReference}` : ""}
          </p>
          {!closed && (
            <div className="flex flex-wrap items-end gap-2">
              <Field>
                <FieldLabel>{t("workspace.privacy.br.board.ref")}</FieldLabel>
                <FieldControl>
                  <Input value={ref} onChange={(e) => setRef(e.target.value)} />
                </FieldControl>
              </Field>
              {!b.boardIntimatedAt && (
                <Button variant="outline" onClick={() => act.board.mutate({ id, stage: "intimation", reference: ref.trim() || undefined }, { onError: fail })}>
                  {t("workspace.privacy.br.board.markIntimation")}
                </Button>
              )}
              {!b.boardReportedAt && (
                <Button onClick={() => act.board.mutate({ id, stage: "report", reference: ref.trim() || undefined }, { onError: fail })}>{t("workspace.privacy.br.board.markReport")}</Button>
              )}
            </div>
          )}
          <p className="text-sm">
            {t("workspace.privacy.br.notified")}: {b.peopleNotifiedAt ? formatDateTime(b.peopleNotifiedAt) : t("workspace.privacy.br.notNotified")}
          </p>
          {!closed && !b.peopleNotifiedAt && (
            <div className="flex gap-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} aria-label={t("workspace.privacy.br.markNotified")} />
              <Button variant="outline" onClick={() => act.notified.mutate({ id, note: note.trim() || undefined }, { onError: fail })}>
                {t("workspace.privacy.br.markNotified")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 pt-6">
          <h3 className="font-semibold">{t("workspace.privacy.br.checklist")}</h3>
          <ul className="grid gap-1.5">
            {checklistKeys.map((k) => (
              <li key={k}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!b.checklist[k]}
                    disabled={closed}
                    onChange={(e) => act.tick.mutate({ id, key: k, done: e.target.checked }, { onError: fail })}
                  />
                  <span>{t(`workspace.privacy.br.check.${k}`)}</span>
                  {b.checklist[k] && <CheckIcon className="mt-0.5 size-3.5 text-success-ink" />}
                </label>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <h3 className="font-semibold">{t("workspace.privacy.br.drafts")}</h3>
          <Draft title={t("workspace.privacy.br.draft.people")} en={drafts.people.en} ta={drafts.people.ta} />
          <Draft title={t("workspace.privacy.br.draft.board")} en={drafts.board.en} ta={drafts.board.ta} />
        </CardContent>
      </Card>

      {!closed && (
        <div className="grid gap-1">
          <Button variant="outline" className="justify-self-start" disabled={!b.boardReportedAt || act.close.isPending} onClick={() => act.close.mutate(id, { onError: fail })}>
            {t("workspace.privacy.br.closeIncident")}
          </Button>
          {!b.boardReportedAt && <p className="text-xs text-muted-foreground">{t("workspace.privacy.br.closeNeedsReport")}</p>}
        </div>
      )}
    </div>
  );
}
