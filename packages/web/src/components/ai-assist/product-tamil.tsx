"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { Button, Input, Label, Textarea, toast } from "@rbms/ui";
import { api } from "../../lib/api";
import { describeError, useI18n } from "../../lib/i18n";
import { useAiAssistAllowed } from "./use-assist";

interface Approved {
  items: Record<string, { name: string; description: string | null }>;
}

/**
 * The approved Tamil name and description of one product, editable by hand after approval (the online store shows them
 * to shoppers browsing in Tamil; English is untouched). Saving writes the same approved row the bulk review does. Hidden
 * for people without the AI helpers permission and for products not saved yet.
 */
export function ProductTamilText({ productId }: { productId?: string }) {
  const { t } = useI18n();
  const allowed = useAiAssistAllowed("catalogue.manage");
  const qc = useQueryClient();
  const key = ["ai", "assist", "translations", "approved", productId] as const;
  const current = useQuery<Approved>({
    queryKey: key,
    queryFn: () => api.get<Approved>(`/ai/assist/translations/approved?ids=${productId}`),
    enabled: allowed && !!productId,
    retry: false,
  });
  const saved = productId ? current.data?.items[productId] : undefined;
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  React.useEffect(() => {
    setName(saved?.name ?? "");
    setDescription(saved?.description ?? "");
  }, [saved?.name, saved?.description]);
  const save = useMutation({
    mutationFn: () => api.put(`/ai/assist/translations/product/${productId}`, { name: name.trim() || null, description: description.trim() || null }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["ai", "assist", "translations"] });
      toast.success(t("web.aiAssist.tamil.saved"));
    },
    onError: (e) => toast.error(describeError(e, t)),
  });
  if (!allowed || !productId || current.isError) return null;
  const dirty = name.trim() !== (saved?.name ?? "") || description.trim() !== (saved?.description ?? "");
  const empty = !name.trim() && !description.trim();
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3" data-testid="product-tamil-text">
      <div>
        <p className="text-sm font-medium">{t("web.aiAssist.tamil.title")}</p>
        <p className="text-xs text-muted-foreground">{saved ? t("web.aiAssist.tamil.hintLive") : t("web.aiAssist.tamil.hintNone")}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="product-name-ta">{t("web.aiAssist.tr.nameTa")}</Label>
        <Input id="product-name-ta" lang="ta" maxLength={300} value={name} onChange={(e) => setName(e.target.value)} disabled={current.isLoading} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="product-desc-ta">{t("web.aiAssist.tamil.description")}</Label>
        <Textarea id="product-desc-ta" lang="ta" rows={4} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} disabled={current.isLoading} />
      </div>
      <Button type="button" size="sm" disabled={!dirty || empty || save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? <Loader2Icon className="size-4 animate-spin" /> : null}
        {t("web.aiAssist.tamil.save")}
      </Button>
    </div>
  );
}
