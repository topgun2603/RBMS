"use client";

import * as React from "react";
import { SettingsIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  toast,
} from "@srirealtime/ui";
import { describeError, Page, PageHeading, QueryError, useFeature, useI18n } from "@srirealtime/web";
import { SubmitButton } from "../components/account";
import { bpsToPercent, bpsToPercentInput, commissionExample, money, paiseToInput, percentToBps, rupeesToPaise } from "../lib/logic";
import { useMarketplaceSettings, useSaveMarketplaceSettings } from "../lib/queries";
import { PAYOUT_PROVIDERS, type MarketplaceSettings, type PayoutProvider } from "../lib/types";

interface Draft {
  commission: string;
  returnWindow: string;
  minPayout: string;
  requireKyc: boolean;
  payoutProvider: PayoutProvider;
  acceptApplications: boolean;
}

const toDraft = (s: MarketplaceSettings): Draft => ({
  commission: bpsToPercentInput(s.defaultCommissionBps),
  returnWindow: String(s.returnWindowDays),
  minPayout: paiseToInput(s.minPayoutPaise),
  requireKyc: s.requireKyc,
  payoutProvider: s.payoutProvider,
  acceptApplications: s.acceptApplications,
});

/** Marketplace settings (namespace `marketplace`): default commission, return window, minimum payout, KYC, provider, applications. */
export default function MarketplaceSettingsPage() {
  const { t } = useI18n();
  const q = useMarketplaceSettings();
  return (
    <Page className="max-w-3xl">
      <PageHeading icon={SettingsIcon} title={t("marketplace.settings.title")} description={t("marketplace.settings.subtitle")} />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <Card className="gap-4 p-6">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </Card>
      ) : (
        <SettingsForm initial={q.data} />
      )}
    </Page>
  );
}

function SettingsForm({ initial }: { initial: MarketplaceSettings }) {
  const { t } = useI18n();
  const save = useSaveMarketplaceSettings();
  const kycOn = useFeature("kyc");
  const [d, setD] = React.useState<Draft>(() => toDraft(initial));
  React.useEffect(() => setD(toDraft(initial)), [initial]);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  const bps = percentToBps(d.commission);
  const days = /^\d{1,2}$/.test(d.returnWindow) ? Number(d.returnWindow) : null;
  const min = d.minPayout.trim() === "" ? 0 : rupeesToPaise(d.minPayout);
  const errors = {
    commission: bps === null ? t("marketplace.validation.percent") : null,
    returnWindow: days === null || days > 90 ? t("marketplace.validation.days") : null,
    minPayout: min === null ? t("marketplace.validation.amount") : null,
  };
  const invalid = !!(errors.commission || errors.returnWindow || errors.minPayout);
  const ex = commissionExample(bps ?? 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    try {
      await save.mutateAsync({
        defaultCommissionBps: bps!,
        returnWindowDays: days!,
        minPayoutPaise: min!,
        requireKyc: d.requireKyc,
        payoutProvider: d.payoutProvider,
        acceptApplications: d.acceptApplications,
      });
      toast.success(t("marketplace.common.saved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Card className="py-5">
        <CardContent className="grid gap-5 px-4 sm:px-6">
          <h2 className="font-heading text-base font-semibold">{t("marketplace.settings.money")}</h2>
          <FieldRow>
            <Field invalid={!!errors.commission}>
              <FieldLabel>{t("marketplace.settings.commission")}</FieldLabel>
              <InputGroup>
                <FieldControl>
                  <InputGroupInput value={d.commission} onChange={(e) => set({ commission: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" />
                </FieldControl>
                <InputGroupAddon>%</InputGroupAddon>
              </InputGroup>
              <FieldHint>{t("marketplace.commission.example", { sale: money(ex.sale), commission: money(ex.commission), net: money(ex.net) })}</FieldHint>
              <FieldError>{errors.commission}</FieldError>
            </Field>
            <Field invalid={!!errors.returnWindow}>
              <FieldLabel>{t("marketplace.settings.returnWindow")}</FieldLabel>
              <InputGroup>
                <FieldControl>
                  <InputGroupInput value={d.returnWindow} onChange={(e) => set({ returnWindow: e.target.value.replace(/\D/g, "").slice(0, 2) })} inputMode="numeric" />
                </FieldControl>
                <InputGroupAddon>{t("marketplace.settings.days")}</InputGroupAddon>
              </InputGroup>
              <FieldHint>{t("marketplace.settings.returnWindowHint")}</FieldHint>
              <FieldError>{errors.returnWindow}</FieldError>
            </Field>
          </FieldRow>
          <FieldRow>
            <Field invalid={!!errors.minPayout}>
              <FieldLabel>{t("marketplace.settings.minPayout")}</FieldLabel>
              <InputGroup>
                <InputGroupAddon>₹</InputGroupAddon>
                <FieldControl>
                  <InputGroupInput value={d.minPayout} onChange={(e) => set({ minPayout: e.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" />
                </FieldControl>
              </InputGroup>
              <FieldHint>{t("marketplace.settings.minPayoutHint")}</FieldHint>
              <FieldError>{errors.minPayout}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("marketplace.settings.provider")}</FieldLabel>
              <Select value={d.payoutProvider} onValueChange={(v) => set({ payoutProvider: v as PayoutProvider })}>
                <FieldControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {PAYOUT_PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`marketplace.settings.provider.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldHint>{t(`marketplace.settings.providerHint.${d.payoutProvider}`)}</FieldHint>
            </Field>
          </FieldRow>
        </CardContent>
      </Card>

      <Card className="py-5">
        <CardContent className="grid gap-4 px-4 sm:px-6">
          <h2 className="font-heading text-base font-semibold">{t("marketplace.settings.sellers")}</h2>
          <SwitchRow
            label={t("marketplace.settings.acceptApplications")}
            hint={t("marketplace.settings.acceptApplicationsHint")}
            checked={d.acceptApplications}
            onChange={(v) => set({ acceptApplications: v })}
          />
          <SwitchRow label={t("marketplace.settings.requireKyc")} hint={t("marketplace.settings.requireKycHint")} checked={d.requireKyc} onChange={(v) => set({ requireKyc: v })} />
          {d.requireKyc && !kycOn && (
            <Alert variant="warning">
              <AlertDescription>{t("marketplace.settings.kycOff")}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">{t("marketplace.settings.current", { rate: bpsToPercent(initial.defaultCommissionBps), days: initial.returnWindowDays })}</span>
        <Button type="button" variant="outline" size="lg" onClick={() => setD(toDraft(initial))}>
          {t("marketplace.common.reset")}
        </Button>
        <SubmitButton size="lg" pending={save.isPending} disabled={invalid}>
          {t("marketplace.common.save")}
        </SubmitButton>
      </div>
    </form>
  );
}

function SwitchRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Field>
      <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
        <div className="grid gap-1">
          <FieldLabel>{label}</FieldLabel>
          <FieldHint>{hint}</FieldHint>
        </div>
        <FieldControl>
          <Switch checked={checked} onCheckedChange={onChange} />
        </FieldControl>
      </div>
    </Field>
  );
}
