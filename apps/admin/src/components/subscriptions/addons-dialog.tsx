"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CoinsIcon, GiftIcon, Loader2Icon, PuzzleIcon, XIcon } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldHint,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from "@rbms/ui";
import { QueryError } from "@/components/query-state";
import { api } from "@/lib/api";
import { describeError, useI18n } from "@/lib/i18n";
import type { AdminAddonPayment, AdminShopAddon, AdminSubscription, PlanAddon } from "@/lib/types";
import { SUBS_KEY } from "./dialogs";

/** Today in IST as "YYYY-MM-DD" (the date input's min). */
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * A shop's add-ons (super-admin): what it has (paid or complimentary, ending or ended), its add-on payments and
 * credits, a complimentary add-on (or credits pack) until a date, and ending one now.
 */
export function ShopAddonsDialog({ sub, onClose }: { sub: AdminSubscription | null; onClose: () => void }) {
  const { t, formatCurrency, formatDate } = useI18n();
  const qc = useQueryClient();
  const [last, setLast] = React.useState<AdminSubscription | null>(sub);
  React.useEffect(() => {
    if (sub) setLast(sub);
  }, [sub]);
  const s = sub ?? last;
  const tenantId = s?.tenantId ?? "";
  const key = [...SUBS_KEY, "addons", tenantId] as const;
  const state = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ items: AdminShopAddon[]; payments: AdminAddonPayment[]; credits: Record<string, number> }>(`/subscriptions/admin/${tenantId}/addons`, undefined, { tenant: null }),
    enabled: !!sub,
  });
  const catalogue = useQuery({
    queryKey: ["platform", "addons", s?.tenant?.appId ?? ""],
    queryFn: () => api.get<{ items: PlanAddon[] }>("/plans/addons", { all: 1, ...(s?.tenant?.appId ? { app: s.tenant.appId } : {}) }, { tenant: null }),
    enabled: !!sub,
  });
  const [addonId, setAddonId] = React.useState("");
  const [quantity, setQuantity] = React.useState("1");
  const [until, setUntil] = React.useState("");
  React.useEffect(() => {
    if (sub) {
      setAddonId("");
      setQuantity("1");
      setUntil("");
    }
  }, [sub]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: SUBS_KEY });
  };
  const comp = useMutation({
    mutationFn: () => api.post(`/subscriptions/admin/${tenantId}/addons/comp`, { addonId, quantity: Number(quantity) || 1, until: until || null }, { tenant: null }),
    onSuccess: () => {
      toast.success(t("admin.addonsUi.compDone"));
      setAddonId("");
      refresh();
    },
  });
  const end = useMutation({
    mutationFn: (id: string) => api.post(`/subscriptions/admin/${tenantId}/addons/${encodeURIComponent(id)}/end`, {}, { tenant: null }),
    onSuccess: () => {
      toast.success(t("admin.addonsUi.ended"));
      refresh();
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const offered = (catalogue.data?.items ?? []).filter((a) => !a.appId || a.appId === s?.tenant?.appId);
  const chosen = offered.find((a) => a.id === addonId);
  const d = (iso: string | null) => (iso ? formatDate(iso, { day: "numeric", month: "short", year: "numeric" }) : "");
  const rupees = (paise: number) => formatCurrency(paise / 100, { maximumFractionDigits: 2 });
  const active = (state.data?.items ?? []).filter((a) => a.status === "active");
  const ended = (state.data?.items ?? []).filter((a) => a.status !== "active");
  const credits = Object.entries(state.data?.credits ?? {}).filter(([, n]) => n > 0);

  return (
    <Dialog open={!!sub} onOpenChange={(o) => !o && !comp.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg" closeLabel={t("admin.common.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PuzzleIcon className="size-5 text-primary" /> {t("admin.addonsUi.shopTitle", { shop: s?.tenant?.name ?? tenantId.slice(0, 8) })}
          </DialogTitle>
          <DialogDescription>{t("admin.addonsUi.shopHint")}</DialogDescription>
        </DialogHeader>

        {state.isError ? (
          <QueryError error={state.error} onRetry={() => void state.refetch()} />
        ) : state.isPending ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : (
          <div className="grid gap-3 text-sm">
            {active.length === 0 ? (
              <p className="text-muted-foreground">{t("admin.addonsUi.none")}</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {active.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        {a.name} {a.quantity > 1 && <span className="text-muted-foreground">× {a.quantity}</span>}
                        {a.source === "comp" ? (
                          <Badge variant="secondary" className="gap-1">
                            <GiftIcon /> {t("admin.addonsUi.comp")}
                          </Badge>
                        ) : (
                          <Badge variant="outline">{rupees(a.unitPricePaise * a.quantity)} / {a.interval === "yearly" ? t("admin.plans.yearly") : t("admin.plans.monthly")}</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {a.endsAtPeriodEnd
                          ? t("admin.addonsUi.endsOn", { date: d(a.currentPeriodEnd) })
                          : a.currentPeriodEnd
                            ? t(a.source === "comp" ? "admin.addonsUi.compUntil" : "admin.addonsUi.renews", { date: d(a.currentPeriodEnd) })
                            : t("admin.addonsUi.open")}
                        {a.notice && ` · ${a.notice}`}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="text-danger-ink" disabled={end.isPending} onClick={() => end.mutate(a.addonId)}>
                      <XIcon /> {t("admin.addonsUi.end")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {credits.length > 0 && (
              <p className="flex flex-wrap items-center gap-2">
                <CoinsIcon className="size-4 text-primary" aria-hidden />
                {credits.map(([k, n]) => (
                  <Badge key={k} variant="outline" className="font-normal">
                    {k}: {n.toLocaleString("en-IN")}
                  </Badge>
                ))}
              </p>
            )}
            {(ended.length > 0 || (state.data?.payments.length ?? 0) > 0) && (
              <details className="rounded-xl border px-3 py-2">
                <summary className="cursor-pointer text-muted-foreground">{t("admin.addonsUi.history")}</summary>
                <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
                  {ended.map((a) => (
                    <li key={a.id}>
                      {a.name} × {a.quantity} · {t("admin.addonsUi.endedOn", { date: d(a.endedAt) })} · {a.endReason}
                    </li>
                  ))}
                  {state.data?.payments.map((p) => (
                    <li key={p.id}>
                      {p.label} · {rupees(p.chargePaise)} · {p.status}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <form
          className="grid gap-3 rounded-xl border bg-muted/30 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (addonId && !comp.isPending) comp.mutate();
          }}
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <GiftIcon className="size-4 text-primary" /> {t("admin.addonsUi.compTitle")}
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
            <Field>
              <FieldLabel>{t("admin.addonsUi.addon")}</FieldLabel>
              <Select value={addonId} onValueChange={setAddonId}>
                <FieldControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("admin.addonsUi.choose")} />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {offered.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                      {!a.isPublic && ` · ${t("admin.platform.private")}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{chosen?.kind === "credits" ? t("admin.addonsUi.packs") : t("admin.addonsUi.quantity")}</FieldLabel>
              <FieldControl>
                <Input type="number" min={1} max={1000} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </FieldControl>
            </Field>
          </div>
          {chosen?.kind !== "credits" && (
            <Field>
              <FieldLabel>{t("admin.addonsUi.until")}</FieldLabel>
              <FieldControl>
                <Input type="date" min={istToday()} value={until} onChange={(e) => setUntil(e.target.value)} />
              </FieldControl>
              <FieldHint>{t("admin.addonsUi.untilHint")}</FieldHint>
            </Field>
          )}
          {comp.error ? (
            <p role="alert" className="text-sm text-danger-ink">
              {describeError(comp.error, t)}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={!addonId || comp.isPending}>
              {comp.isPending ? <Loader2Icon className="animate-spin" /> : <GiftIcon />} {t("admin.addonsUi.compSave")}
            </Button>
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("admin.common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
