"use client";

import * as React from "react";
import { Input, Label } from "@rbms/ui";
import { splitTags } from "@/components/crud/resource-page";
import { FeatureMatrix, FeatureMatrixSkeleton } from "@/components/features/feature-matrix";
import { QueryError } from "@/components/query-state";
import { compressGrants, expandGrants, useFeatureRegistry } from "@/lib/features";
import { useI18n } from "@/lib/i18n";

/**
 * Plan `modules` editor: the grouped feature matrix for modules that declare features, plus a
 * free-text list for other module ids (e.g. notify, uploads) that don't, so nothing is lost.
 * Writes `module.*` when every feature of it is on, otherwise the individual feature keys.
 */
export function PlanModulesPicker({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const registry = useFeatureRegistry();
  const defs = registry.data;
  const { selected, unknown } = React.useMemo(() => expandGrants(value, defs ?? []), [value, defs]);

  // Local text for the "other modules" box so typing a trailing comma isn't swallowed.
  const [other, setOther] = React.useState(unknown.join(", "));
  const unknownKey = unknown.join(",");
  React.useEffect(() => {
    setOther((cur) => (splitTags(cur).join(",") === unknownKey ? cur : unknown.join(", ")));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync only when the parsed list changes
  }, [unknownKey]);

  if (registry.isError) {
    // Registry unavailable: keep the raw list editable.
    return (
      <div className="space-y-2">
        <QueryError compact error={registry.error} onRetry={() => void registry.refetch()} />
        <Input value={value.join(", ")} onChange={(e) => onChange(splitTags(e.target.value))} disabled={disabled} placeholder="invoices, notify" />
      </div>
    );
  }
  if (!defs) return <FeatureMatrixSkeleton cards={2} />;

  return (
    <div className="space-y-3">
      <FeatureMatrix
        defs={defs}
        value={selected}
        disabled={disabled}
        onChange={(next) => onChange([...compressGrants(next, defs), ...unknown])}
      />
      <div className="grid gap-1.5">
        <Label htmlFor="plan-other-modules" className="text-xs font-medium">
          {t("admin.featuresUi.otherModules")}
        </Label>
        <Input
          id="plan-other-modules"
          value={other}
          disabled={disabled}
          placeholder="notify, uploads, branding"
          onChange={(e) => {
            setOther(e.target.value);
            onChange([...compressGrants(selected, defs), ...splitTags(e.target.value)]);
          }}
        />
        <p className="text-xs text-muted-foreground">{t("admin.featuresUi.otherModulesHint")}</p>
      </div>
    </div>
  );
}
