"use client";

import * as React from "react";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import { Button, toast } from "@rbms/ui";
import { api, describeError, sendAiFeedback, useAiAssistAllowed, useI18n } from "@rbms/web";
import type { Importer, Mapping, PreviewResult } from "../../lib/types";

interface MappingResponse {
  mappings: { field: string; column: number | null; confidence: "low" | "medium" | "high"; reason: string }[];
  runId: string;
  credits: number;
}

/**
 * "Suggest mapping with AI" for the import wizard's mapping step. Sends ONLY the header row, up to 5 sample rows (the server
 * masks phones, e-mails and GSTINs) and the importer's target fields. The answer is applied to the mapping the owner is
 * already looking at; nothing is imported until they press Start.
 */
export function SuggestMappingButton({
  importer,
  preview,
  onApply,
}: {
  importer: Importer;
  preview: PreviewResult;
  onApply: (next: Mapping) => void;
}) {
  const { t } = useI18n();
  const allowed = useAiAssistAllowed("importexport.run");
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  if (!allowed) return null;

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const headers = preview.columns.map((c) => c.header);
      const rows = preview.rows.slice(0, 5).map((r) => r.raw.slice(0, headers.length));
      const res = await api.post<MappingResponse>("/ai/assist/mapping", {
        importer: importer.key,
        headers,
        rows,
        fields: importer.columns.map((c) => ({ key: c.key, label: c.label, ...(c.help ? { help: c.help } : {}), ...(c.required ? { required: true } : {}) })),
      });
      const next: Mapping = {};
      let n = 0;
      for (const m of res.mappings) {
        next[m.field] = m.column;
        if (m.column !== null) n++;
      }
      if (n === 0) {
        setNote(t("web.aiAssist.map.none"));
        void sendAiFeedback(res.runId, "rejected").catch(() => undefined);
        return;
      }
      onApply(next);
      const unsure = res.mappings.filter((m) => m.column !== null && m.confidence === "low").map((m) => importer.columns.find((c) => c.key === m.field)?.label ?? m.field);
      setNote(t("web.aiAssist.map.applied", { n }) + (unsure.length ? ` ${t("web.aiAssist.map.low", { list: unsure.join(", ") })}` : ""));
      void sendAiFeedback(res.runId, "accepted").catch(() => undefined);
    } catch (e) {
      toast.error(describeError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void run()} disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} {busy ? t("web.aiAssist.map.busy") : t("web.aiAssist.map.button")}
        </Button>
      </div>
      <p className="text-meta text-muted-foreground">{note ?? t("web.aiAssist.map.hint")}</p>
    </div>
  );
}
