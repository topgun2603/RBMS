"use client";

import * as React from "react";
import { AlertTriangleIcon, CheckIcon, CopyIcon, LockIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Skeleton,
  StatusPill,
  toast,
  type StatusTone,
} from "@rbms/ui";
import { useI18n, usePermission } from "@rbms/web";

/** `can(permission)` for the signed-in member (owners/admins always). */
export const useCan = (permission: string) => usePermission(permission);

/** Empty state for a page the member may not use. */
export function NoAccess({ permission }: { permission: string }) {
  const { t } = useI18n();
  return <EmptyState icon={LockIcon} title={t("growth.common.noAccessTitle")} description={t("growth.common.noAccessBody", { permission })} />;
}

/** Card with an icon chip, title, description and an optional action on the right. */
export function SectionCard({
  icon: Icon,
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("gap-4 py-5", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className="icon-chip size-9 shrink-0 rounded-xl text-primary">
              <Icon className="size-4" />
            </span>
          )}
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            {description && <CardDescription className="text-xs sm:text-sm">{description}</CardDescription>}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </CardHeader>
      {children !== undefined && <CardContent className={cn("px-4 sm:px-5", contentClassName)}>{children}</CardContent>}
    </Card>
  );
}

/** Copies `value` to the clipboard with a check-mark confirmation. */
export function CopyButton({ value, label, size = "sm", variant = "outline", className }: { value: string; label?: string; size?: "sm" | "default" | "icon-sm" | "icon"; variant?: "outline" | "ghost" | "default" | "secondary"; className?: string }) {
  const { t } = useI18n();
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(false), 1600);
    return () => window.clearTimeout(id);
  }, [done]);
  const iconOnly = size === "icon" || size === "icon-sm";
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      aria-label={iconOnly ? (label ?? t("growth.common.copy")) : undefined}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
        } catch {
          toast.error(t("growth.errors.network"));
        }
      }}
    >
      {done ? <CheckIcon className="text-success" /> : <CopyIcon />}
      {!iconOnly && (done ? t("growth.common.copied") : (label ?? t("growth.common.copy")))}
    </Button>
  );
}

/**
 * A secret shown exactly once (API key, webhook signing secret): monospace value, copy button and a warning.
 * The dialog can't be dismissed by clicking outside, so nobody loses the secret by accident.
 */
export function SecretOnceDialog({
  open,
  onOpenChange,
  title,
  description,
  secret,
  warning,
  doneLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  secret: string | null;
  warning: React.ReactNode;
  doneLabel: string;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("growth.common.close")}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2 pl-3">
            <code className="min-w-0 flex-1 font-mono text-sm break-all select-all">{secret ?? ""}</code>
            {secret && <CopyButton value={secret} />}
          </div>
          <Alert className="border-warning/40 bg-warning/10 text-warning-ink">
            <AlertTriangleIcon />
            <AlertTitle className="text-sm">{warning}</AlertTitle>
          </Alert>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{doneLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Status pill with an icon (never colour alone). */
export function Pill({ tone, icon, children }: { tone: StatusTone; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <StatusPill tone={tone} icon={icon}>
      {children}
    </StatusPill>
  );
}

/** Grid of skeleton cards. */
export function CardsSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4", className)} aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-40 rounded-2xl" />
      ))}
    </div>
  );
}

/** Inline error alert (for a failed mutation inside a form). */
export function InlineError({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  );
}
