"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, ArrowLeftIcon, Loader2Icon, MegaphoneIcon, PlusIcon, SaveIcon, SendIcon, SparklesIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { Button, EmptyState, Input, PageHeader, Skeleton, StatusPill, Textarea, toast } from "@rbms/ui";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { SuperAdminOnly } from "@/components/superadmin-only";
import { api } from "@/lib/api";
import { describeError, useI18n } from "@/lib/i18n";
import { usePlatformT } from "@/lib/platform-messages";

/** App ids and trades a line can be aimed at (packages/verticals APP_IDS and BUSINESS_TYPES). */
const APPS = [
  { id: "BL", label: "Billing" },
  { id: "EC", label: "Online shop" },
  { id: "PH", label: "Pharmacy" },
  { id: "RS", label: "Restaurant" },
  { id: "SV", label: "Services" },
  { id: "SC", label: "School" },
] as const;
const TRADES = [
  "fashion", "pharmacy", "restaurant", "cloud_kitchen", "grocery", "bakery", "fresh", "electronics", "repair", "salon", "gym", "jewellery", "hardware", "optical", "tailoring", "organic", "footwear", "stationery", "toys", "cosmetics", "crackers", "florist_pooja", "mobile_accessories", "furniture", "home_decor", "pet_shop", "sports", "tea_stall", "spa", "school", "general_shop", "general_counter", "general_services", "textiles_wholesale", "catering", "pet_grooming", "photo_studio", "laundry", "event_decor", "ac_service", "print_shop", "tuition", "dance_music", "yoga", "driving_school", "paints", "electricals", "tiles_sanitary", "two_wheeler_service", "car_service", "agri_inputs", "auto_parts",
];

interface Item {
  id: string;
  en: string;
  ta: string;
  apps: string[];
  trades: string[];
}
interface Note {
  id: string;
  status: "draft" | "published" | "archived";
  titleEn: string;
  titleTa: string;
  items: Item[];
  commits: { sha: string; subject: string; date?: string | null }[];
  source: "paste" | "script";
  sinceRef: string | null;
  removed: { text: string; reason: string }[];
  drafted: boolean;
  createdAt: string;
  publishedAt: string | null;
  warnings?: { text: string; reason: string }[];
}

const KEY = ["platform", "release-notes"] as const;
const tone = { draft: "warning", published: "success", archived: "neutral" } as const;

/** Platform > What's new: commits in, AI-drafted owner notes (en + ta) out, edited and published by a person. */
export default function WhatsNewPage() {
  return (
    <SuperAdminOnly>
      <Notes />
    </SuperAdminOnly>
  );
}

function Notes() {
  const t = usePlatformT();
  const { formatDate } = useI18n();
  const [selected, setSelected] = React.useState<string | "new" | null>(null);
  const q = useQuery({ queryKey: [...KEY, "list"], queryFn: () => api.get<{ items: Note[] }>("/admin/platform/release-notes", undefined, { tenant: null }) });
  return (
    <Page>
      <PageHeader
        title={t("admin.pt.news.title")}
        description={t("admin.pt.news.subtitle")}
        actions={
          <Button size="sm" onClick={() => setSelected("new")}>
            <PlusIcon /> {t("admin.pt.news.new")}
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className={selected ? "hidden content-start gap-2 md:grid" : "grid content-start gap-2"}>
          {q.isError ? (
            <QueryError error={q.error} onRetry={() => void q.refetch()} />
          ) : q.isPending ? (
            <Skeleton className="h-48 rounded-2xl" />
          ) : q.data.items.length === 0 ? (
            <EmptyState icon={MegaphoneIcon} title={t("admin.pt.news.empty")} description={t("admin.pt.news.emptyHint")} />
          ) : (
            <ul className="grid gap-2" data-testid="notes-list">
              {q.data.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(n.id)}
                    className={`grid w-full gap-1 rounded-xl p-3 text-left text-sm ring-1 ${selected === n.id ? "bg-primary/10 ring-primary/40" : "bg-card ring-border hover:bg-accent"}`}
                  >
                    <span className="flex items-center gap-2">
                      <StatusPill tone={tone[n.status]}>{t(`admin.pt.news.status.${n.status}`)}</StatusPill>
                      <span className="text-meta text-muted-foreground">{formatDate(n.publishedAt ?? n.createdAt)}</span>
                    </span>
                    <span className="font-medium break-words">{n.titleEn || n.commits[0]?.subject || "-"}</span>
                    <span className="text-meta text-muted-foreground">
                      {t("admin.pt.news.commits", { n: n.commits.length })}
                      {n.sinceRef ? ` · ${n.sinceRef}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={selected ? "grid content-start gap-3" : "hidden content-start md:grid"}>
          {selected === "new" ? (
            <NewNote onCreated={(id) => setSelected(id)} onBack={() => setSelected(null)} />
          ) : selected ? (
            <Editor key={selected} id={selected} onBack={() => setSelected(null)} />
          ) : (
            <p className="rounded-xl bg-muted/40 p-6 text-sm text-muted-foreground">{t("admin.pt.news.emptyHint")}</p>
          )}
        </div>
      </div>
    </Page>
  );
}

function NewNote({ onCreated, onBack }: { onCreated: (id: string) => void; onBack: () => void }) {
  const t = usePlatformT();
  const { t: tt } = useI18n();
  const qc = useQueryClient();
  const [text, setText] = React.useState("");
  const [since, setSince] = React.useState("");
  const [loaded, setLoaded] = React.useState<Note["commits"] | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<Note>("/admin/platform/release-notes", loaded ? { commits: loaded, source: "script", sinceRef: since || null } : { text, source: "paste", sinceRef: since || null }, { tenant: null }),
    onSuccess: (n) => {
      void qc.invalidateQueries({ queryKey: KEY });
      onCreated(n.id);
    },
    onError: (e) => toast.error(describeError(e, tt)),
  });
  const load = async (file: File) => {
    try {
      const j = JSON.parse(await file.text()) as { commits?: Note["commits"]; sinceRef?: string };
      if (!Array.isArray(j.commits) || j.commits.length === 0) throw new Error("bad");
      setLoaded(j.commits.slice(0, 500));
      setText(j.commits.map((c) => `${c.sha} ${c.subject}`).join("\n"));
      if (j.sinceRef) setSince(j.sinceRef);
    } catch {
      toast.error(t("admin.pt.news.loadFailed"));
    }
  };
  return (
    <form
      className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-border"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <Button type="button" variant="ghost" size="sm" className="justify-self-start md:hidden" onClick={onBack}>
        <ArrowLeftIcon /> {t("admin.pt.support.back")}
      </Button>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">{t("admin.pt.news.paste")}</span>
        <Textarea
          rows={10}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setLoaded(null);
          }}
          className="font-mono text-xs"
        />
        <span className="text-meta text-muted-foreground break-words">{t("admin.pt.news.pasteHint")}</span>
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          <span>{t("admin.pt.news.since")}</span>
          <Input value={since} onChange={(e) => setSince(e.target.value)} maxLength={80} className="w-48" />
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
          <UploadIcon className="size-4" /> {t("admin.pt.news.load")}
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
        </label>
      </div>
      <div>
        <Button type="submit" disabled={create.isPending || !text.trim()}>
          {create.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} {t("admin.pt.news.create")}
        </Button>
      </div>
    </form>
  );
}

function Editor({ id, onBack }: { id: string; onBack: () => void }) {
  const t = usePlatformT();
  const { t: tt } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...KEY, "note", id], queryFn: () => api.get<Note>(`/admin/platform/release-notes/${id}`, undefined, { tenant: null }) });
  const [form, setForm] = React.useState<{ titleEn: string; titleTa: string; items: Item[] } | null>(null);
  React.useEffect(() => {
    if (q.data) setForm({ titleEn: q.data.titleEn, titleTa: q.data.titleTa, items: q.data.items });
  }, [q.data]);
  const refresh = () => void qc.invalidateQueries({ queryKey: KEY });
  const onError = (e: unknown) => toast.error(describeError(e, tt));
  const save = useMutation({
    mutationFn: () => api.put<Note>(`/admin/platform/release-notes/${id}`, form, { tenant: null }),
    onSuccess: () => {
      toast.success(t("admin.pt.news.saved"));
      refresh();
    },
    onError,
  });
  const draft = useMutation({ mutationFn: () => api.post<Note>(`/admin/platform/release-notes/${id}/draft`, {}, { tenant: null }), onSuccess: refresh, onError });
  const publish = useMutation({
    mutationFn: async () => {
      await api.put(`/admin/platform/release-notes/${id}`, form, { tenant: null });
      return api.post<Note>(`/admin/platform/release-notes/${id}/publish`, {}, { tenant: null });
    },
    onSuccess: () => {
      toast.success(t("admin.pt.news.published"));
      refresh();
    },
    onError,
  });
  const archive = useMutation({ mutationFn: () => api.post(`/admin/platform/release-notes/${id}/archive`, {}, { tenant: null }), onSuccess: refresh, onError });

  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isPending || !form) return <Skeleton className="h-96 rounded-2xl" />;
  const n = q.data;
  const editable = n.status === "draft";
  const setItem = (i: number, patch: Partial<Item>) => setForm({ ...form, items: form.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <article className="grid gap-4" data-testid="note-editor">
      <Button variant="ghost" size="sm" className="justify-self-start md:hidden" onClick={onBack}>
        <ArrowLeftIcon /> {t("admin.pt.support.back")}
      </Button>
      <details className="rounded-xl bg-card p-4 text-sm ring-1 ring-border">
        <summary className="cursor-pointer font-medium">
          {t("admin.pt.news.commits", { n: n.commits.length })}
          {n.sinceRef ? ` · ${n.sinceRef}` : ""}
        </summary>
        <ul className="mt-2 grid gap-0.5 font-mono text-xs">
          {n.commits.map((c, i) => (
            <li key={i} className="break-words">
              {c.sha ? `${c.sha} ` : ""}
              {c.subject}
            </li>
          ))}
        </ul>
      </details>

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={draft.isPending} onClick={() => draft.mutate()}>
            {draft.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} {draft.isPending ? t("admin.pt.news.writing") : n.drafted ? t("admin.pt.news.rewrite") : t("admin.pt.news.write")}
          </Button>
        </div>
      )}
      {n.drafted && <p className="rounded-lg bg-primary/5 p-3 text-sm ring-1 ring-primary/20">{t("admin.pt.news.aiNote")}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span>{t("admin.pt.news.titleEn")}</span>
          <Input value={form.titleEn} disabled={!editable} maxLength={120} onChange={(e) => setForm({ ...form, titleEn: e.target.value })} />
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t("admin.pt.news.titleTa")}</span>
          <Input value={form.titleTa} disabled={!editable} maxLength={200} lang="ta" onChange={(e) => setForm({ ...form, titleTa: e.target.value })} />
        </label>
      </div>

      {form.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.pt.news.noLines")}</p>
      ) : (
        <ol className="grid gap-3">
          {form.items.map((it, i) => (
            <li key={it.id} className="grid gap-2 rounded-xl bg-card p-3 ring-1 ring-border">
              <div className="grid gap-2 lg:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span className="text-meta text-muted-foreground">{t("admin.pt.news.lineEn")}</span>
                  <Textarea rows={2} value={it.en} disabled={!editable} maxLength={300} onChange={(e) => setItem(i, { en: e.target.value })} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-meta text-muted-foreground">{t("admin.pt.news.lineTa")}</span>
                  <Textarea rows={2} value={it.ta} disabled={!editable} maxLength={500} lang="ta" onChange={(e) => setItem(i, { ta: e.target.value })} />
                </label>
              </div>
              <div className="grid gap-1">
                <span className="text-meta text-muted-foreground">{t("admin.pt.news.apps")}</span>
                <div className="flex flex-wrap gap-1.5">
                  {APPS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      disabled={!editable}
                      aria-pressed={it.apps.includes(a.id)}
                      onClick={() => setItem(i, { apps: toggle(it.apps, a.id) })}
                      className={`rounded-full px-2.5 py-1 text-xs ring-1 ${it.apps.includes(a.id) ? "bg-primary text-primary-foreground ring-primary" : "bg-background ring-border"}`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-1">
                <span className="text-meta text-muted-foreground">{t("admin.pt.news.trades")}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {it.trades.map((tr) => (
                    <button key={tr} type="button" disabled={!editable} onClick={() => setItem(i, { trades: it.trades.filter((x) => x !== tr) })} className="rounded-full bg-primary px-2.5 py-1 text-xs text-primary-foreground">
                      {tr.replace(/_/g, " ")} ×
                    </button>
                  ))}
                  {editable && (
                    <select
                      className="h-8 rounded-md border bg-background px-2 text-xs"
                      value=""
                      aria-label={t("admin.pt.news.trades")}
                      onChange={(e) => e.target.value && setItem(i, { trades: [...new Set([...it.trades, e.target.value])] })}
                    >
                      <option value="">{it.trades.length ? "+" : t("admin.pt.news.tradesAll")}</option>
                      {TRADES.filter((x) => !it.trades.includes(x)).map((x) => (
                        <option key={x} value={x}>
                          {x.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              {editable && (
                <div>
                  <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, items: form.items.filter((_, j) => j !== i) })}>
                    <Trash2Icon /> {t("admin.pt.news.removeLine")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {(n.warnings?.length ?? 0) > 0 && (
        <div className="grid gap-1 rounded-lg bg-warning/10 p-3 text-sm ring-1 ring-warning/30">
          <p className="font-medium">{t("admin.pt.news.warnings")}</p>
          <ul className="grid list-disc gap-0.5 pl-4">
            {n.warnings!.map((w, i) => (
              <li key={i} className="break-words">
                {w.text}: {w.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {n.removed.length > 0 && (
        <details className="rounded-lg bg-muted/40 p-3 text-sm">
          <summary className="cursor-pointer">
            {t("admin.pt.news.removed")} ({n.removed.length})
          </summary>
          <ul className="mt-1 grid list-disc gap-0.5 pl-4 text-muted-foreground">
            {n.removed.map((r, i) => (
              <li key={i} className="break-words">
                {r.text}: {r.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setForm({ ...form, items: [...form.items, { id: crypto.randomUUID(), en: "", ta: "", apps: [], trades: [] }] })}>
            <PlusIcon /> {t("admin.pt.news.addLine")}
          </Button>
          <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>
            <SaveIcon /> {t("admin.pt.news.save")}
          </Button>
          <Button disabled={publish.isPending || form.items.length === 0} onClick={() => publish.mutate()}>
            {publish.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {t("admin.pt.news.publish")}
          </Button>
        </div>
      ) : (
        n.status === "published" && (
          <div>
            <Button variant="outline" disabled={archive.isPending} onClick={() => archive.mutate()}>
              <ArchiveIcon /> {t("admin.pt.news.archive")}
            </Button>
          </div>
        )
      )}
    </article>
  );
}
