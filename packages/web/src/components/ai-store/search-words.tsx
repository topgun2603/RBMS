"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, PlusIcon, SparklesIcon, XIcon } from "lucide-react";
import { Alert, AlertDescription, Badge, Button, Input, Label, toast } from "@rbms/ui";
import { api } from "../../lib/api";
import { describeError, useI18n } from "../../lib/i18n";
import { usePermission } from "../../app/session";
import { useAiAssistAllowed, useAiAssistStatus } from "../ai-assist/use-assist";

interface AliasDto {
  productId: string;
  aliases: string[];
  source: "ai" | "owner";
  stale: boolean;
  updatedAt: string;
}

const KEY = (id: string | undefined) => ["ai", "store", "aliases", id] as const;
const clean = (s: string) => s.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Search words of one product (Tamil, Tanglish, English, misspellings), shown in the product editor: view, add, remove, save,
 * or write them with the light AI tier (about 2 credits). What the owner saves is kept: a re-run never overwrites it.
 * Searching costs nothing (docs/ai.md, "Phase 4 part B").
 */
export function ProductSearchWords({ productId }: { productId?: string }) {
  const { t } = useI18n();
  const canEdit = usePermission("catalogue.manage");
  const canAi = useAiAssistAllowed("catalogue.manage");
  const status = useAiAssistStatus(canAi);
  const listed = !!status.data?.features.some((f) => f.key === "search-aliases");
  const qc = useQueryClient();
  const current = useQuery<{ alias: AliasDto | null }>({
    queryKey: KEY(productId),
    queryFn: () => api.get(`/ai/store/aliases/${productId}`),
    enabled: canEdit && !!productId,
    retry: false,
  });
  const saved = current.data?.alias ?? null;
  const [words, setWords] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState("");
  React.useEffect(() => setWords(saved?.aliases ?? []), [saved?.aliases, saved?.updatedAt]);

  const save = useMutation({
    mutationFn: () => api.put<{ alias: AliasDto }>(`/ai/store/aliases/${productId}`, { aliases: words }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEY(productId) });
      toast.success(t("web.aiStore.words.saved"));
    },
    onError: (e) => toast.error(describeError(e, t)),
  });
  const write = useMutation({
    mutationFn: () => api.post<{ alias: AliasDto }>(`/ai/store/aliases/${productId}/generate`, { force: true }),
    onSuccess: async (r) => {
      setWords(r.alias.aliases);
      await qc.invalidateQueries({ queryKey: KEY(productId) });
      toast.success(t("web.aiStore.words.written"));
    },
    onError: (e) => toast.error(describeError(e, t)),
  });
  if (!canEdit || current.isError) return null;
  if (!productId) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground" data-testid="product-search-words">
        <p className="font-medium text-foreground">{t("web.aiStore.words.title")}</p>
        <p>{t("web.aiStore.words.saveFirst")}</p>
      </div>
    );
  }
  const add = () => {
    const parts = draft.split(/[,\n]/).map(clean).filter((x) => x.length >= 2 && x.length <= 40);
    if (!parts.length) return;
    setWords((w) => [...new Set([...w, ...parts])].slice(0, 30));
    setDraft("");
  };
  const dirty = JSON.stringify(words) !== JSON.stringify(saved?.aliases ?? []);
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3" data-testid="product-search-words">
      <div>
        <p className="text-sm font-medium">{t("web.aiStore.words.title")}</p>
        <p className="text-xs text-muted-foreground">{t("web.aiStore.words.hint")}</p>
      </div>
      {saved?.stale && (
        <Alert>
          <AlertDescription>{t("web.aiStore.words.stale")}</AlertDescription>
        </Alert>
      )}
      {words.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("web.aiStore.words.none")}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5" data-testid="search-words-list">
          {words.map((w) => (
            <li key={w}>
              <Badge variant="secondary" className="gap-1 pe-1 font-normal">
                <span lang={/[஀-௿]/.test(w) ? "ta" : "en"}>{w}</span>
                <button type="button" onClick={() => setWords((x) => x.filter((y) => y !== w))} aria-label={t("web.aiStore.words.remove", { word: w })} className="rounded-full p-0.5 hover:bg-background">
                  <XIcon className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <div className="grid flex-1 gap-1">
          <Label htmlFor="search-word-add" className="sr-only">
            {t("web.aiStore.words.add")}
          </Label>
          <Input
            id="search-word-add"
            value={draft}
            maxLength={80}
            placeholder={t("web.aiStore.words.add")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
        </div>
        <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}>
          <PlusIcon /> {t("web.aiStore.words.addButton")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          {save.isPending ? <Loader2Icon className="animate-spin" /> : null}
          {t("web.aiStore.words.save")}
        </Button>
        {canAi && listed && (
          <Button type="button" size="sm" variant="outline" onClick={() => write.mutate()} disabled={write.isPending} data-testid="search-words-ai">
            {write.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            {saved ? t("web.aiStore.words.rewrite") : t("web.aiStore.words.write")} <span className="text-muted-foreground">({t("web.aiStore.words.cost")})</span>
          </Button>
        )}
        {saved && <span className="text-xs text-muted-foreground">{saved.source === "owner" ? t("web.aiStore.words.byOwner") : t("web.aiStore.words.byAi")}</span>}
      </div>
    </div>
  );
}

/** Settings > AI card: search words for products that have none yet (estimate first, then a background job). */
export function SearchWordsBackfillCard({ enabled }: { enabled: boolean }) {
  const { t, formatNumber } = useI18n();
  const canAi = useAiAssistAllowed("catalogue.manage");
  const [limit, setLimit] = React.useState(50);
  const est = useQuery<{ count: number; credits: number; remaining: number | null; enough: boolean }>({
    queryKey: ["ai", "store", "aliases-backfill", limit],
    queryFn: () => api.get("/ai/store/aliases-backfill/estimate", { limit }),
    enabled: canAi && enabled,
    retry: false,
  });
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => api.post<{ started: boolean; count: number }>("/ai/store/aliases-backfill", { limit }),
    onSuccess: async () => {
      toast.success(t("web.aiStore.fill.started"));
      await qc.invalidateQueries({ queryKey: ["ai", "store"] });
    },
    onError: (e) => toast.error(describeError(e, t)),
  });
  if (!canAi) return null;
  const e = est.data;
  return (
    <div className="grid gap-3" data-testid="search-words-backfill">
      <p className="text-sm text-muted-foreground">{t("web.aiStore.fill.body")}</p>
      {est.isPending && enabled ? <Loader2Icon className="animate-spin text-muted-foreground" /> : null}
      {e && e.count === 0 && <p className="text-sm text-muted-foreground">{t("web.aiStore.fill.none")}</p>}
      {e && e.count > 0 && (
        <p className="text-sm">
          {e.remaining === null
            ? t("web.aiStore.fill.estimateUnlimited", { count: e.count, credits: e.credits })
            : t("web.aiStore.fill.estimate", { count: e.count, credits: e.credits, remaining: formatNumber(e.remaining) })}
        </p>
      )}
      {e && !e.enough && <p className="text-sm font-medium text-destructive">{t("web.aiStore.fill.notEnough")}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="fill-limit">{t("web.aiStore.fill.limit")}</Label>
          <Input id="fill-limit" type="number" min={1} max={200} value={limit} onChange={(ev) => setLimit(Math.min(200, Math.max(1, Number(ev.target.value) || 1)))} className="w-28" />
        </div>
        <Button type="button" onClick={() => run.mutate()} disabled={!enabled || !e || e.count === 0 || !e.enough || run.isPending}>
          {run.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
          {t("web.aiStore.fill.run", { count: e?.count ?? limit })}
        </Button>
      </div>
    </div>
  );
}
