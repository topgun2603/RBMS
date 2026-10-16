"use client";

import * as React from "react";
import {
  CheckCircle2Icon,
  CircleOffIcon,
  CreditCardIcon,
  ExternalLinkIcon,
  FlaskConicalIcon,
  KeyRoundIcon,
  Loader2Icon,
  LockIcon,
  PencilIcon,
  RocketIcon,
  SaveIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UserPlusIcon,
  WebhookIcon,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AnimatePresence,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  FieldLabel,
  Input,
  Label,
  motion,
  Skeleton,
  Stagger,
  StaggerItem,
  StatusPill,
  Switch,
  toast,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { ApiError, canManageShop, ConfirmDialog, describeError, Page, PageHeading, QueryError, SettingsNav, useI18n, useMe } from "@srirealtime/web";
import { CopyButton } from "../components/copy-button";
import { CardIllustration } from "../components/illustrations";
import { useDeletePaymentAccount, usePaymentAccount, useSavePaymentAccount } from "../lib/queries-v2";
import type { PaymentAccount, PaymentAccountInput } from "../lib/types";

const KEY_RE = /^rzp_(test|live)_[A-Za-z0-9]+$/;

const modeOf = (keyId: string | null | undefined): "test" | "live" | null =>
  keyId?.startsWith("rzp_live_") ? "live" : keyId?.startsWith("rzp_test_") ? "test" : null;

/** rzp_test_AbCdEf1234 → rzp_test_••••1234 */
const maskKey = (keyId: string | null) => {
  if (!keyId) return "—";
  const m = /^(rzp_(?:test|live)_)(.*)$/.exec(keyId);
  if (!m) return `••••${keyId.slice(-4)}`;
  const rest = m[2] ?? "";
  return `${m[1]}${"•".repeat(Math.max(4, Math.min(8, rest.length - 4)))}${rest.slice(-4)}`;
};

export default function OnlinePaymentsSettingsPage() {
  const { t } = useI18n();
  const me = useMe();
  const canEdit = canManageShop(me.data);
  const account = usePaymentAccount(!!me.data && canEdit);

  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading icon={CreditCardIcon} title={t("billing.online.title")} description={t("billing.online.subtitle")} />
      {me.isPending ? (
        <PaymentsSkeleton />
      ) : !canEdit ? (
        <Card>
          <CardContent className="flex items-start gap-3">
            <span className="icon-chip size-10 text-muted-foreground">
              <LockIcon className="size-5" />
            </span>
            <div>
              <p className="font-medium">{t("billing.online.ownerOnlyTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("billing.online.ownerOnly")}</p>
            </div>
          </CardContent>
        </Card>
      ) : account.isError ? (
        <QueryError error={account.error} onRetry={() => void account.refetch()} />
      ) : account.isPending ? (
        <PaymentsSkeleton />
      ) : (
        <PaymentsSettings account={account.data} />
      )}
    </Page>
  );
}

function PaymentsSkeleton() {
  return (
    <div className="grid gap-section">
      <Skeleton className="h-44 rounded-2xl" />
      <Skeleton className="h-28 rounded-2xl" />
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}

function PaymentsSettings({ account }: { account: PaymentAccount }) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const [editing, setEditing] = React.useState(!account.configured);
  React.useEffect(() => {
    if (!account.configured) setEditing(true);
  }, [account.configured]);

  return (
    <Stagger className="grid gap-section">
      <StaggerItem>
        <AnimatePresence mode="wait" initial={false}>
          {account.configured ? (
            <motion.div key="status" initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <AccountStatus account={account} editing={editing} onEdit={() => setEditing((e) => !e)} />
            </motion.div>
          ) : (
            <motion.div key="empty" initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <EmptyState
                illustration={<CardIllustration />}
                title={t("billing.online.emptyTitle")}
                description={t("billing.online.emptyBody")}
                action={
                  <p className="inline-flex items-center gap-1.5 rounded-full bg-warning/18 px-3 py-1 text-xs font-medium text-warning-ink">
                    <FlaskConicalIcon className="size-3.5" /> {t("billing.online.mockNote")}
                  </p>
                }
              />
            </motion.div>
          )}
        </AnimatePresence>
      </StaggerItem>

      <AnimatePresence initial={false}>
        {editing && (
          <motion.div
            key="form"
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <KeyForm account={account} onSaved={() => setEditing(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="icon-chip size-9 text-info-ink">
                <WebhookIcon className="size-4" />
              </span>
              {t("billing.online.webhookTitle")}
            </CardTitle>
            <CardDescription>{t("billing.online.webhookHint")}</CardDescription>
          </CardHeader>
          <CardContent className="flex items-start gap-2">
            <Input
              readOnly
              value={account.webhookUrl}
              className="font-mono text-xs"
              aria-label={t("billing.online.webhookTitle")}
              onFocus={(e) => e.target.select()}
            />
            <CopyButton value={account.webhookUrl} label={t("billing.online.copyWebhook")} />
          </CardContent>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <SetupSteps />
      </StaggerItem>
    </Stagger>
  );
}

function ModePill({ mode }: { mode: "test" | "live" | null }) {
  const { t } = useI18n();
  if (!mode) return null;
  return mode === "live" ? (
    <StatusPill tone="success" icon={ShieldCheckIcon}>
      {t("billing.online.live")}
    </StatusPill>
  ) : (
    <StatusPill tone="warning" icon={FlaskConicalIcon}>
      {t("billing.online.test")}
    </StatusPill>
  );
}

function AccountStatus({ account, editing, onEdit }: { account: PaymentAccount; editing: boolean; onEdit: () => void }) {
  const { t } = useI18n();
  const save = useSavePaymentAccount();
  const remove = useDeletePaymentAccount();
  const [confirm, setConfirm] = React.useState(false);
  const mode = account.mode ?? modeOf(account.keyId);

  const toggle = async (enabled: boolean) => {
    if (!account.keyId) return;
    try {
      await save.mutateAsync({ keyId: account.keyId, enabled });
      toast.success(enabled ? t("billing.online.enabledToast") : t("billing.online.disabledToast"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="hero-band relative px-5 py-5">
        <div className="hero-dots pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <CreditCardIcon className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="font-heading text-lg font-semibold">{t("billing.online.razorpay")}</p>
            <p className="text-sm opacity-85">{account.enabled ? t("billing.online.acceptingBody") : t("billing.online.pausedBody")}</p>
          </div>
        </div>
      </div>
      <CardContent className="p-card grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <ModePill mode={mode} />
          {account.enabled ? (
            <StatusPill tone="success" icon={CheckCircle2Icon}>
              {t("billing.online.on")}
            </StatusPill>
          ) : (
            <StatusPill tone="neutral" icon={CircleOffIcon}>
              {t("billing.online.off")}
            </StatusPill>
          )}
        </div>
        <div className="grid gap-1 text-sm">
          <span className="text-muted-foreground">{t("billing.online.keyId")}</span>
          <span className="font-mono tabular-nums">{maskKey(account.keyId)}</span>
        </div>
        {mode === "test" && (
          <p className="flex items-start gap-2 rounded-xl bg-warning/18 p-3 text-sm text-warning-ink">
            <FlaskConicalIcon className="mt-0.5 size-4 shrink-0" />
            {t("billing.online.testWarning")}
          </p>
        )}
        <label className="flex min-h-11 items-center justify-between gap-4 rounded-xl border bg-muted/30 px-4 py-3">
          <span>
            <span className="block text-sm font-medium">{t("billing.online.enabledLabel")}</span>
            <span className="block text-xs text-muted-foreground">{t("billing.online.enabledHint")}</span>
          </span>
          <span className="flex items-center gap-2">
            {save.isPending && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
            <Switch checked={account.enabled} disabled={save.isPending} onCheckedChange={(v) => void toggle(v)} aria-label={t("billing.online.enabledLabel")} />
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" className="h-11" onClick={onEdit} aria-expanded={editing}>
            <PencilIcon /> {editing ? t("billing.online.closeKeys") : t("billing.online.updateKeys")}
          </Button>
          <Button variant="ghost" size="lg" className="h-11 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirm(true)}>
            <Trash2Icon /> {t("billing.online.remove")}
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("billing.online.removeTitle")}
        description={t("billing.online.removeBody")}
        confirmLabel={t("billing.online.remove")}
        onConfirm={async () => {
          try {
            await remove.mutateAsync();
            toast.success(t("billing.online.removed"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </Card>
  );
}

function KeyForm({ account, onSaved }: { account: PaymentAccount; onSaved: () => void }) {
  const { t } = useI18n();
  const save = useSavePaymentAccount();
  const update = account.configured;
  const [keyId, setKeyId] = React.useState(account.keyId ?? "");
  const [keySecret, setKeySecret] = React.useState("");
  const [webhookSecret, setWebhookSecret] = React.useState("");
  const [enabled, setEnabled] = React.useState(update ? account.enabled : true);
  const [touched, setTouched] = React.useState(false);
  const [credError, setCredError] = React.useState<string | null>(null);

  const id = keyId.trim();
  const errors = {
    keyId: !id ? t("billing.validation.required") : !KEY_RE.test(id) ? t("billing.online.keyIdInvalid") : null,
    // Secret is optional on update (blank = keep), unless the key id changed.
    keySecret: !keySecret.trim() && (!update || id !== account.keyId) ? t("billing.validation.required") : null,
  };
  const invalid = !!(errors.keyId || errors.keySecret);
  const mode = modeOf(id);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setCredError(null);
    if (invalid) return;
    const body: PaymentAccountInput = { keyId: id, enabled };
    if (keySecret.trim()) body.keySecret = keySecret.trim();
    if (webhookSecret.trim()) body.webhookSecret = webhookSecret.trim();
    try {
      await save.mutateAsync(body);
      toast.success(update ? t("billing.online.updated") : t("billing.online.connected"));
      setKeySecret("");
      setWebhookSecret("");
      setTouched(false);
      onSaved();
    } catch (err) {
      const msg = describeError(err, t);
      if (err instanceof ApiError && err.code === "invalid_credentials") setCredError(msg);
      toast.error(msg);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="icon-chip size-9 text-primary">
            <KeyRoundIcon className="size-4" />
          </span>
          {update ? t("billing.online.formTitleUpdate") : t("billing.online.formTitle")}
        </CardTitle>
        <CardDescription>{t("billing.online.formHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" noValidate onSubmit={submit}>
          <fieldset disabled={save.isPending} className="grid gap-4">
            {credError && (
              <Alert variant="destructive">
                <LockIcon />
                <AlertDescription>{credError}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="rzp-key" rowClassName="min-h-6" aside={<ModePill mode={KEY_RE.test(id) ? mode : null} />}>
                {t("billing.online.keyId")}
              </FieldLabel>
              <Input
                id="rzp-key"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                placeholder="rzp_test_XXXXXXXXXXXXXX"
                value={keyId}
                aria-invalid={touched && !!errors.keyId}
                aria-describedby="rzp-key-hint"
                onChange={(e) => setKeyId(e.target.value.trim())}
              />
              {touched && errors.keyId ? (
                <p id="rzp-key-hint" className="text-xs text-destructive">
                  {errors.keyId}
                </p>
              ) : (
                <p id="rzp-key-hint" className="text-xs text-muted-foreground">
                  {t("billing.online.keyIdHint")}
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rzp-secret">{t("billing.online.keySecret")}</Label>
              <Input
                id="rzp-secret"
                type="password"
                className="font-mono"
                autoComplete="new-password"
                placeholder={update ? t("billing.online.keepSecret") : ""}
                value={keySecret}
                aria-invalid={touched && !!errors.keySecret}
                aria-describedby="rzp-secret-hint"
                onChange={(e) => setKeySecret(e.target.value)}
              />
              {touched && errors.keySecret ? (
                <p id="rzp-secret-hint" className="text-xs text-destructive">{errors.keySecret}</p>
              ) : (
                <p id="rzp-secret-hint" className="text-xs text-muted-foreground">{t("billing.online.secretHint")}</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rzp-webhook">
                {t("billing.online.webhookSecret")} <span className="font-normal text-muted-foreground">({t("billing.common.optional")})</span>
              </Label>
              <Input
                id="rzp-webhook"
                type="password"
                className="font-mono"
                autoComplete="new-password"
                placeholder={update ? t("billing.online.keepSecret") : ""}
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
              />
              <p className="text-meta text-muted-foreground">{t("billing.online.webhookSecretHint")}</p>
            </div>
            <label className="flex min-h-11 items-center justify-between gap-4 rounded-xl border bg-muted/30 px-4 py-3">
              <span>
                <span className="block text-sm font-medium">{t("billing.online.enabledLabel")}</span>
                <span className="block text-xs text-muted-foreground">{t("billing.online.enabledHint")}</span>
              </span>
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t("billing.online.enabledLabel")} />
            </label>
            <div className="flex justify-end">
              <Button type="submit" size="lg" className="h-11 w-full sm:w-auto">
                {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
                {save.isPending ? t("billing.online.checking") : update ? t("billing.online.saveUpdate") : t("billing.online.connect")}
              </Button>
            </div>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}

const STEPS: { key: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "billing.online.step1", icon: UserPlusIcon },
  { key: "billing.online.step2", icon: KeyRoundIcon },
  { key: "billing.online.step3", icon: FlaskConicalIcon },
  { key: "billing.online.step4", icon: SaveIcon },
  { key: "billing.online.step5", icon: WebhookIcon },
  { key: "billing.online.step6", icon: RocketIcon },
];

function SetupSteps() {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="icon-chip size-9 text-primary">
            <RocketIcon className="size-4" />
          </span>
          {t("billing.online.stepsTitle")}
        </CardTitle>
        <CardDescription>{t("billing.online.stepsHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="relative grid gap-4">
          <span className="absolute top-5 bottom-5 left-[1.1875rem] w-px bg-border" aria-hidden />
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.key} className="relative flex items-start gap-3">
                <span className="icon-chip relative size-10 rounded-full bg-card text-primary">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("billing.online.stepN", { n: i + 1 })}</p>
                  <p className="text-sm">{t(s.key)}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="lg" className="h-11">
            <a href="https://dashboard.razorpay.com/signup" target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon /> {t("billing.online.openRazorpay")}
            </a>
          </Button>
        </div>
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-meta text-muted-foreground">
          <FlaskConicalIcon className="mt-0.5 size-3.5 shrink-0" />
          {t("billing.online.mockNoteLong")}
        </p>
      </CardContent>
    </Card>
  );
}
