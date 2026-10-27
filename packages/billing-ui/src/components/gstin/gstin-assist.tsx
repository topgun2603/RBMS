"use client";

/**
 * GSTIN lookup on customer and supplier forms (docs/recurring-export-gstin.md): what the number says about itself at
 * once (checksum, State, PAN, holder type), then the registered name, address and status from the lookup provider when
 * one is configured. Also the warning shown on bills and purchases whose party's GSTIN is cancelled or suspended.
 */
import * as React from "react";
import { AlertTriangleIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { parseGstin, stateName } from "@srirealtime/gst";
import { Alert, AlertDescription, Badge, Button, cn } from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { useGstinInfo, useGstinLookup, useGstinStatuses } from "../../lib/queries-export";
import type { GstinDetails, GstinLookupResult, GstinStatus } from "../../lib/types-export";

const STATUS_TONE: Record<GstinStatus, string> = {
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  cancelled: "border-destructive/40 bg-destructive/10 text-destructive",
  suspended: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  inactive: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  unknown: "",
};

export function GstinStatusBadge({ status }: { status: GstinStatus }) {
  const { t } = useI18n();
  return (
    <Badge variant="outline" className={cn("font-medium", STATUS_TONE[status])}>
      {t(`billing.gstin.status.${status}`)}
    </Badge>
  );
}

export interface GstinApply {
  name: string | null;
  address: string | null;
  stateCode: string | null;
}

/** Under a GSTIN input: offline facts as you type, "Look up" for the registered details, "Use these details". */
export function GstinAssist({ gstin, onApply }: { gstin: string; onApply?: (d: GstinApply) => void }) {
  const { t, formatDate } = useI18n();
  const info = useGstinInfo();
  const lookup = useGstinLookup();
  const [result, setResult] = React.useState<GstinLookupResult | null>(null);
  const value = gstin.trim().toUpperCase();
  const parts = value.length === 15 ? parseGstin(value) : null;

  React.useEffect(() => {
    setResult(null);
  }, [value]);

  if (!parts) return null;
  if (!parts.valid) {
    return (
      <p className="text-meta text-destructive" role="status">
        {parts.problem === "checksum" && parts.expectedCheck ? t("billing.gstin.invalidChecksum", { char: parts.expectedCheck }) : t("billing.gstin.invalidFormat")}
      </p>
    );
  }
  const online = info.data?.online ?? false;
  const run = async (refresh = false) => {
    try {
      setResult(await lookup.mutateAsync({ gstin: value, refresh }));
    } catch (err) {
      setResult(null);
      throw err;
    }
  };
  const d: GstinDetails | null = result?.online.details ?? null;
  const reason = result?.online.reason;
  return (
    <div className="grid gap-1.5 rounded-lg border bg-muted/30 p-2.5 text-meta" role="status">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          {t("billing.gstin.valid", { state: stateName(parts.stateCode) ?? parts.stateCode ?? "—", pan: parts.pan ?? "" })}
          {parts.panHolder ? ` · ${t(`billing.gstin.holder.${parts.panHolder}`)}` : ""}
        </span>
        {online && (
          <Button type="button" size="sm" variant="outline" className="ml-auto h-7" disabled={lookup.isPending} onClick={() => void run(!!result).catch(() => undefined)}>
            {lookup.isPending ? <Loader2Icon className="animate-spin" /> : <SearchIcon />}
            {result ? t("billing.gstin.refresh") : t("billing.gstin.lookup")}
          </Button>
        )}
      </div>
      {!online && info.isSuccess && <p className="text-muted-foreground">{t("billing.gstin.offlineOnly")}</p>}
      {lookup.isError && <p className="text-destructive">{describeError(lookup.error, t)}</p>}
      {result && result.online.found === false && <p className="text-muted-foreground">{t("billing.gstin.notFound")}</p>}
      {reason === "rate_limited" && !d && <p className="text-amber-700 dark:text-amber-400">{t("billing.gstin.rateLimited")}</p>}
      {reason === "provider_error" && !d && <p className="text-amber-700 dark:text-amber-400">{t("billing.gstin.providerError")}</p>}
      {d && (
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{t("billing.gstin.found", { name: d.legalName ?? d.tradeName ?? "—" })}</span>
            <GstinStatusBadge status={d.status} />
          </div>
          {d.tradeName && d.tradeName !== d.legalName && <span>{d.tradeName}</span>}
          {d.address && <span className="text-muted-foreground">{d.address}</span>}
          {(d.registrationType || d.constitution) && (
            <span className="text-muted-foreground">{t("billing.gstin.regType", { type: d.registrationType ?? "—", constitution: d.constitution ?? "—" })}</span>
          )}
          {result?.online.fetchedAt && <span className="text-muted-foreground">{t("billing.gstin.checked", { date: formatDate(result.online.fetchedAt) })}</span>}
          {onApply && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 justify-self-start"
              onClick={() => onApply({ name: d.legalName ?? d.tradeName, address: d.address, stateCode: d.stateCode ?? parts.stateCode })}
            >
              {t("billing.gstin.fill")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A warning when the party's GSTIN is cancelled, suspended or inactive in the lookup cache (no provider call is made
 * from here). Renders nothing for active or never-checked numbers.
 */
export function GstinStatusWarning({ gstin, className }: { gstin: string | null | undefined; className?: string }) {
  const { t, formatDate } = useI18n();
  const statuses = useGstinStatuses([gstin]);
  const key = gstin?.trim().toUpperCase() ?? "";
  const hit = key ? statuses.data?.items[key] : undefined;
  if (!hit || hit.status === "active" || hit.status === "unknown") return null;
  return (
    <Alert className={cn("border-destructive/40 bg-destructive/5", className)}>
      <AlertTriangleIcon className="text-destructive" />
      <AlertDescription>
        {t("billing.gstin.badStatus", { gstin: key, status: t(`billing.gstin.status.${hit.status}`).toLowerCase(), date: formatDate(hit.fetchedAt) })}
      </AlertDescription>
    </Alert>
  );
}
