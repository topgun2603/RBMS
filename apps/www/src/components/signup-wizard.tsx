"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarClockIcon,
  CheckIcon,
  CircleAlertIcon,
  Loader2Icon,
  LogOutIcon,
  MonitorSmartphoneIcon,
  PillIcon,
  ReceiptIndianRupeeIcon,
  SparklesIcon,
  UtensilsCrossedIcon,
  XIcon,
} from "lucide-react";
import { Badge } from "@srirealtime/ui/components/badge";
import { Button } from "@srirealtime/ui/components/button";
import { Card } from "@srirealtime/ui/components/card";
import { Field, FieldControl, FieldError, FieldHint, FieldLabel, FieldRow, InputGroup, InputGroupAddon, InputGroupInput } from "@srirealtime/ui/components/field";
import { Input } from "@srirealtime/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@srirealtime/ui/components/select";
import { AnimatePresence, motion, SuccessCheck, useReducedMotionSafe } from "@srirealtime/ui/motion";
import { cn } from "@srirealtime/ui/lib/utils";
import { api, ApiError, errorMessage, getToken, handoffCode, handoffUrl, type SignupResult, type User } from "@/lib/api";
import { POPULAR_TIER, isFreePlan, maxSavingPct, planDescription, planForTier, planName, planTier, pricePaise, rupees, tierFromParam, type Interval, type Plan, type PlanTier } from "@/lib/plans";
import { BUSINESS_TYPES, PACKS, SHOP_DOMAIN, type AppId } from "@/lib/site";
import { GST_STATES, isGstinShape, slugShapeOk, slugify, stateLabel } from "@/lib/states";
import { useSite } from "./site-context";
import { OtpSignIn } from "./otp-sign-in";
import { GoogleButton, useGoogleAvailable } from "./google-button";
import { firebasePhoneMessage, isFirebaseError, signInWithGoogle } from "@srirealtime/web/firebase-phone";
import { IntervalToggle } from "./interval-toggle";

const STEPS = ["need", "signin", "shop", "plan", "create"] as const;
type Step = (typeof STEPS)[number];
const DRAFT_KEY = "sr_www_signup";

type SlugState = { status: "idle" | "checking" | "available" | "taken" | "invalid" | "unknown"; reason?: string; suggestions: string[] };

interface Draft {
  app: AppId | null;
  shopName: string;
  slug: string;
  slugEdited: boolean;
  state: string;
  businessType: string;
  gstin: string;
  /** The plan is kept as a tier, so changing the app keeps "Pro" and the POST sends that app's plan id. */
  tier: PlanTier | null;
  interval: Interval;
}

export interface SignupWizardProps {
  /** Each app's public plans, sorted. */
  plans: Partial<Record<AppId, Plan[]>> | null;
  /** `?plan=`: a tier or any app's plan id, mapped to the chosen app's plan of that tier. */
  initialPlan: string | null;
  initialInterval: Interval;
  initialApp: AppId | null;
}

export function SignupWizard({ plans, initialPlan, initialInterval, initialApp }: SignupWizardProps) {
  const { t, locale } = useSite();
  const reduced = useReducedMotionSafe();
  const [step, setStep] = React.useState<Step>("need");
  const [dir, setDir] = React.useState(1);
  const [user, setUser] = React.useState<User | null>(null);
  const google = useGoogleAvailable();
  const [googleBusy, setGoogleBusy] = React.useState(false);
  const [googleError, setGoogleError] = React.useState<string | null>(null);
  const wantedTier = tierFromParam(initialPlan, Object.values(plans ?? {}).flat());
  const [draft, setDraft] = React.useState<Draft>(() => ({
    app: initialApp,
    shopName: "",
    slug: "",
    slugEdited: false,
    state: "33",
    businessType: "",
    gstin: "",
    tier: wantedTier ?? POPULAR_TIER,
    interval: initialInterval,
  }));
  const [touched, setTouched] = React.useState(false);
  const [slugState, setSlugState] = React.useState<SlugState>({ status: "idle", suggestions: [] });
  const [creating, setCreating] = React.useState<{ phase: "running" | "done" | "error"; tick: number; error?: string; result?: SignupResult; url?: string }>({ phase: "running", tick: 0 });
  const restored = React.useRef(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  // Restore a draft from this tab (query params from /pricing win), and pick up an existing session.
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Draft>;
        setDraft((d) => ({
          ...d,
          ...saved,
          app: initialApp ?? saved.app ?? d.app,
          tier: wantedTier ?? saved.tier ?? d.tier,
          interval: initialPlan ? initialInterval : (saved.interval ?? d.interval),
        }));
      }
    } catch {
      /* ignore */
    }
    restored.current = true;
    if (getToken()) {
      api
        .me()
        .then((r) => setUser(r.user))
        .catch(() => undefined);
    }
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!restored.current) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [draft]);

  // Live slug availability (debounced; the server is the authority, the shape check is instant).
  React.useEffect(() => {
    const slug = draft.slug;
    if (!slug) return setSlugState({ status: "idle", suggestions: [] });
    if (!slugShapeOk(slug)) return setSlugState({ status: "invalid", suggestions: [] });
    setSlugState((s) => ({ status: "checking", suggestions: s.suggestions }));
    const ctrl = new AbortController();
    const id = window.setTimeout(() => {
      api
        .slugAvailable(slug, ctrl.signal)
        .then((r) => setSlugState({ status: r.available ? "available" : "taken", reason: r.reason, suggestions: r.suggestions ?? [] }))
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setSlugState({ status: "unknown", suggestions: [] });
        });
    }, 400);
    return () => {
      ctrl.abort();
      window.clearTimeout(id);
    };
  }, [draft.slug]);

  const idx = STEPS.indexOf(step);
  const go = (to: Step) => {
    setDir(STEPS.indexOf(to) > idx ? 1 : -1);
    setStep(to);
    setTouched(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  };

  const gstin = draft.gstin.trim().toUpperCase();
  const gstinError = gstin ? (!isGstinShape(gstin) ? t("signup.shop.gstinInvalid") : gstin.slice(0, 2) !== draft.state ? t("signup.shop.gstinState") : null) : null;
  const nameError = !draft.shopName.trim() ? t("signup.shop.nameRequired") : null;
  const slugError = slugState.status === "invalid" || !draft.slug ? t("signup.shop.slugInvalid") : slugState.status === "taken" ? (slugState.reason ?? t("signup.shop.taken")) : null;
  const shopOk = !nameError && !slugError && !gstinError && slugState.status !== "checking";
  const appPlans = draft.app ? (plans?.[draft.app] ?? null) : null;
  const plan = appPlans ? planForTier(appPlans, draft.tier) : null;

  const next = () => {
    if (step === "need" && draft.app) go(user ? "shop" : "signin");
    else if (step === "signin" && user) go("shop");
    else if (step === "shop") {
      setTouched(true);
      if (shopOk) go("plan");
    } else if (step === "plan" && plan) void create();
  };
  const back = () => {
    if (step === "shop") go(user ? "need" : "signin");
    else if (idx > 0) go(STEPS[idx - 1]!);
  };

  async function create() {
    if (!draft.app || !plan) return;
    go("create");
    setCreating({ phase: "running", tick: 0 });
    // The checklist ticks while the request runs; the last item waits for the answer.
    let tick = 0;
    const timer = window.setInterval(() => {
      tick = Math.min(tick + 1, 3);
      setCreating((c) => (c.phase === "running" ? { ...c, tick } : c));
    }, reduced ? 50 : 750);
    const started = Date.now();
    try {
      const result = await api.signup({
        shopName: draft.shopName.trim(),
        slug: draft.slug,
        appId: draft.app,
        planId: plan.id,
        interval: draft.interval,
        state: draft.state,
        ...(draft.businessType ? { businessType: draft.businessType } : {}),
        ...(gstin ? { gstin } : {}),
        ...(user?.phone ? { phone: user.phone } : {}),
      });
      // Let the moment breathe: at least ~2.4 s of the animation before the celebration.
      const wait = Math.max(0, (reduced ? 0 : 2400) - (Date.now() - started));
      await new Promise((r) => setTimeout(r, wait));
      window.clearInterval(timer);
      const url = result.loginUrl ?? handoffUrl(result.appUrl, handoffCode(result.handoff));
      setCreating({ phase: "done", tick: 4, result, url });
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      window.setTimeout(() => window.location.assign(url), reduced ? 300 : 1800);
    } catch (err) {
      window.clearInterval(timer);
      if (err instanceof ApiError && (err.status === 409 || /slug/i.test(err.code) || /slug/i.test(err.message))) {
        const d = err.details as { suggestions?: string[] } | undefined;
        setSlugState({ status: "taken", reason: err.message, suggestions: Array.isArray(d?.suggestions) ? d.suggestions : [] });
      }
      setCreating({ phase: "error", tick: 0, error: errorMessage(err, t) });
    }
  }

  const stepLabels: Record<Step, string> = {
    need: t("signup.step.need"),
    signin: t("signup.step.signin"),
    shop: t("signup.step.shop"),
    plan: t("signup.step.plan"),
    create: t("signup.step.create"),
  };

  const variants = {
    enter: (d: number) => ({ opacity: 0, x: reduced ? 0 : d * 40 }),
    center: { opacity: 1, x: 0 },
    exit: (d: number) => ({ opacity: 0, x: reduced ? 0 : d * -40 }),
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px] lg:items-start">
      <Card className="gap-0 overflow-hidden rounded-[1.75rem] p-0" data-testid="signup-wizard" data-step={step}>
        <Stepper step={step} labels={stepLabels} t={t} />
        <div className="relative px-5 pt-6 pb-6 sm:px-8 sm:pb-8">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div key={step} custom={dir} variants={variants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}>
              {step === "need" && <NeedStep value={draft.app} onChange={(a) => set("app", a)} t={t} />}

              {step === "signin" && (
                <div className="mx-auto max-w-md space-y-5">
                  <StepTitle title={t("otp.title")} sub={t("otp.sub")} />
                  {googleError && (
                    <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      {googleError}
                    </p>
                  )}
                  {google && (
                    <GoogleButton
                      busy={googleBusy}
                      testId="signup-google"
                      onClick={async () => {
                        setGoogleBusy(true);
                        setGoogleError(null);
                        try {
                          const r = await api.firebaseSignIn(await signInWithGoogle({ locale }));
                          setUser(r.user);
                          go("shop");
                        } catch (err) {
                          setGoogleError(isFirebaseError(err) ? firebasePhoneMessage(err, locale) : errorMessage(err, t));
                        } finally {
                          setGoogleBusy(false);
                        }
                      }}
                    />
                  )}
                  <OtpSignIn
                    askName
                    onSignedIn={(r) => {
                      setUser(r.user);
                      go("shop");
                    }}
                  />
                </div>
              )}

              {step === "shop" && (
                <div className="space-y-6">
                  <StepTitle title={t("signup.shop.title")} sub={t("signup.shop.sub")} />
                  {user && <SignedInAs user={user} onSwitch={async () => {
                    await api.logout();
                    setUser(null);
                    go("signin");
                  }} t={t} />}
                  <ShopStep draft={draft} set={set} slugState={slugState} touched={touched} errors={{ name: nameError, slug: slugError, gstin: gstinError }} t={t} locale={locale} onSuggestion={(s) => setDraft((d) => ({ ...d, slug: s, slugEdited: true }))} />
                </div>
              )}

              {step === "plan" && (
                <div className="space-y-6">
                  <StepTitle title={t("signup.plan.title")} sub={t("signup.plan.sub")} />
                  {appPlans && appPlans.length ? (
                    <PlanStep plans={appPlans} planId={plan?.id ?? null} interval={draft.interval} onPlan={(p) => set("tier", planTier(p))} onInterval={(v) => set("interval", v)} t={t} locale={locale} />
                  ) : (
                    <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
                      {t("pricing.loadError")}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t("signup.terms", { terms: "\u0000T\u0000", privacy: "\u0000P\u0000" })
                      .split("\u0000")
                      .map((part, i) =>
                        part === "T" ? (
                          <Link key={i} href="/terms" className="underline underline-offset-2 hover:text-foreground">
                            {t("legal.terms")}
                          </Link>
                        ) : part === "P" ? (
                          <Link key={i} href="/privacy" className="underline underline-offset-2 hover:text-foreground">
                            {t("legal.privacy")}
                          </Link>
                        ) : (
                          <React.Fragment key={i}>{part}</React.Fragment>
                        ),
                      )}
                  </p>
                </div>
              )}

              {step === "create" && <CreateStep creating={creating} shop={draft.shopName.trim()} t={t} onBack={() => go(slugState.status === "taken" ? "shop" : "plan")} onRetry={() => void create()} />}
            </motion.div>
          </AnimatePresence>

          {step !== "create" && step !== "signin" && (
            <div className="mt-8 flex items-center justify-between gap-3 border-t pt-6">
              {idx > 0 ? (
                <Button type="button" variant="ghost" onClick={back} data-testid="wizard-back">
                  <ArrowLeftIcon />
                  {t("signup.back")}
                </Button>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {t("signup.haveAccount")}{" "}
                  <Link href="/login" className="font-medium text-primary hover:underline">
                    {t("nav.login")}
                  </Link>
                </span>
              )}
              <Button
                type="button"
                size="lg"
                className="group rounded-full px-6"
                onClick={next}
                disabled={(step === "need" && !draft.app) || (step === "plan" && !plan) || (step === "shop" && slugState.status === "checking")}
                data-testid="wizard-next"
              >
                {step === "plan" ? t("signup.create") : t("signup.next")}
                {step === "plan" ? <SparklesIcon /> : <ArrowRightIcon className="transition-transform group-hover:translate-x-0.5" />}
              </Button>
            </div>
          )}
          {step === "signin" && (
            <div className="mt-6 flex justify-center">
              <Button type="button" variant="ghost" onClick={back}>
                <ArrowLeftIcon />
                {t("signup.back")}
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Summary draft={draft} plan={plan} user={user} t={t} locale={locale} />
    </div>
  );
}

function StepTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="space-y-1.5">
      <h2 className="font-display text-2xl font-bold text-balance sm:text-3xl">{title}</h2>
      {sub && <p className="text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Stepper({ step, labels, t }: { step: Step; labels: Record<Step, string>; t: (k: string, v?: Record<string, string | number>) => string }) {
  const idx = STEPS.indexOf(step);
  return (
    <div className="border-b bg-tint px-5 py-4 sm:px-8">
      <div className="mb-3 flex items-center justify-between text-xs font-medium text-muted-foreground sm:hidden">
        <span>{t("signup.stepOf", { n: idx + 1, total: STEPS.length })}</span>
        <span className="text-foreground">{labels[step]}</span>
      </div>
      <ol className="hidden items-center gap-2 sm:flex">
        {STEPS.map((s, i) => {
          const done = i < idx;
          const on = i === idx;
          return (
            <li key={s} className="flex min-w-0 flex-1 items-center gap-2">
              <motion.span
                animate={{ scale: on ? 1.08 : 1 }}
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                  done ? "bg-success text-white" : on ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30" : "bg-muted text-muted-foreground",
                )}
              >
                {done ? <CheckIcon className="size-3.5" /> : i + 1}
              </motion.span>
              <span className={cn("truncate text-sm", on ? "font-semibold" : "text-muted-foreground")}>{labels[s]}</span>
              {i < STEPS.length - 1 && <span className="hidden h-px min-w-3 flex-1 bg-border md:block" />}
            </li>
          );
        })}
      </ol>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted sm:mt-4">
        <motion.div className="h-full rounded-full bg-[linear-gradient(90deg,var(--primary),var(--www-marigold))]" initial={false} animate={{ width: `${((idx + 1) / STEPS.length) * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
      </div>
    </div>
  );
}

function NeedStep({ value, onChange, t }: { value: AppId | null; onChange: (a: AppId) => void; t: (k: string) => string }) {
  const options: { id: AppId; icon: React.ReactNode; title: string; body: string }[] = [
    { id: "BL", icon: <ReceiptIndianRupeeIcon />, title: t("products.billing.title"), body: t("products.billing.body") },
    { id: "EC", icon: <MonitorSmartphoneIcon />, title: t("products.store.title"), body: t("products.store.body") },
    { id: "PH", icon: <PillIcon />, title: t("products.pharmacy.title"), body: t("products.pharmacy.body") },
    { id: "RS", icon: <UtensilsCrossedIcon />, title: t("products.restaurant.title"), body: t("products.restaurant.body") },
    { id: "SV", icon: <CalendarClockIcon />, title: t("products.services.title"), body: t("products.services.body") },
  ];
  return (
    <div className="space-y-6">
      <StepTitle title={t("signup.need.title")} sub={t("signup.need.sub")} />
      <div role="radiogroup" aria-label={t("signup.need.title")} className="grid gap-4 sm:grid-cols-2">
        {options.map((o) => {
          const on = value === o.id;
          return (
            <motion.button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.id)}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
              data-testid={`need-${o.id}`}
              className={cn("relative flex flex-col gap-3 rounded-2xl border-2 p-5 text-left transition-colors focus-ring", on ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}
            >
              <span className={cn("flex size-11 items-center justify-center rounded-xl transition-colors [&_svg]:size-5", on ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>{o.icon}</span>
              <span className="font-display text-lg font-bold">{o.title}</span>
              <span className="text-sm text-muted-foreground">{o.body}</span>
              <AnimatePresence>
                {on && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 500, damping: 22 }} className="absolute top-4 right-4 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <CheckIcon className="size-3.5" />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

function SignedInAs({ user, onSwitch, t }: { user: User; onSwitch: () => void; t: (k: string, v?: Record<string, string>) => string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-success/10 px-4 py-2.5 text-sm">
      <span className="flex items-center gap-2 text-success">
        <CheckIcon className="size-4" />
        {t("signup.signedInAs", { who: user.name || user.phone || user.email || "" })}
      </span>
      <button type="button" onClick={onSwitch} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <LogOutIcon className="size-3.5" />
        {t("signup.switchAccount")}
      </button>
    </div>
  );
}

function ShopStep({
  draft,
  set,
  slugState,
  touched,
  errors,
  t,
  locale,
  onSuggestion,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  slugState: SlugState;
  touched: boolean;
  errors: { name: string | null; slug: string | null; gstin: string | null };
  t: (k: string) => string;
  locale: string;
  onSuggestion: (s: string) => void;
}) {
  const showSlugError = (touched || (draft.slugEdited && draft.slug.length > 0) || slugState.status === "taken") && errors.slug;
  return (
    <div className="grid gap-5">
      <Field invalid={touched && !!errors.name}>
        <FieldLabel>{t("signup.shop.name")}</FieldLabel>
        <FieldControl>
          <Input
            size="lg"
            value={draft.shopName}
            onChange={(e) => {
              const v = e.target.value;
              set("shopName", v);
              if (!draft.slugEdited) set("slug", slugify(v));
            }}
            placeholder={t("signup.shop.namePlaceholder")}
            maxLength={120}
            autoFocus
            data-testid="shop-name"
          />
        </FieldControl>
        <FieldError>{touched ? errors.name : null}</FieldError>
      </Field>

      <Field invalid={!!showSlugError}>
        <FieldLabel aside={<SlugBadge state={slugState} t={t} />}>{t("signup.shop.slug")}</FieldLabel>
        <InputGroup size="lg">
          <FieldControl>
            <InputGroupInput
              value={draft.slug}
              onChange={(e) => {
                set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40));
                set("slugEdited", true);
              }}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="url"
              data-testid="shop-slug"
            />
          </FieldControl>
          <InputGroupAddon className="max-w-[45%] truncate">.{SHOP_DOMAIN}</InputGroupAddon>
        </InputGroup>
        {slugState.status === "unknown" ? <FieldHint>{t("signup.shop.unchecked")}</FieldHint> : <FieldHint>{t("signup.shop.slugHint")}</FieldHint>}
        <FieldError>{showSlugError || null}</FieldError>
        <AnimatePresence>
          {slugState.status === "taken" && slugState.suggestions.length > 0 && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex flex-wrap items-center gap-2 overflow-hidden text-xs" data-testid="slug-suggestions">
              <span className="text-muted-foreground">{t("signup.shop.try")}</span>
              {slugState.suggestions.slice(0, 4).map((s, i) => (
                <motion.button key={s} type="button" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} onClick={() => onSuggestion(s)} className="rounded-full border bg-card px-3 py-1 font-medium hover:border-primary hover:text-primary">
                  {s}
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </Field>

      <FieldRow cols={2}>
        <Field>
          <FieldLabel>{t("signup.shop.state")}</FieldLabel>
          <Select value={draft.state} onValueChange={(v) => set("state", v)}>
            <FieldControl>
              <SelectTrigger size="lg" className="w-full" data-testid="shop-state">
                <SelectValue />
              </SelectTrigger>
            </FieldControl>
            <SelectContent className="max-h-72">
              {GST_STATES.map((s) => (
                <SelectItem key={s.code} value={s.code}>
                  {stateLabel(s, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel optional={t("common.optional")}>{t("signup.shop.type")}</FieldLabel>
          <Select value={draft.businessType || undefined} onValueChange={(v) => set("businessType", v)}>
            <FieldControl>
              <SelectTrigger size="lg" className="w-full" data-testid="shop-type">
                <SelectValue placeholder={t("signup.shop.typePlaceholder")} />
              </SelectTrigger>
            </FieldControl>
            <SelectContent>
              {/* Trades made for the chosen product first; any trade can still be picked. */}
              {[...BUSINESS_TYPES]
                .sort((a, b) => Number(PACKS[b].appId === draft.app) - Number(PACKS[a].appId === draft.app))
                .map((b) => (
                  <SelectItem key={b} value={b}>
                    {locale === "ta" ? PACKS[b].nameTa : PACKS[b].name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>
      </FieldRow>

      <Field invalid={!!errors.gstin}>
        <FieldLabel optional={t("common.optional")}>{t("signup.shop.gstin")}</FieldLabel>
        <FieldControl>
          <Input
            size="lg"
            value={draft.gstin}
            onChange={(e) => {
              const v = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 15);
              set("gstin", v);
              const code = v.slice(0, 2);
              if (v.length === 15 && isGstinShape(v) && GST_STATES.some((s) => s.code === code)) set("state", code);
            }}
            placeholder="33ABCDE1234F1Z5"
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono tracking-wider uppercase"
            data-testid="shop-gstin"
          />
        </FieldControl>
        <FieldHint>{t("signup.shop.gstinHint")}</FieldHint>
        <FieldError>{draft.gstin.length === 15 || touched ? errors.gstin : null}</FieldError>
      </Field>
    </div>
  );
}

function SlugBadge({ state, t }: { state: SlugState; t: (k: string) => string }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {state.status === "checking" ? (
        <motion.span key="c" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1" data-testid="slug-status" data-status="checking">
          <Loader2Icon className="size-3.5 animate-spin" />
          {t("signup.shop.checking")}
        </motion.span>
      ) : state.status === "available" ? (
        <motion.span key="a" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} data-testid="slug-status" data-status="available">
          <Badge variant="success" className="gap-1">
            <CheckIcon />
            {t("signup.shop.available")}
          </Badge>
        </motion.span>
      ) : state.status === "taken" ? (
        <motion.span key="t" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} data-testid="slug-status" data-status="taken">
          <Badge variant="destructive" className="gap-1">
            <XIcon />
            {t("signup.shop.taken")}
          </Badge>
        </motion.span>
      ) : (
        <span key="n" data-testid="slug-status" data-status={state.status} />
      )}
    </AnimatePresence>
  );
}

function PlanStep({ plans, planId, interval, onPlan, onInterval, t, locale }: { plans: Plan[]; planId: string | null; interval: Interval; onPlan: (p: Plan) => void; onInterval: (v: Interval) => void; t: Parameters<typeof planName>[0]; locale: string }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <IntervalToggle value={interval} onChange={onInterval} savePct={maxSavingPct(plans)} id="wiz" />
        <span className="text-xs text-muted-foreground">{t("pricing.exGst")}</span>
      </div>
      <div role="radiogroup" aria-label={t("signup.plan.title")} className="grid gap-3">
        {plans.map((p) => {
          const on = planId === p.id;
          const free = isFreePlan(p);
          return (
            <motion.button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPlan(p)}
              whileTap={{ scale: 0.99 }}
              layout
              data-testid={`wiz-plan-${planTier(p) ?? p.id}`}
              className={cn("relative flex items-center gap-4 rounded-2xl border-2 p-4 text-left transition-colors focus-ring sm:p-5", on ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}
            >
              <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors", on ? "border-primary" : "border-muted-foreground/40")}>
                <AnimatePresence>{on && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="size-2.5 rounded-full bg-primary" />}</AnimatePresence>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-lg font-bold">{planName(t, p)}</span>
                  {!free && <Badge variant="success">{t("signup.plan.trialBadge")}</Badge>}
                </span>
                <span className="block text-sm text-muted-foreground">{planDescription(t, p, locale)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-display text-lg font-bold tabular-nums">{free ? t("pricing.free") : rupees(locale, pricePaise(p, interval))}</span>
                {!free && <span className="block text-xs text-muted-foreground">{interval === "yearly" ? t("pricing.perYear") : t("pricing.perMonth")}</span>}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

function CreateStep({ creating, shop, t, onBack, onRetry }: { creating: { phase: "running" | "done" | "error"; tick: number; error?: string; result?: SignupResult; url?: string }; shop: string; t: (k: string, v?: Record<string, string>) => string; onBack: () => void; onRetry: () => void }) {
  const items = [t("signup.creating.1", { shop }), t("signup.creating.2"), t("signup.creating.3"), t("signup.creating.4")];
  if (creating.phase === "error") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-8 text-center" role="alert" data-testid="create-error">
        <span className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <CircleAlertIcon className="size-7" />
        </span>
        <h2 className="font-display text-2xl font-bold">{t("signup.error.title")}</h2>
        <p className="text-muted-foreground">{creating.error}</p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeftIcon />
            {t("signup.back")}
          </Button>
          <Button onClick={onRetry}>{t("signup.error.retry")}</Button>
        </div>
      </div>
    );
  }
  if (creating.phase === "done") {
    return (
      <div className="relative flex flex-col items-center gap-4 py-10 text-center" data-testid="create-done">
        <SuccessCheck size={88} label={t("signup.done.title")} />
        <motion.h2 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="font-display text-3xl font-bold">
          {t("signup.done.title")}
        </motion.h2>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }} className="text-muted-foreground">
          {t("signup.done.body", { shop: creating.result?.tenant.name ?? shop })}
        </motion.p>
        {creating.url && (
          <Button asChild className="rounded-full" data-testid="open-shop">
            <a href={creating.url}>
              {t("signup.done.open")}
              <ArrowRightIcon />
            </a>
          </Button>
        )}
        <Confetti />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md py-6" data-testid="creating">
      <div className="mb-8 flex flex-col items-center gap-4 text-center">
        <ShopBuilding />
        <h2 className="font-display text-2xl font-bold">{t("signup.creating.title")}</h2>
      </div>
      <ul className="space-y-3">
        {items.map((label, i) => {
          const done = i < creating.tick;
          const active = i === creating.tick;
          return (
            <motion.li key={i} initial={{ opacity: 0, x: -12 }} animate={{ opacity: done || active ? 1 : 0.45, x: 0 }} transition={{ delay: i * 0.08 }} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", done ? "bg-success text-white" : "bg-muted")}>
                <AnimatePresence mode="wait" initial={false}>
                  {done ? (
                    <motion.span key="d" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 500, damping: 20 }}>
                      <CheckIcon className="size-3.5" />
                    </motion.span>
                  ) : active ? (
                    <motion.span key="a" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      <Loader2Icon className="size-3.5 animate-spin text-primary" />
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </span>
              <span className={cn("text-sm", done || active ? "font-medium" : "text-muted-foreground")}>{label}</span>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

/** A little shop front whose shutter rolls up while the shop is being created. */
function ShopBuilding() {
  const reduced = useReducedMotionSafe();
  return (
    <svg viewBox="0 0 120 96" className="h-24 w-32" aria-hidden="true">
      <motion.path d="M10 34 L20 10 H100 L110 34 Z" className="fill-primary" initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.4 }} />
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.path key={i} d={`M${10 + i * 20} 34 q10 10 20 0`} className={i % 2 ? "fill-marigold" : "fill-primary/70"} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} style={{ originY: 0 }} transition={{ delay: 0.3 + i * 0.07 }} />
      ))}
      <rect x="18" y="40" width="84" height="50" rx="3" className="fill-card stroke-border" strokeWidth="2" />
      <rect x="44" y="52" width="32" height="38" className="fill-muted" />
      <motion.rect
        x="44"
        y="52"
        width="32"
        height="38"
        className="fill-primary/80"
        style={{ originY: 0 }}
        animate={reduced ? { scaleY: 0.2 } : { scaleY: [1, 0.15, 0.15, 1] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
      />
      <rect x="24" y="48" width="14" height="14" rx="2" className="fill-marigold/60" />
      <rect x="82" y="48" width="14" height="14" rx="2" className="fill-marigold/60" />
    </svg>
  );
}

/** A short burst of kolam-coloured dots. */
function Confetti() {
  const reduced = useReducedMotionSafe();
  if (reduced) return null;
  const dots = Array.from({ length: 18 }, (_, i) => i);
  const colors = ["var(--primary)", "var(--www-marigold)", "var(--success)", "oklch(0.65 0.18 340)"];
  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 flex justify-center" aria-hidden="true">
      {dots.map((i) => {
        const angle = (i / dots.length) * Math.PI * 2;
        const dist = 90 + (i % 3) * 30;
        return (
          <motion.span
            key={i}
            className="absolute size-2 rounded-full"
            style={{ background: colors[i % colors.length] }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, opacity: 0, scale: 0.4 }}
            transition={{ duration: 1.1, ease: "easeOut", delay: 0.15 }}
          />
        );
      })}
    </div>
  );
}

function Summary({ draft, plan, user, t, locale }: { draft: Draft; plan: Plan | null; user: User | null; t: Parameters<typeof planName>[0]; locale: string }) {
  const rows: { k: string; v: string | null }[] = [
    { k: t("signup.step.need"), v: draft.app ? t(`app.${draft.app}`) : null },
    { k: t("signup.step.signin"), v: user ? user.name || user.phone || user.email : null },
    { k: t("signup.shop.name"), v: draft.shopName.trim() || null },
    { k: t("signup.shop.slug"), v: draft.slug ? `${draft.slug}.${SHOP_DOMAIN}` : null },
    { k: t("signup.step.plan"), v: plan ? `${planName(t, plan)} · ${isFreePlan(plan) ? t("pricing.free") : `${rupees(locale, pricePaise(plan, draft.interval))}${draft.interval === "yearly" ? t("pricing.perYear") : t("pricing.perMonth")}`}` : null },
  ];
  return (
    <aside className="hidden lg:block">
      <Card className="sticky top-24 gap-4 rounded-2xl p-6">
        <p className="text-sm font-semibold">{t("signup.summary")}</p>
        <dl className="space-y-3 text-sm">
          {rows.map((r) => (
            <div key={r.k} className="grid gap-0.5">
              <dt className="text-xs text-muted-foreground">{r.k}</dt>
              <dd className="min-h-5 truncate font-medium">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span key={r.v ?? "-"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className="block truncate">
                    {r.v ?? "—"}
                  </motion.span>
                </AnimatePresence>
              </dd>
            </div>
          ))}
        </dl>
        {plan && !isFreePlan(plan) && (
          <div className="rounded-xl bg-success/10 p-3 text-xs text-success">
            <SparklesIcon className="mr-1 inline size-3.5" />
            {t("pricing.trialNote")} · {t("cta.noCard")}
          </div>
        )}
      </Card>
    </aside>
  );
}
