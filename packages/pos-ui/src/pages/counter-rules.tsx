"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, SlidersHorizontalIcon } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, FieldHint, FieldLabel, Input, InputGroup, InputGroupAddon, InputGroupInput, Skeleton, toast } from "@srirealtime/ui";
import { api, describeError, Page, PageHeading, SettingsNav, useI18n } from "@srirealtime/web";
import { paiseToInput, rupeesToPaise } from "../lib/format";

interface TillSettings {
  varianceLimit: number;
}
interface DisplaySettings {
  welcomeEn: string;
  welcomeTa: string;
  offerEn: string;
  offerTa: string;
}

const useNamespace = <T,>(ns: string) =>
  useQuery({ queryKey: ["pos", "settings", ns], queryFn: () => api<{ values: T }>(`/settings/${ns}`).then((r) => r.values), staleTime: 60_000 });

/**
 * Settings, Counter rules: the cash difference above which closing the day (or handing the drawer over) needs a manager's
 * PIN, and the idle screen's welcome and offer lines for the customer display. Only owners and admins can save.
 */
export default function CounterRulesPage() {
  const { t } = useI18n();
  return (
    <Page>
      <SettingsNav />
      <PageHeading icon={SlidersHorizontalIcon} title={t("pos.rules.title")} description={t("pos.rules.subtitle")} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
        <TillRules />
        <DisplayMessages />
      </div>
    </Page>
  );
}

function TillRules() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useNamespace<TillSettings>("till");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (q.data) setText(paiseToInput(q.data.varianceLimit));
  }, [q.data]);
  const paise = text.trim() === "" ? null : rupeesToPaise(text);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("pos.rules.till.title")}</CardTitle>
        <CardDescription>{t("pos.rules.till.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {q.isPending ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : (
          <Field>
            <FieldLabel>{t("pos.rules.till.limit")}</FieldLabel>
            <InputGroup>
              <InputGroupAddon>₹</InputGroupAddon>
              <InputGroupInput value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" aria-invalid={paise === null} />
            </InputGroup>
            <FieldHint>{t("pos.rules.till.limitHint")}</FieldHint>
          </Field>
        )}
        <div>
          <Button
            type="button"
            disabled={busy || paise === null}
            onClick={async () => {
              if (paise === null) return;
              setBusy(true);
              try {
                await api(`/settings/till/tenant`, { method: "PUT", body: { varianceLimit: paise } });
                await qc.invalidateQueries({ queryKey: ["pos", "settings", "till"] });
                toast.success(t("pos.rules.saved"));
              } catch (err) {
                toast.error(describeError(err, t));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2Icon className="animate-spin" />} {t("pos.rules.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DisplayMessages() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useNamespace<DisplaySettings>("display");
  const [form, setForm] = React.useState<DisplaySettings>({ welcomeEn: "", welcomeTa: "", offerEn: "", offerTa: "" });
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (q.data) setForm({ welcomeEn: q.data.welcomeEn ?? "", welcomeTa: q.data.welcomeTa ?? "", offerEn: q.data.offerEn ?? "", offerTa: q.data.offerTa ?? "" });
  }, [q.data]);
  const set = (k: keyof DisplaySettings) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("pos.rules.display.title")}</CardTitle>
        <CardDescription>{t("pos.rules.display.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {q.isPending ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : (
          <>
            <Field>
              <FieldLabel>{t("pos.rules.display.welcomeEn")}</FieldLabel>
              <Input value={form.welcomeEn} maxLength={80} onChange={set("welcomeEn")} />
            </Field>
            <Field>
              <FieldLabel>{t("pos.rules.display.welcomeTa")}</FieldLabel>
              <Input value={form.welcomeTa} maxLength={80} onChange={set("welcomeTa")} />
            </Field>
            <Field>
              <FieldLabel>{t("pos.rules.display.offerEn")}</FieldLabel>
              <Input value={form.offerEn} maxLength={160} onChange={set("offerEn")} />
            </Field>
            <Field>
              <FieldLabel>{t("pos.rules.display.offerTa")}</FieldLabel>
              <Input value={form.offerTa} maxLength={160} onChange={set("offerTa")} />
            </Field>
          </>
        )}
        <div>
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/settings/display/tenant`, { method: "PUT", body: form });
                await qc.invalidateQueries({ queryKey: ["pos", "settings", "display"] });
                toast.success(t("pos.rules.saved"));
              } catch (err) {
                toast.error(describeError(err, t));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2Icon className="animate-spin" />} {t("pos.rules.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
