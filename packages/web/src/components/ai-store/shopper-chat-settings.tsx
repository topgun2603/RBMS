"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { Button, Input, Label, Switch, toast } from "@rbms/ui";
import { api } from "../../lib/api";
import { describeError, useI18n } from "../../lib/i18n";

interface ChatSettings {
  enabled: boolean;
  dailyCredits: number;
  usedToday: number;
  available: boolean;
  reason: string | null;
}

const KEY = ["ai", "store", "chat-settings"] as const;

/**
 * Settings > AI: the shop's switch for the shopper chat on its online store and the daily credit limit. The helper stays off until
 * the owner switches it on here (or in the helper list); owners and admins only (the API checks the role).
 */
export function ShopperChatSettings({ aiEnabled, canEdit }: { aiEnabled: boolean; canEdit: boolean }) {
  const { t, formatNumber } = useI18n();
  const qc = useQueryClient();
  const q = useQuery<ChatSettings>({ queryKey: KEY, queryFn: () => api.get("/ai/store/chat/settings"), retry: false });
  const [cap, setCap] = React.useState<string>("");
  React.useEffect(() => {
    if (q.data) setCap(String(q.data.dailyCredits));
  }, [q.data?.dailyCredits]);
  const save = useMutation({
    mutationFn: (p: { enabled?: boolean; dailyCredits?: number }) => api.put<ChatSettings>("/ai/store/chat/settings", p),
    onSuccess: async (r) => {
      qc.setQueryData(KEY, r);
      await qc.invalidateQueries({ queryKey: ["ai", "status"] });
      toast.success(t("web.aiStore.chat.saved"));
    },
    onError: (e) => toast.error(describeError(e, t)),
  });
  if (q.isError || !q.data) return null;
  const s = q.data;
  const capNum = Math.max(0, Math.min(100000, Math.round(Number(cap) || 0)));
  return (
    <div className="grid gap-4" data-testid="shopper-chat-settings">
      <p className="text-sm text-muted-foreground">{t("web.aiStore.chat.body")}</p>
      <Label className="flex items-center gap-3 font-normal">
        <Switch
          checked={s.enabled}
          disabled={!canEdit || !aiEnabled || save.isPending}
          onCheckedChange={(enabled) => save.mutate({ enabled })}
          aria-label={t("web.aiStore.chat.switch")}
          data-testid="shopper-chat-switch"
        />
        <span className="font-medium">{t("web.aiStore.chat.switch")}</span>
      </Label>
      {!aiEnabled && <p className="text-sm text-muted-foreground">{t("web.aiStore.chat.needsAi")}</p>}
      <div className="grid gap-1.5">
        <Label htmlFor="shopper-chat-cap">{t("web.aiStore.chat.cap")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input id="shopper-chat-cap" type="number" min={0} max={100000} className="w-32" value={cap} disabled={!canEdit || save.isPending} onChange={(e) => setCap(e.target.value)} />
          <Button type="button" variant="outline" disabled={!canEdit || save.isPending || capNum === s.dailyCredits} onClick={() => save.mutate({ dailyCredits: capNum })}>
            {save.isPending ? <Loader2Icon className="animate-spin" /> : null}
            {t("web.aiStore.chat.save")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("web.aiStore.chat.capHint")}</p>
        <p className="text-xs text-muted-foreground" data-testid="shopper-chat-used">
          {t("web.aiStore.chat.used", { used: formatNumber(s.usedToday), cap: formatNumber(s.dailyCredits) })}
        </p>
      </div>
    </div>
  );
}
