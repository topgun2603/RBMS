"use client";

import * as React from "react";
import { FlaskConicalIcon, KeyRoundIcon, Loader2Icon, PlugZapIcon, ReceiptTextIcon, SaveIcon, ServerIcon, ShieldCheckIcon, SlidersHorizontalIcon, Trash2Icon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  ChipGroup,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
  SuccessCheck,
  Switch,
  toast,
  useReducedMotionSafe,
} from "@rbms/ui";
import { ConfirmDialog, describeError, Page, PageHeading, QueryError, SettingsNav, useFeature, useI18n } from "@rbms/web";
import { InlineError, NoAccess, SectionCard, useCan } from "../components/bits";
import { isValidShopGstin, normalizeId } from "../lib/kyc";
import { useDeleteEInvoiceAccount, useEInvoiceAccount, useSaveEInvoiceAccount } from "../lib/queries/einvoice";
import type { EInvoiceAccount, EInvoiceAccountInput } from "../lib/types";
import { GROWTH_FEATURES, GROWTH_PERMISSIONS } from "../module";

const DEFAULT = "__default";

export default function EInvoiceSettingsPage() {
  const { t } = useI18n();
  const allowed = useCan(GROWTH_PERMISSIONS.einvoice);
  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading icon={ReceiptTextIcon} title={t("growth.einvoice.title")} description={t("growth.einvoice.subtitle")} />
      {allowed ? <AccountLoader /> : <NoAccess permission={GROWTH_PERMISSIONS.einvoice} />}
    </Page>
  );
}

function AccountLoader() {
  const account = useEInvoiceAccount();
  if (account.isError) return <QueryError error={account.error} onRetry={() => void account.refetch()} />;
  if (account.isPending) {
    return (
      <div className="grid gap-section" aria-busy="true">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }
  return <AccountForm key={JSON.stringify(account.data)} account={account.data} />;
}

interface Draft {
  provider: "gsp" | "mock";
  gstin: string;
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
  sandbox: boolean;
  enabled: boolean;
  maxAgeDays: string;
  minHsnDigits: string;
}

const toDraft = (a: EInvoiceAccount, fallbackGstin: string): Draft => ({
  provider: a.provider ?? "gsp",
  gstin: a.gstin ?? fallbackGstin,
  username: a.username ?? "",
  password: "",
  clientId: "",
  clientSecret: "",
  sandbox: a.configured ? a.sandbox : true,
  enabled: a.configured ? a.enabled : true,
  maxAgeDays: a.options.maxAgeDays === null ? "0" : a.options.maxAgeDays !== undefined ? String(a.options.maxAgeDays) : "",
  minHsnDigits: a.options.minHsnDigits ? String(a.options.minHsnDigits) : DEFAULT,
});

function AccountForm({ account }: { account: EInvoiceAccount }) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const ewbOn = useFeature(GROWTH_FEATURES.ewaybill);
  const save = useSaveEInvoiceAccount();
  const del = useDeleteEInvoiceAccount();
  const [d, setD] = React.useState<Draft>(() => toDraft(account, ""));
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [connected, setConnected] = React.useState<null | "ok">(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const set = (p: Partial<Draft>) => {
    setD((x) => ({ ...x, ...p }));
    setConnected(null);
  };

  const gsp = d.provider === "gsp";
  const gstin = normalizeId(d.gstin);
  const errors = {
    gstin: !gstin ? t("growth.common.required") : isValidShopGstin(gstin) ? null : t("growth.einvoice.invalidGstin"),
    username: gsp && !d.username.trim() ? t("growth.common.required") : null,
    password: gsp && !d.password && !account.passwordSet ? t("growth.common.required") : null,
    maxAgeDays: d.maxAgeDays && !(Number.isInteger(Number(d.maxAgeDays)) && Number(d.maxAgeDays) >= 0 && Number(d.maxAgeDays) <= 3650) ? t("growth.einvoice.invalidDays") : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const body = (): EInvoiceAccountInput => {
    const b: EInvoiceAccountInput = { provider: d.provider, gstin, sandbox: d.sandbox, enabled: d.enabled };
    if (gsp) {
      b.username = d.username.trim();
      if (d.password) b.password = d.password;
      if (d.clientId.trim()) b.clientId = d.clientId.trim();
      if (d.clientSecret) b.clientSecret = d.clientSecret;
    }
    if (d.maxAgeDays !== "") b.maxAgeDays = Number(d.maxAgeDays) === 0 ? null : Number(d.maxAgeDays);
    if (d.minHsnDigits !== DEFAULT) b.minHsnDigits = Number(d.minHsnDigits) as 4 | 6 | 8;
    return b;
  };

  const submit = async (mode: "save" | "test") => {
    setSubmitted(true);
    setError(null);
    if (invalid) return;
    if (mode === "test" && gsp && !d.password) {
      setError(t("growth.einvoice.testNeedsPassword"));
      return;
    }
    try {
      await save.mutateAsync(body());
      if (mode === "test" || (gsp && d.password)) setConnected("ok");
      toast.success(mode === "test" ? t("growth.einvoice.connected") : t("growth.einvoice.saved"));
    } catch (err) {
      const msg = describeError(err, t);
      setError(msg);
      toast.error(msg);
    }
  };

  const configured = account.configured;
  return (
    <div className="grid gap-section">
      <motion.div initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-xs sm:flex-row sm:items-center">
        <span className={`icon-chip size-12 shrink-0 rounded-2xl ${configured ? "text-success-ink" : "text-muted-foreground"}`}>
          {configured ? <ShieldCheckIcon className="size-6" /> : <PlugZapIcon className="size-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-heading font-semibold">{configured ? t("growth.einvoice.statusConfigured") : t("growth.einvoice.statusNone")}</p>
          <p className="text-sm text-muted-foreground">
            {account.usingMock ? t("growth.einvoice.usingMock") : configured ? t("growth.einvoice.statusBody", { gstin: account.gstin ?? "" }) : t("growth.einvoice.statusNoneBody")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {configured && (
            <StatusPill tone={account.sandbox ? "warning" : "success"} icon={account.sandbox ? FlaskConicalIcon : ServerIcon}>
              {account.sandbox ? t("growth.einvoice.sandbox") : t("growth.einvoice.production")}
            </StatusPill>
          )}
          {configured && !account.enabled && (
            <StatusPill tone="neutral" icon={SlidersHorizontalIcon}>
              {t("growth.common.inactive")}
            </StatusPill>
          )}
        </div>
      </motion.div>

      <SectionCard icon={KeyRoundIcon} title={t("growth.einvoice.accountTitle")} description={t("growth.einvoice.accountBody")}>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit("save");
          }}
        >
          <Field>
            <FieldLabel htmlFor={null}>{t("growth.einvoice.provider")}</FieldLabel>
            <ChipGroup
              aria-label={t("growth.einvoice.provider")}
              value={d.provider}
              onChange={(v) => set({ provider: v })}
              options={[
                { value: "gsp", label: t("growth.einvoice.providerGsp") },
                { value: "mock", label: t("growth.einvoice.providerMock") },
              ]}
            />
            <FieldHint>{gsp ? t("growth.einvoice.providerGspHint") : t("growth.einvoice.providerMockHint")}</FieldHint>
          </Field>

          <FieldRow cols={2}>
            <Field invalid={submitted && !!errors.gstin}>
              <FieldLabel>{t("growth.einvoice.gstin")}</FieldLabel>
              <FieldControl>
                <Input className="font-mono uppercase" maxLength={15} autoComplete="off" value={d.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} />
              </FieldControl>
              <FieldHint>{t("growth.einvoice.gstinHint")}</FieldHint>
              <FieldError>{submitted ? errors.gstin : null}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor={null}>{t("growth.einvoice.environment")}</FieldLabel>
              <ChipGroup
                aria-label={t("growth.einvoice.environment")}
                value={d.sandbox ? "sandbox" : "production"}
                onChange={(v) => set({ sandbox: v === "sandbox" })}
                options={[
                  { value: "sandbox", label: t("growth.einvoice.sandbox") },
                  { value: "production", label: t("growth.einvoice.production") },
                ]}
              />
              <FieldHint>{d.sandbox ? t("growth.einvoice.sandboxHint") : t("growth.einvoice.productionHint")}</FieldHint>
            </Field>
          </FieldRow>

          {gsp && (
            <motion.div initial={reduced ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="grid gap-4 overflow-hidden">
              <FieldRow cols={2}>
                <Field invalid={submitted && !!errors.username}>
                  <FieldLabel>{t("growth.einvoice.username")}</FieldLabel>
                  <FieldControl>
                    <Input autoComplete="off" value={d.username} onChange={(e) => set({ username: e.target.value })} />
                  </FieldControl>
                  <FieldError>{submitted ? errors.username : null}</FieldError>
                </Field>
                <Field invalid={submitted && !!errors.password}>
                  <FieldLabel>{t("growth.einvoice.password")}</FieldLabel>
                  <FieldControl>
                    <Input type="password" autoComplete="new-password" value={d.password} placeholder={account.passwordSet ? t("growth.einvoice.keepSaved") : ""} onChange={(e) => set({ password: e.target.value })} />
                  </FieldControl>
                  <FieldHint>{account.passwordSet ? t("growth.einvoice.passwordSaved") : t("growth.einvoice.passwordHint")}</FieldHint>
                  <FieldError>{submitted ? errors.password : null}</FieldError>
                </Field>
              </FieldRow>
              <FieldRow cols={2}>
                <Field>
                  <FieldLabel optional={t("growth.common.optional")}>{t("growth.einvoice.clientId")}</FieldLabel>
                  <FieldControl>
                    <Input autoComplete="off" value={d.clientId} placeholder={account.clientCredentialsSet ? t("growth.einvoice.keepSaved") : ""} onChange={(e) => set({ clientId: e.target.value })} />
                  </FieldControl>
                </Field>
                <Field>
                  <FieldLabel optional={t("growth.common.optional")}>{t("growth.einvoice.clientSecret")}</FieldLabel>
                  <FieldControl>
                    <Input type="password" autoComplete="new-password" value={d.clientSecret} placeholder={account.clientCredentialsSet ? t("growth.einvoice.keepSaved") : ""} onChange={(e) => set({ clientSecret: e.target.value })} />
                  </FieldControl>
                  <FieldHint>{t("growth.einvoice.clientHint")}</FieldHint>
                </Field>
              </FieldRow>
            </motion.div>
          )}

          <FieldRow cols={2}>
            <Field invalid={submitted && !!errors.maxAgeDays}>
              <FieldLabel optional={t("growth.common.optional")}>{t("growth.einvoice.maxAge")}</FieldLabel>
              <FieldControl>
                <Input inputMode="numeric" placeholder="30" value={d.maxAgeDays} onChange={(e) => set({ maxAgeDays: e.target.value.replace(/\D/g, "") })} />
              </FieldControl>
              <FieldHint>{t("growth.einvoice.maxAgeHint")}</FieldHint>
              <FieldError>{submitted ? errors.maxAgeDays : null}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("growth.einvoice.minHsn")}</FieldLabel>
              <Select value={d.minHsnDigits} onValueChange={(v) => set({ minHsnDigits: v })}>
                <FieldControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  <SelectItem value={DEFAULT}>{t("growth.einvoice.minHsnDefault")}</SelectItem>
                  {["4", "6", "8"].map((n) => (
                    <SelectItem key={n} value={n}>
                      {t("growth.einvoice.digits", { n })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldHint>{t("growth.einvoice.minHsnHint")}</FieldHint>
            </Field>
          </FieldRow>

          <Field>
            <div className="flex items-start justify-between gap-4 rounded-xl border p-3">
              <div className="space-y-0.5">
                <FieldLabel>{t("growth.einvoice.enabled")}</FieldLabel>
                <p className="text-meta text-muted-foreground">{t("growth.einvoice.enabledHint")}</p>
              </div>
              <FieldControl>
                <Switch checked={d.enabled} onCheckedChange={(v) => set({ enabled: v })} />
              </FieldControl>
            </div>
          </Field>

          {ewbOn && <p className="text-meta text-muted-foreground">{t("growth.einvoice.ewbNote")}</p>}
          {error && <InlineError title={error} />}
          {connected === "ok" && (
            <Alert className="border-success/40 bg-success/10 text-success-ink">
              <SuccessCheck size={20} />
              <AlertTitle>{t("growth.einvoice.connected")}</AlertTitle>
              <AlertDescription className="text-success-ink/90">{t("growth.einvoice.connectedBody")}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
              {t("growth.common.save")}
            </Button>
            {gsp && (
              <Button type="button" variant="outline" disabled={save.isPending} onClick={() => void submit("test")}>
                <PlugZapIcon /> {t("growth.einvoice.test")}
              </Button>
            )}
            {configured && (
              <Button type="button" variant="ghost" className="text-destructive hover:text-destructive sm:ml-auto" onClick={() => setConfirmDelete(true)}>
                <Trash2Icon /> {t("growth.einvoice.remove")}
              </Button>
            )}
          </div>
          {gsp && <p className="text-meta text-muted-foreground">{t("growth.einvoice.testHint")}</p>}
        </form>
      </SectionCard>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("growth.einvoice.removeTitle")}
        description={t("growth.einvoice.removeBody")}
        confirmLabel={t("growth.einvoice.remove")}
        onConfirm={async () => {
          try {
            await del.mutateAsync();
            toast.success(t("growth.einvoice.removed"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </div>
  );
}
