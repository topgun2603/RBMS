"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2Icon, StoreIcon } from "lucide-react";
import { Button, Input, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, toast } from "@rbms/ui";
import { FeatureMatrix, FeatureMatrixSkeleton } from "@/components/features/feature-matrix";
import { QueryError } from "@/components/query-state";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { api } from "@/lib/api";
import { expandGrants, explicitGrants, featureKeys, useFeatureRegistry } from "@/lib/features";
import { describeError, useI18n } from "@/lib/i18n";
import type { AppProfile } from "@/lib/types";

const appSchema = z.object({
  appId: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9]{1,7}$/, "admin.featuresUi.appIdInvalid"),
  name: z.string().trim().min(1, "admin.validation.required").max(80, "admin.validation.tooLong"),
});
type AppValues = z.infer<typeof appSchema>;

export type AppEditing = { mode: "create" } | { mode: "edit"; profile: AppProfile } | null;

/** Platform → Apps & features: create an app profile or change the features it offers (every module, every feature). */
export function AppEditorSheet({ editing, existing, onClose }: { editing: AppEditing; existing: AppProfile[]; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const registry = useFeatureRegistry();
  const defs = registry.data;
  const profile = editing?.mode === "edit" ? editing.profile : null;

  const form = useForm<AppValues>({ resolver: zodResolver(appSchema), defaultValues: { appId: "", name: "" } });
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dirtyFeatures, setDirtyFeatures] = React.useState(false);

  // Reset when the target changes (and once the registry arrives for a new profile).
  React.useEffect(() => {
    if (!editing) return;
    form.reset(profile ? { appId: profile.appId, name: profile.name } : { appId: "", name: "" });
    setDirtyFeatures(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the sheet target changes
  }, [editing]);
  React.useEffect(() => {
    if (!editing || !defs) return;
    // New profiles start with everything on; switch off what this product doesn't offer.
    setSelected(profile ? expandGrants(profile.features, defs).selected : new Set(defs.map((d) => d.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, defs]);

  const save = useMutation({
    mutationFn: (v: AppValues) =>
      api.put<AppProfile>(
        `/features/apps/${encodeURIComponent(v.appId)}`,
        { name: v.name, features: explicitGrants(selected, defs ?? []) },
        { tenant: null },
      ),
    onSuccess: (_r, v) => {
      toast.success(t("admin.featuresUi.appSaved", { name: v.name }));
      void qc.invalidateQueries({ queryKey: featureKeys.all });
      onClose();
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const submit = form.handleSubmit((v) => {
    if (!profile && existing.some((p) => p.appId === v.appId)) {
      form.setError("appId", { message: "admin.featuresUi.appIdTaken" });
      return;
    }
    save.mutate(v);
  });

  const total = defs?.length ?? 0;

  return (
    <Sheet open={editing !== null} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-3xl" closeLabel={t("admin.common.close")}>
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{profile ? t("admin.featuresUi.editApp") : t("admin.featuresUi.newApp")}</SheetTitle>
          <SheetDescription>{t("admin.featuresUi.editorHint")}</SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
              <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("admin.common.name")}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={t("admin.featuresUi.namePlaceholder")} autoFocus={!profile} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="appId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("admin.featuresUi.appId")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          onChange={(e) => field.onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                          readOnly={!!profile}
                          disabled={!!profile}
                          placeholder="EC"
                          className="font-mono uppercase"
                          autoCapitalize="characters"
                          spellCheck={false}
                        />
                      </FormControl>
                      <FormDescription>{t("admin.featuresUi.appIdHint")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">{t("admin.platform.features")}</h3>
                    <p className="text-xs text-muted-foreground">
                      {total ? t("admin.featuresUi.selectedCount", { on: selected.size, total }) : t("admin.featuresUi.matrixHint")}
                    </p>
                  </div>
                  {defs && defs.length > 0 && (
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelected(new Set(defs.map((d) => d.key)));
                          setDirtyFeatures(true);
                        }}
                      >
                        {t("admin.featuresUi.allOn")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelected(new Set());
                          setDirtyFeatures(true);
                        }}
                      >
                        {t("admin.featuresUi.allOff")}
                      </Button>
                    </div>
                  )}
                </div>
                {registry.isError ? (
                  <QueryError compact error={registry.error} onRetry={() => void registry.refetch()} />
                ) : !defs ? (
                  <FeatureMatrixSkeleton />
                ) : (
                  <FeatureMatrix
                    defs={defs}
                    value={selected}
                    disabled={save.isPending}
                    onChange={(next) => {
                      setSelected(next);
                      setDirtyFeatures(true);
                    }}
                  />
                )}
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t bg-background p-4 sm:flex-row sm:items-center">
              {profile && profile.tenantCount > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground sm:mr-auto">
                  <StoreIcon className="size-3.5" />
                  {t("admin.featuresUi.affects", { count: profile.tenantCount })}
                </p>
              )}
              <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row">
                <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
                  {t("admin.common.cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={save.isPending || !defs || (!!profile && !form.formState.isDirty && !dirtyFeatures)}
                >
                  {save.isPending && <Loader2Icon className="animate-spin" />}
                  {t("admin.common.save")}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
