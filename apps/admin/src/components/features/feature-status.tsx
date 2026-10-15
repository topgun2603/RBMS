"use client";

import { AppWindowIcon, CheckIcon, LayersIcon, LinkIcon, ToggleLeftIcon } from "lucide-react";
import { Badge } from "@srirealtime/ui";
import { featureLabel } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import type { FeatureReason, FeatureState } from "@/lib/types";

const reasonIcon: Record<FeatureReason, React.ComponentType<{ className?: string }>> = {
  app: AppWindowIcon,
  plan: LayersIcon,
  shop: ToggleLeftIcon,
  dependency: LinkIcon,
};

/** Labels of the dependencies that are currently off (what "Needs X" refers to). */
export function missingDeps(f: FeatureState, all: FeatureState[]): { key: string; label: string }[] {
  const byKey = new Map(all.map((s) => [s.key, s]));
  const missing = f.dependsOn.map((d) => byKey.get(d)).filter((d): d is FeatureState => !!d && !d.enabled);
  // Fall back to every declared dependency when the server didn't send their states.
  if (missing.length === 0) return f.dependsOn.map((d) => byKey.get(d) ?? { key: d, label: d });
  return missing;
}

/** On/off pill for super-admins: "On", or "Off" plus the level that turned it off. */
export function FeatureOnOffBadges({ feature, all }: { feature: FeatureState; all: FeatureState[] }) {
  const { t } = useI18n();
  if (feature.enabled) {
    return (
      <Badge variant="success" className="gap-1">
        <CheckIcon /> {t("admin.featuresUi.on")}
      </Badge>
    );
  }
  const reason = feature.reason;
  const Icon = reason ? reasonIcon[reason] : null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Badge variant="muted">{t("admin.featuresUi.off")}</Badge>
      {reason && Icon && (
        <Badge variant={reason === "plan" ? "warning" : "outline"} className="gap-1 font-normal">
          <Icon />
          {reason === "dependency"
            ? t("admin.featuresUi.needs", {
                feature: missingDeps(feature, all)
                  .map((d) => featureLabel(t, d))
                  .join(", "),
              })
            : t(`admin.featuresUi.reason.${reason}`)}
        </Badge>
      )}
    </div>
  );
}
