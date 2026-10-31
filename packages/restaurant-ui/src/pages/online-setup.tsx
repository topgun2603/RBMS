"use client";

import * as React from "react";
import { BikeIcon, CopyIcon, KeyRoundIcon, LinkIcon, Loader2Icon, PlugIcon, ReceiptIcon, RefreshCwIcon, SearchIcon, SendIcon, Trash2Icon, UploadIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
  Switch,
  toast,
} from "@rbms/ui";
import { describeError, useDebounced, useI18n } from "@rbms/web";
import { InlineError } from "../components/bits";
import { PlatformBadge } from "../components/platform";
import { money } from "../lib/format";
import { useConnectionActions, useConnections, useEcoReport, useMappings, useUnmapped, type Connection, type ConnectionBody, type PushResult, type TaxMode } from "../lib/online";
import { useShopItems } from "../lib/queries";
import { PLATFORMS } from "../lib/types";

/**
 * Settings → Online platforms: connect an aggregator (UrbanPiper, or the manual/test provider), copy the webhook URL,
 * send a test order, switch platforms on/off with their GST treatment, auto-accept with a default prep time, push
 * the menu and item availability, map platform items to the menu, and the GST 9(5) summary.
 */
export default function OnlinePlatformsPage() {
  const { t } = useI18n();
  const conns = useConnections();
  if (conns.isPending) return <Skeleton className="h-96" />;
  if (conns.isError) return <InlineError title={describeError(conns.error, t)} />;
  return (
    <div className="grid gap-section">
      {(conns.data?.items ?? []).map((c) => (
        <ConnectionCard key={c.provider} conn={c} />
      ))}
      <EcoCard />
    </div>
  );
}

function useRun() {
  const { t } = useI18n();
  return async <T,>(p: Promise<T>, ok?: string | ((r: T) => string | null)): Promise<T | undefined> => {
    try {
      const r = await p;
      const msg = typeof ok === "function" ? ok(r) : ok;
      if (msg) toast.success(msg);
      return r;
    } catch (err) {
      toast.error(describeError(err, t));
      return undefined;
    }
  };
}

const copy = (text: string, done: string) =>
  navigator.clipboard?.writeText(text).then(
    () => toast.success(done),
    () => toast.error(text),
  );

function ConnectionCard({ conn: c }: { conn: Connection }) {
  const { t } = useI18n();
  const a = useConnectionActions(c.provider);
  const run = useRun();
  const isUp = c.provider === "urbanpiper";
  const [username, setUsername] = React.useState(c.username ?? "");
  const [apiKey, setApiKey] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [storeRef, setStoreRef] = React.useState(c.storeRef ?? "");
  const [baseUrl, setBaseUrl] = React.useState(c.baseUrl ?? "");
  const [prep, setPrep] = React.useState(String(c.prepMinutes));
  const [shownSecret, setShownSecret] = React.useState<string | null>(null);
  React.useEffect(() => {
    setUsername(c.username ?? "");
    setStoreRef(c.storeRef ?? "");
    setBaseUrl(c.baseUrl ?? "");
    setPrep(String(c.prepMinutes));
  }, [c.username, c.storeRef, c.baseUrl, c.prepMinutes]);

  const save = async (b: ConnectionBody, ok?: string) => {
    const r = await run(a.save.mutateAsync(b), ok);
    if (r?.newWebhookSecret) setShownSecret(r.newWebhookSecret);
    return r;
  };
  const pushMsg = (r: PushResult) => (r.sent ? (r.ok ? t("restaurant.online.setup.pushed", { count: r.items ?? 0 }) : null) : null);
  const afterPush = (r: PushResult | undefined) => {
    if (r && !r.sent) toast.error(r.reason ?? t("restaurant.online.setup.notSent"));
    else if (r && !r.ok) toast.error(r.error ?? t("restaurant.online.setup.notSent"));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <PlugIcon className="size-4 text-primary" /> {t(`restaurant.online.provider.${c.provider}`)}
          {c.configured && <StatusPill tone={c.enabled ? "success" : "neutral"}>{c.enabled ? t("restaurant.online.setup.on") : t("restaurant.online.setup.off")}</StatusPill>}
        </CardTitle>
        <CardDescription>{t(`restaurant.online.provider.${c.provider}Body`)}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {!c.configured ? (
          <Button className="justify-self-start" onClick={() => save({ enabled: true }, t("restaurant.online.setup.connected"))} disabled={a.save.isPending}>
            {a.save.isPending ? <Loader2Icon className="animate-spin" /> : <PlugIcon />} {t("restaurant.online.setup.connect")}
          </Button>
        ) : (
          <>
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={c.enabled} onCheckedChange={(v) => save({ enabled: v })} aria-label={t("restaurant.online.setup.receive")} />
              {t("restaurant.online.setup.receive")}
            </label>

            <section className="grid gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <LinkIcon className="size-4" /> {t("restaurant.online.setup.webhook")}
              </h3>
              <p className="text-meta text-muted-foreground">{t("restaurant.online.setup.webhookBody", { headers: c.signatureHeaders.slice(0, 2).join(" / ") })}</p>
              <div className="flex flex-wrap gap-2">
                <Input readOnly value={c.webhookUrl ?? ""} className="min-w-64 flex-1 font-mono text-xs" aria-label={t("restaurant.online.setup.webhook")} />
                <Button variant="outline" onClick={() => copy(c.webhookUrl ?? "", t("restaurant.online.setup.copied"))}>
                  <CopyIcon /> {t("restaurant.online.setup.copy")}
                </Button>
                <Button variant="ghost" onClick={() => run(a.rotate.mutateAsync({ secret: true }).then((r) => (r.newWebhookSecret ? setShownSecret(r.newWebhookSecret) : undefined)), t("restaurant.online.setup.rotated"))}>
                  <RefreshCwIcon /> {t("restaurant.online.setup.rotate")}
                </Button>
              </div>
              {shownSecret && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-meta">
                  <KeyRoundIcon className="size-4 text-warning" />
                  <span>{t("restaurant.online.setup.secretOnce")}</span>
                  <code className="rounded bg-background px-1.5 py-0.5 font-mono">{shownSecret}</code>
                  <Button size="sm" variant="outline" onClick={() => copy(shownSecret, t("restaurant.online.setup.copied"))}>
                    <CopyIcon /> {t("restaurant.online.setup.copy")}
                  </Button>
                </div>
              )}
              {c.lastError && <p className="text-meta text-destructive">{t("restaurant.online.setup.lastError", { error: c.lastError })}</p>}
              {c.lastWebhookAt && <p className="text-meta text-muted-foreground">{t("restaurant.online.setup.lastWebhook", { at: new Date(c.lastWebhookAt).toLocaleString("en-IN") })}</p>}
            </section>

            {isUp && (
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save(
                    {
                      username: username.trim() || null,
                      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
                      ...(secret.trim() ? { webhookSecret: secret.trim() } : {}),
                      storeRef: storeRef.trim() || null,
                      baseUrl: baseUrl.trim() || null,
                    },
                    t("restaurant.online.setup.saved"),
                  ).then(() => {
                    setApiKey("");
                    setSecret("");
                  });
                }}
              >
                <Field>
                  <FieldLabel>{t("restaurant.online.setup.username")}</FieldLabel>
                  <FieldControl>
                    <Input value={username} maxLength={120} autoComplete="off" onChange={(e) => setUsername(e.target.value)} />
                  </FieldControl>
                </Field>
                <Field>
                  <FieldLabel>{t("restaurant.online.setup.apiKey")}</FieldLabel>
                  <FieldControl>
                    <Input type="password" value={apiKey} autoComplete="new-password" placeholder={c.hasApiKey ? t("restaurant.online.setup.savedSecret") : ""} onChange={(e) => setApiKey(e.target.value)} />
                  </FieldControl>
                </Field>
                <Field>
                  <FieldLabel>{t("restaurant.online.setup.webhookSecret")}</FieldLabel>
                  <FieldControl>
                    <Input type="password" value={secret} autoComplete="new-password" placeholder={c.hasWebhookSecret ? t("restaurant.online.setup.savedSecret") : ""} onChange={(e) => setSecret(e.target.value)} />
                  </FieldControl>
                </Field>
                <Field>
                  <FieldLabel>{t("restaurant.online.setup.storeRef")}</FieldLabel>
                  <FieldControl>
                    <Input value={storeRef} maxLength={120} onChange={(e) => setStoreRef(e.target.value)} />
                  </FieldControl>
                </Field>
                <Field className="sm:col-span-2">
                  <FieldLabel>{t("restaurant.online.setup.baseUrl")}</FieldLabel>
                  <FieldControl>
                    <Input value={baseUrl} maxLength={300} placeholder="https://api.urbanpiper.com" onChange={(e) => setBaseUrl(e.target.value)} />
                  </FieldControl>
                </Field>
                <Button type="submit" className="justify-self-start" disabled={a.save.isPending}>
                  {a.save.isPending && <Loader2Icon className="animate-spin" />} {t("restaurant.online.setup.save")}
                </Button>
              </form>
            )}

            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">{t("restaurant.online.setup.platforms")}</h3>
              <ul className="grid gap-1">
                {PLATFORMS.map((p) => {
                  const s = c.platforms[p];
                  return (
                    <li key={p} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40">
                      <span className="flex items-center gap-3">
                        <Switch checked={s.enabled} onCheckedChange={(v) => save({ platforms: { [p]: { enabled: v } } })} aria-label={t(`restaurant.online.platform.${p}`)} />
                        <PlatformBadge platform={p} />
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <Select value={s.taxMode} onValueChange={(v) => save({ platforms: { [p]: { taxMode: v as TaxMode } } })}>
                          <SelectTrigger className="h-8 w-56" aria-label={t("restaurant.online.setup.taxMode")}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="eco_9_5">{t("restaurant.online.setup.tax.eco_9_5")}</SelectItem>
                            <SelectItem value="restaurant">{t("restaurant.online.setup.tax.restaurant")}</SelectItem>
                          </SelectContent>
                        </Select>
                        {s.taxMode === "eco_9_5" && <GstinInput value={s.gstin} onSave={(gstin) => save({ platforms: { [p]: { gstin } } })} />}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-meta text-muted-foreground">{t("restaurant.online.setup.taxHelp")}</p>
            </section>

            <section className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={c.autoAccept} onCheckedChange={(v) => save({ autoAccept: v })} aria-label={t("restaurant.online.setup.autoAccept")} />
                {t("restaurant.online.setup.autoAccept")}
              </label>
              <span className="flex items-center gap-2 text-sm">
                {t("restaurant.online.setup.prepDefault")}
                <Input
                  className="w-20"
                  inputMode="numeric"
                  aria-label={t("restaurant.online.setup.prepDefault")}
                  value={prep}
                  onChange={(e) => setPrep(e.target.value.replace(/\D/g, ""))}
                  onBlur={() => {
                    const n = Number(prep);
                    if (n >= 5 && n <= 120 && n !== c.prepMinutes) void save({ prepMinutes: n });
                    else setPrep(String(c.prepMinutes));
                  }}
                />
                {t("restaurant.online.setup.min")}
              </span>
            </section>

            <section className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={a.testOrder.isPending} onClick={() => run(a.testOrder.mutateAsync("zomato"), t("restaurant.online.setup.testSent"))}>
                {a.testOrder.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {t("restaurant.online.setup.testOrder")}
              </Button>
              {isUp && (
                <>
                  <Button variant="outline" disabled={a.pushMenu.isPending} onClick={() => run(a.pushMenu.mutateAsync(), pushMsg).then(afterPush)}>
                    {a.pushMenu.isPending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} {t("restaurant.online.setup.pushMenu")}
                  </Button>
                  <Button variant="outline" disabled={a.pushStock.isPending} onClick={() => run(a.pushStock.mutateAsync(), pushMsg).then(afterPush)}>
                    {a.pushStock.isPending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} {t("restaurant.online.setup.pushStock")}
                  </Button>
                </>
              )}
            </section>
            {c.menuPushedAt && <p className="-mt-4 text-meta text-muted-foreground">{t("restaurant.online.setup.menuPushedAt", { at: new Date(c.menuPushedAt).toLocaleString("en-IN") })}</p>}

            <MappingSection conn={c} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GstinInput({ value, onSave }: { value: string | null; onSave: (v: string | null) => void }) {
  const { t } = useI18n();
  const [v, setV] = React.useState(value ?? "");
  React.useEffect(() => setV(value ?? ""), [value]);
  return (
    <Input
      className="h-8 w-48 font-mono text-xs uppercase"
      placeholder={t("restaurant.online.setup.operatorGstin")}
      aria-label={t("restaurant.online.setup.operatorGstin")}
      maxLength={15}
      value={v}
      onChange={(e) => setV(e.target.value.toUpperCase())}
      onBlur={() => {
        const next = v.trim() || null;
        if (next !== value && (next === null || next.length === 15)) onSave(next);
      }}
    />
  );
}

function MappingSection({ conn: c }: { conn: Connection }) {
  const { t } = useI18n();
  const unmapped = useUnmapped(c.provider);
  const mappings = useMappings(c.provider);
  const a = useConnectionActions(c.provider);
  const run = useRun();
  const [picking, setPicking] = React.useState<{ externalId: string; title: string } | null>(null);
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">{t("restaurant.online.setup.mapping")}</h3>
      <p className="text-meta text-muted-foreground">{t("restaurant.online.setup.mappingBody")}</p>
      {(unmapped.data?.items ?? []).length > 0 && (
        <ul className="grid gap-1">
          {unmapped.data!.items.map((u) => (
            <li key={u.externalId} className="grid gap-2 rounded-md bg-warning/10 px-2 py-1.5">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  <span className="font-medium">{u.title}</span> <span className="text-meta text-muted-foreground">· {u.externalId} · {t("restaurant.online.setup.seenN", { count: u.count })}</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => setPicking(picking?.externalId === u.externalId ? null : { externalId: u.externalId, title: u.title })}>
                  <LinkIcon /> {t("restaurant.online.setup.mapTo")}
                </Button>
              </span>
              {picking?.externalId === u.externalId && (
                <ItemPicker
                  initial={u.title}
                  onPick={(itemId) => run(a.map.mutateAsync({ externalId: u.externalId, itemId, title: u.title }), t("restaurant.online.setup.mapped")).then(() => setPicking(null))}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {(mappings.data?.items ?? []).length > 0 && (
        <ul className="grid gap-1">
          {mappings.data!.items.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 odd:bg-muted/40 text-sm">
              <span>
                {m.title ?? m.externalId} <span className="text-meta text-muted-foreground">· {m.externalId}</span>
              </span>
              <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label={t("restaurant.common.remove")} onClick={() => run(a.unmap.mutateAsync(m.id))}>
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ItemPicker({ initial, onPick }: { initial: string; onPick: (itemId: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = React.useState(initial.split(/[\s(]/)[0] ?? "");
  const term = useDebounced(q, 250);
  const items = useShopItems(term, 8);
  return (
    <div className="grid gap-1">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" autoFocus placeholder={t("restaurant.order.searchMenu")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-1">
        {(items.data?.items ?? []).map((i) => (
          <Button key={i.id} size="sm" variant="secondary" onClick={() => onPick(i.id)}>
            {i.name} · {money(i.rate)}
          </Button>
        ))}
      </div>
    </div>
  );
}

const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

function EcoCard() {
  const { t } = useI18n();
  const to = istToday();
  const from = `${to.slice(0, 8)}01`;
  const r = useEcoReport(from, to);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ReceiptIcon className="size-4 text-primary" /> {t("restaurant.online.eco.title")}
        </CardTitle>
        <CardDescription>{t("restaurant.online.eco.body")}</CardDescription>
      </CardHeader>
      <CardContent>
        {r.isPending ? (
          <Skeleton className="h-16" />
        ) : (r.data?.summary ?? []).length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <BikeIcon className="size-4" /> {t("restaurant.online.eco.none")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-meta text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-medium">{t("restaurant.online.eco.platform")}</th>
                <th className="py-1 text-right font-medium">{t("restaurant.online.eco.orders")}</th>
                <th className="py-1 text-right font-medium">{t("restaurant.online.eco.value")}</th>
                <th className="py-1 text-right font-medium">{t("restaurant.online.eco.gst")}</th>
              </tr>
            </thead>
            <tbody>
              {r.data!.summary.map((s) => (
                <tr key={`${s.platform}-${s.operatorGstin ?? ""}`} className="border-t">
                  <td className="py-1.5">
                    <PlatformBadge platform={s.platform} /> {s.operatorGstin && <span className="ml-1 font-mono text-xs text-muted-foreground">{s.operatorGstin}</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{s.orders}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(s.valueOfSupply)}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(s.gst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
