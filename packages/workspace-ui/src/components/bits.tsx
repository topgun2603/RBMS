"use client";

import * as React from "react";
import { CrownIcon, LockIcon, ShieldCheckIcon, UserIcon, UserRoundXIcon } from "lucide-react";
import { cn, EmptyState, motion, StatusPill, useReducedMotionSafe } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import type { Level } from "../lib/types";

/** Panel for a page the member may not use (the server would answer 403 anyway). */
export function NoPermission({ permission }: { permission: string }) {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={LockIcon}
      title={t("workspace.common.noAccessTitle")}
      description={t("workspace.common.noAccessBody", { permission: t.has(`workspace.perm.${permission}`) ? t(`workspace.perm.${permission}`) : permission })}
    />
  );
}

const LEVEL_META: Record<Level, { tone: "brand" | "info" | "neutral"; icon: React.ComponentType<{ className?: string }> }> = {
  owner: { tone: "brand", icon: CrownIcon },
  admin: { tone: "info", icon: ShieldCheckIcon },
  staff: { tone: "neutral", icon: UserIcon },
  member: { tone: "neutral", icon: UserRoundXIcon },
};

export function LevelPill({ level, className }: { level: Level | null; className?: string }) {
  const { t } = useI18n();
  const l = level ?? "member";
  const m = LEVEL_META[l];
  return (
    <StatusPill tone={m.tone} icon={m.icon} className={className}>
      {t(`workspace.levels.${l}`)}
    </StatusPill>
  );
}

/** "5 min ago", "yesterday", "12 Oct" — relative for the last week, a date after that. */
export function useRelativeTime() {
  const { t, formatDate, locale } = useI18n();
  return React.useCallback(
    (iso: string | null | undefined) => {
      if (!iso) return t("workspace.common.never");
      const ms = Date.now() - Date.parse(iso);
      if (!Number.isFinite(ms)) return "—";
      const min = Math.round(ms / 60_000);
      const rtf = new Intl.RelativeTimeFormat(locale === "ta" ? "ta-IN" : "en-IN", { numeric: "auto" });
      if (min < 1) return t("workspace.common.justNow");
      if (min < 60) return rtf.format(-min, "minute");
      const h = Math.round(min / 60);
      if (h < 24) return rtf.format(-h, "hour");
      const d = Math.round(h / 24);
      if (d < 7) return rtf.format(-d, "day");
      return formatDate(iso, { day: "numeric", month: "short", year: "numeric" });
    },
    [t, formatDate, locale],
  );
}

/** Circular progress (done / total) with the count in the middle. */
export function ProgressRing({ value, max, size = 88, label }: { value: number; max: number; size?: number; label: string }) {
  const reduced = useReducedMotionSafe();
  const stroke = Math.max(6, Math.round(size / 11));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduced ? c * (1 - pct) : c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={reduced ? { duration: 0 } : { duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden>
        <span className="font-heading text-xl leading-none font-bold tabular-nums">
          {value}/{max}
        </span>
      </span>
    </div>
  );
}

/** Drag & drop file target (also a button that opens the file picker). */
export function Dropzone({
  accept,
  onFile,
  disabled,
  title,
  hint,
  icon: Icon,
  className,
}: {
  accept: string;
  onFile: (f: File) => void;
  disabled?: boolean;
  title: React.ReactNode;
  hint?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !disabled) onFile(f);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        over ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:border-primary/50 hover:bg-accent/40",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <motion.span animate={over ? { scale: 1.08, y: -2 } : { scale: 1, y: 0 }} className="icon-chip size-12 rounded-2xl text-primary">
        <Icon className="size-6" />
      </motion.span>
      <p className="font-medium">{title}</p>
      {hint && <p className="text-meta text-muted-foreground">{hint}</p>}
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** Small label + value tile used in summaries. */
export function CountTile({
  label,
  value,
  tone = "text-foreground",
  icon: Icon,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="grid gap-1 rounded-xl border bg-muted/20 px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className={cn("size-3.5", tone)} />}
        {label}
      </span>
      <span className={cn("font-heading text-2xl font-bold tabular-nums", tone)}>{value}</span>
    </div>
  );
}
