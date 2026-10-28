"use client";

import * as React from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { Field, FieldControl, FieldError, FieldLabel } from "@srirealtime/ui/components/field";
import { cn } from "@srirealtime/ui/lib/utils";
import { normalizeMobile } from "../lib/format";
import type { EnquiryFormConfig } from "../types";
import { StoreImage } from "../components/bits";
import { ApiError, call, errorMessage } from "./api";
import { NoticeLine, useNotice } from "./privacy";
import { useStore } from "./store-context";

type Key = "name" | "phone" | "email" | "studentName" | "option" | "message";
type Values = Record<Key, string>;

const EMPTY: Values = { name: "", phone: "", email: "", studentName: "", option: "", message: "" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Same look as the store's other forms (address, booking): tall, rounded, brand focus ring, 16px text (no iOS zoom). */
const CONTROL = "w-full rounded-xl border border-input bg-background px-3.5 text-base text-foreground outline-none transition-shadow focus:ring-[3px] focus:ring-ring/30 aria-invalid:border-destructive motion-reduce:transition-none";

/**
 * A contact / admission enquiry form: name and mobile always, the rest as the shop chose. Posts to
 * `POST /v1/enquiries/public` (through the store proxy; the shop comes from the host). A hidden `website` input is the
 * honeypot bots fill in. Shown on the home page (section) or inside any page (block).
 */
export function EnquiryForm({ cfg }: { cfg: EnquiryFormConfig }) {
  const { t } = useStore();
  const uid = React.useId();
  const notice = useNotice();
  const [v, setV] = React.useState<Values>(EMPTY);
  const [trap, setTrap] = React.useState("");
  const [errors, setErrors] = React.useState<Partial<Record<Key, string>>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<{ number: string } | null>(null);
  const doneRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const set = (k: Key) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = e.target.value;
    setV((x) => ({ ...x, [k]: value }));
    setErrors((x) => (x[k] ? { ...x, [k]: undefined } : x));
  };

  const validate = (): Partial<Record<Key, string>> => {
    const e: Partial<Record<Key, string>> = {};
    if (v.name.trim().length < 2) e.name = t("enquiry.errName");
    if (!normalizeMobile(v.phone)) e.phone = t("enquiry.errPhone");
    if (cfg.askEmail && v.email.trim() && !EMAIL_RE.test(v.email.trim())) e.email = t("enquiry.errEmail");
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    setFormError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      setFormError(t("enquiry.fixErrors"));
      return;
    }
    setBusy(true);
    const clean = (s: string) => s.trim() || undefined;
    try {
      const r = await call<{ ok: boolean; number: string | null }>("/enquiries/public", {
        method: "POST",
        auth: false,
        body: {
          name: v.name.trim(),
          phone: normalizeMobile(v.phone),
          email: cfg.askEmail ? clean(v.email) : undefined,
          topic: clean(cfg.topic ?? ""),
          studentName: cfg.askStudent ? clean(v.studentName) : undefined,
          option: cfg.options.length ? clean(v.option) : undefined,
          message: cfg.askMessage ? clean(v.message) : undefined,
          source: window.location.pathname.slice(0, 200),
          // Only when the notice is already known in this browser; the form never waits for it.
          noticeVersion: notice.data?.label,
          website: trap,
        },
      });
      setDone({ number: r.number ?? "" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setFormError(t("enquiry.tooMany"));
      else {
        if (err instanceof ApiError && err.code === "invalid_input" && Array.isArray(err.details)) {
          const fe: Partial<Record<Key, string>> = {};
          for (const d of err.details as { path?: (string | number)[]; message?: string }[]) {
            const k = d.path?.[d.path.length - 1];
            if (typeof k === "string" && k in EMPTY && d.message) fe[k as Key] = d.message;
          }
          setErrors(fe);
        }
        setFormError(errorMessage(err, t));
      }
    } finally {
      setBusy(false);
    }
  };

  const headingId = `${uid}-h`;
  const optional = <span className="font-normal text-muted-foreground"> {t("enquiry.optional")}</span>;
  const field = (k: Key, label: React.ReactNode, control: (props: { className: string }) => React.ReactNode, wide = false) => (
    <Field id={`${uid}-${k}`} invalid={!!errors[k]} className={cn("gap-1.5", wide && "sm:col-span-2")}>
      <FieldLabel className="leading-snug">{label}</FieldLabel>
      <FieldControl>{control({ className: cn(CONTROL, "h-12") })}</FieldControl>
      <FieldError className="text-danger-ink">{errors[k]}</FieldError>
    </Field>
  );

  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-[var(--sf-radius-card)] bg-card text-card-foreground shadow-card ring-1 ring-border" data-testid="enquiry-form">
      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="grid content-start gap-4 bg-tint-1 p-6 sm:p-10">
          <h2 id={headingId} className="sf-heading font-display text-h2 font-semibold text-balance">
            {cfg.heading}
          </h2>
          {cfg.text && <p className="max-w-prose text-base text-muted-foreground sm:text-lg">{cfg.text}</p>}
          {cfg.imageUrl && (
            <div className="mt-2 overflow-hidden rounded-2xl bg-muted">
              <StoreImage src={cfg.imageUrl} alt={cfg.imageAlt ?? ""} className="aspect-[4/3] w-full object-cover" />
            </div>
          )}
        </div>

        <div className="relative p-6 sm:p-10">
          {done ? (
            <div ref={doneRef} tabIndex={-1} role="status" className="grid content-center justify-items-start gap-4 py-6 outline-none lg:min-h-72" data-testid="enquiry-done">
              <span className="flex size-14 items-center justify-center rounded-full bg-success/15 text-success motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-300">
                <CheckIcon className="size-7" aria-hidden />
              </span>
              <p className="text-lg font-semibold text-balance">{cfg.successText || t("enquiry.success")}</p>
              {done.number && <p className="text-muted-foreground">{t("enquiry.number", { number: done.number })}</p>}
              <button
                type="button"
                className="focus-ring -mx-1 rounded px-1 text-sm font-semibold text-primary underline-offset-4 hover:underline"
                onClick={() => {
                  setV(EMPTY);
                  setTrap("");
                  setErrors({});
                  setFormError(null);
                  setDone(null);
                }}
              >
                {t("enquiry.another")}
              </button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="grid items-start gap-4 sm:grid-cols-2" aria-busy={busy}>
              {field("name", t("enquiry.name"), (p) => (
                <input {...p} value={v.name} onChange={set("name")} maxLength={80} autoComplete="name" required />
              ))}
              {field("phone", t("enquiry.phone"), (p) => (
                <input {...p} type="tel" inputMode="tel" value={v.phone} onChange={set("phone")} maxLength={16} autoComplete="tel" placeholder="98765 43210" required />
              ))}
              {cfg.askStudent &&
                field("studentName", cfg.studentLabel || t("enquiry.student"), (p) => <input {...p} value={v.studentName} onChange={set("studentName")} maxLength={80} autoComplete="off" />, true)}
              {cfg.options.length > 0 &&
                field(
                  "option",
                  cfg.optionLabel || t("enquiry.option"),
                  (p) => (
                    <select {...p} value={v.option} onChange={set("option")}>
                      <option value="">{t("enquiry.select")}</option>
                      {cfg.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ),
                  true,
                )}
              {cfg.askEmail &&
                field(
                  "email",
                  <>
                    {t("enquiry.email")}
                    {optional}
                  </>,
                  (p) => <input {...p} type="email" inputMode="email" value={v.email} onChange={set("email")} maxLength={120} autoComplete="email" />,
                  true,
                )}
              {cfg.askMessage &&
                field(
                  "message",
                  <>
                    {t("enquiry.message")}
                    {optional}
                  </>,
                  (p) => <textarea {...p} className={cn(p.className, "h-auto min-h-28 py-3")} rows={4} value={v.message} onChange={set("message")} maxLength={1000} />,
                  true,
                )}

              {/* Honeypot: people never see or reach it; bots fill it in and the server drops the enquiry. */}
              <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden opacity-0">
                <label>
                  Website
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
                </label>
              </div>

              {formError && (
                <p role="alert" className="text-sm text-danger-ink sm:col-span-2">
                  {formError}
                </p>
              )}
              <div className="grid gap-3 sm:col-span-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="sf-btn focus-ring inline-flex h-12 w-full items-center justify-center gap-2 bg-primary px-7 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-60 motion-reduce:transition-none sm:w-fit"
                >
                  {busy && <Loader2Icon className="size-4 animate-spin" aria-hidden />}
                  {busy ? t("enquiry.sending") : cfg.submitLabel || t("enquiry.submit")}
                </button>
                <NoticeLine before={t("enquiry.privacyBefore")} className="text-xs text-muted-foreground" />
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
