"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@srirealtime/ui";
import { describeError, useI18n } from "@/lib/i18n";
import { useApplySolution, useSolutions } from "@/lib/solutions";

/** Moves a shop to another predefined solution: its look and starter content, and optionally its app. */
export function SolutionDialog({
  tenant,
  current,
  onClose,
}: {
  tenant: { id: string; name: string; appId: string | null } | null;
  current: string | null;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const solutions = useSolutions();
  const apply = useApplySolution();
  const [type, setType] = React.useState("");
  const [theme, setTheme] = React.useState(true);
  const [content, setContent] = React.useState(true);
  const [switchApp, setSwitchApp] = React.useState(false);
  const chosen = solutions.data?.find((s) => s.id === type);
  const appDiffers = !!chosen && !!tenant && chosen.appId !== tenant.appId;

  React.useEffect(() => {
    if (!tenant) return;
    setType(current ?? "");
    setTheme(true);
    setContent(true);
    setSwitchApp(false);
  }, [tenant, current]);
  React.useEffect(() => setSwitchApp(appDiffers), [appDiffers]);

  const save = async () => {
    if (!tenant || !type) return;
    try {
      await apply.mutateAsync({ tenantId: tenant.id, businessType: type, theme, content, switchApp: appDiffers && switchApp });
      toast.success(t("admin.solutions.applied", { name: tenant.name }));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={tenant !== null} onOpenChange={(o) => !o && !apply.isPending && onClose()}>
      <DialogContent closeLabel={t("admin.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("admin.solutions.change")}</DialogTitle>
          <DialogDescription>{tenant?.name}</DialogDescription>
        </DialogHeader>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-full" aria-label={t("admin.solutions.solution")}>
            <SelectValue placeholder={t("admin.solutions.pick")} />
          </SelectTrigger>
          <SelectContent>
            {solutions.data?.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {locale === "ta" ? s.nameTa : s.name} · {s.appId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {chosen && <p className="text-sm text-muted-foreground">{chosen.tagline}</p>}
        <div className="grid gap-3">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={theme} onCheckedChange={(v) => setTheme(v === true)} className="mt-0.5" />
            <span>
              {t("admin.solutions.applyLook", { look: chosen?.preset?.name ?? "—" })}
              <span className="block text-xs text-muted-foreground">{t("admin.solutions.applyLookHint")}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={content} onCheckedChange={(v) => setContent(v === true)} className="mt-0.5" />
            <span>
              {t("admin.solutions.applyContent")}
              <span className="block text-xs text-muted-foreground">{t("admin.solutions.applyContentHint")}</span>
            </span>
          </label>
          {appDiffers && (
            <label className="flex items-start gap-2 rounded-md bg-warning/10 p-2 text-sm">
              <Checkbox checked={switchApp} onCheckedChange={(v) => setSwitchApp(v === true)} className="mt-0.5" />
              <span>
                {t("admin.solutions.switchApp", { from: tenant?.appId ?? "—", to: chosen?.appId ?? "" })}
                <span className="block text-xs text-muted-foreground">{t("admin.solutions.switchAppHint")}</span>
              </span>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={apply.isPending}>
            {t("admin.common.cancel")}
          </Button>
          <Button onClick={save} disabled={apply.isPending || !type}>
            {apply.isPending && <Loader2Icon className="animate-spin" />}
            {t("admin.solutions.applyCta")}
          </Button>
        </DialogFooter>
        <Label className="sr-only">{t("admin.solutions.solution")}</Label>
      </DialogContent>
    </Dialog>
  );
}
