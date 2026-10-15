"use client";

import * as React from "react";
import {
  AlertCircleIcon,
  CheckCheckIcon,
  CheckIcon,
  CircleDotIcon,
  Clock3Icon,
  Loader2Icon,
  RadioIcon,
  RefreshCwIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, cn, motion, StatusPill, useReducedMotionSafe, type StatusTone } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import type { LiveStatus } from "../lib/sse";
import { shortAge, type DayRelation } from "../lib/time";

/** Card section with a tinted icon chip, title and hint (same look as the other admin screens). */
export function Section({
  icon: Icon,
  title,
  description,
  action,
  children,
  tone = "text-primary",
  className,
  bodyClassName,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  tone?: string;
  className?: string;
  bodyClassName?: string;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className={cn("min-w-0 rounded-2xl border border-card-ring bg-card text-card-foreground shadow-elevated", className)}>
      <header className="flex items-start gap-3 border-b border-border/60 px-4 py-3 sm:px-5">
        <span className={cn("icon-chip size-8 rounded-xl", tone)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={id} className="font-heading text-sm font-semibold tracking-tight">
            {title}
          </h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
      </header>
      <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 px-4 py-3.5 sm:px-5", bodyClassName)}>{children}</div>
    </section>
  );
}

const STATUS_LOOK: Record<LiveStatus, { tone: StatusTone; icon: React.ComponentType<{ className?: string }>; key: string; spin?: boolean }> = {
  live: { tone: "success", icon: RadioIcon, key: "inbox.live.live" },
  connecting: { tone: "neutral", icon: Loader2Icon, key: "inbox.live.connecting", spin: true },
  reconnecting: { tone: "warning", icon: Loader2Icon, key: "inbox.live.reconnecting", spin: true },
  polling: { tone: "info", icon: RefreshCwIcon, key: "inbox.live.polling" },
  offline: { tone: "neutral", icon: WifiOffIcon, key: "inbox.live.offline" },
};

/** "Live" / "Reconnecting…" / "Updating every 10 s" pill. Announced politely when it changes. */
export function ConnectionPill({ status, className }: { status: LiveStatus; className?: string }) {
  const { t } = useI18n();
  const look = STATUS_LOOK[status];
  const Icon = look.icon;
  return (
    <span role="status" aria-live="polite" className={className}>
      <StatusPill tone={look.tone} className="gap-1.5">
        <Icon className={cn("size-3.5", look.spin && "animate-spin")} aria-hidden />
        {status === "live" && <span className="relative -ml-0.5 flex size-1.5" aria-hidden><span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" /><span className="relative inline-flex size-1.5 rounded-full bg-success" /></span>}
        {t(look.key)}
      </StatusPill>
    </span>
  );
}

/** Three bouncing dots ("typing…"). Static dots with reduced motion. */
export function TypingDots({ label, className }: { label: string; className?: string }) {
  const reduced = useReducedMotionSafe();
  return (
    <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <span className="inline-flex h-7 items-center gap-1 rounded-full bg-muted px-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-muted-foreground/70"
            animate={reduced ? undefined : { y: [0, -3, 0], opacity: [0.5, 1, 0.5] }}
            transition={reduced ? undefined : { duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
          />
        ))}
      </span>
      <span>{label}</span>
    </div>
  );
}

/** Sticky "Today" / "Yesterday" / "12 Oct 2026" chip between messages. */
export function DaySeparator({ relation, at }: { relation: DayRelation; at: string }) {
  const { t, formatDate } = useI18n();
  const label = relation === "today" ? t("inbox.day.today") : relation === "yesterday" ? t("inbox.day.yesterday") : formatDate(at, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="sticky top-1 z-[1] my-3 flex justify-center" role="separator" aria-label={label}>
      <span className="rounded-full border bg-card/90 px-3 py-0.5 text-[0.6875rem] font-medium text-muted-foreground shadow-xs backdrop-blur">{label}</span>
    </div>
  );
}

export type TickState = "sending" | "failed" | "sent" | "delivered" | "read" | "queued";

/** Message status ticks with a text label for assistive tech. */
export function Ticks({ state, className }: { state: TickState; className?: string }) {
  const { t } = useI18n();
  const label = t(`inbox.tick.${state}`);
  const cls = cn("size-3.5 shrink-0", className);
  const icon =
    state === "sending" || state === "queued" ? (
      <Clock3Icon className={cn(cls, "opacity-70")} aria-hidden />
    ) : state === "failed" ? (
      <AlertCircleIcon className={cn(cls, "text-destructive")} aria-hidden />
    ) : state === "sent" ? (
      <CheckIcon className={cls} aria-hidden />
    ) : (
      <CheckCheckIcon className={cn(cls, state === "read" && "text-info")} aria-hidden />
    );
  return (
    <span className="inline-flex items-center" title={label}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** "5m", "3h", "2d" or a date for list rows. */
export function Age({ at, className }: { at: string | null | undefined; className?: string }) {
  const { t, formatDate } = useI18n();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  if (!at) return null;
  const a = shortAge(at, now);
  const text = a.unit === "now" ? t("inbox.age.now") : a.unit === "date" ? formatDate(at, { day: "numeric", month: "short" }) : t(`inbox.age.${a.unit}`, { n: a.value });
  return (
    <time dateTime={at} title={formatDate(at, { dateStyle: "medium", timeStyle: "short" })} className={cn("shrink-0 text-[0.6875rem] tabular-nums text-muted-foreground", className)}>
      {text}
    </time>
  );
}

/** Unread count bubble. */
export function UnreadBadge({ count, className, label }: { count: number; className?: string; label?: string }) {
  return (
    <AnimatePresence initial={false}>
      {count > 0 && (
        <motion.span
          key="u"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.6875rem] font-semibold text-primary-foreground tabular-nums", className)}
          aria-label={label}
        >
          {count > 99 ? "99+" : count}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** Removable tag chips + an input that adds on Enter or comma. */
export function TagEditor({
  value,
  onChange,
  suggestions = [],
  placeholder,
  label,
  disabled,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder: string;
  label: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState("");
  const listId = React.useId();
  const add = (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40);
    setDraft("");
    if (!tag || value.includes(tag) || value.length >= 20) return;
    onChange([...value, tag]);
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
      {value.map((tag) => (
        <span key={tag} className="inline-flex h-6 items-center gap-1 rounded-full bg-muted pr-1 pl-2.5 text-xs font-medium">
          {tag}
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== tag))}
              className="inline-flex size-4 items-center justify-center rounded-full outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("inbox.common.removeNamed", { name: tag })}
            >
              <XIcon className="size-3" />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <>
          <input
            value={draft}
            aria-label={label}
            list={suggestions.length ? listId : undefined}
            onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value.slice(0, -1)) : setDraft(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(draft);
              } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
            }}
            onBlur={() => draft && add(draft)}
            placeholder={value.length ? "" : placeholder}
            className="h-7 min-w-24 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground md:text-sm"
          />
          {suggestions.length > 0 && (
            <datalist id={listId}>
              {suggestions.filter((s) => !value.includes(s)).map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
        </>
      )}
    </div>
  );
}

/** Polite live region: `announce("New message from Ravi")` reads it out once. */
export function useAnnouncer() {
  const [text, setText] = React.useState("");
  const announce = React.useCallback((msg: string) => {
    setText("");
    window.setTimeout(() => setText(msg), 50);
  }, []);
  const node = (
    <div className="sr-only" role="log" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
  return [node, announce] as const;
}

/** A dot + label used inside list rows (e.g. "Opted out"). */
export function Dot({ tone, children }: { tone: "success" | "warning" | "danger" | "muted"; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
      <CircleDotIcon
        className={cn(
          "size-3",
          tone === "success" && "text-success-ink",
          tone === "warning" && "text-warning-ink",
          tone === "danger" && "text-danger-ink",
          tone === "muted" && "text-muted-foreground",
        )}
        aria-hidden
      />
      {children}
    </span>
  );
}
