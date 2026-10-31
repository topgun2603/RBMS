"use client";

import * as React from "react";
import { CopyIcon, ExternalLinkIcon, Loader2Icon, MonitorIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@rbms/ui";
import { api, ConfirmDialog, describeError, useI18n } from "@rbms/web";
import { displayPath } from "../../lib/display";
import { useDisplayActions, useDisplays, type DisplayPairing, type DisplayView } from "../../lib/display-client";
import { timeShort } from "../../lib/format";

/**
 * The counter's "Customer display" dialog: open the screen on this computer (no setup), or pair another screen or
 * tablet with a 6-digit code, see which screens are connected, change their language and remove them.
 */
export function DisplayDialog({ open, onClose, register }: { open: boolean; onClose: () => void; register: string }) {
  const { t } = useI18n();
  const list = useDisplays(register, open);
  const actions = useDisplayActions(register);
  const [name, setName] = React.useState("");
  const [shown, setShown] = React.useState<{ name: string; pairing: DisplayPairing } | null>(null);
  const [removing, setRemoving] = React.useState<DisplayView | null>(null);
  React.useEffect(() => {
    if (open) setShown(null);
  }, [open]);

  const path = typeof window === "undefined" ? "/pos/display" : displayPath(window.location.pathname);
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;
  const items = list.data ?? [];

  const create = async () => {
    const n = name.trim() || t("pos.display.namePlaceholder");
    try {
      const r = await actions.create.mutateAsync({ name: n });
      setShown({ name: n, pairing: r.pairing });
      setName("");
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const newCode = async (d: DisplayView) => {
    try {
      setShown({ name: d.name, pairing: await actions.newCode.mutateAsync(d.id) });
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const language = async (d: DisplayView, v: string) => {
    try {
      await api(`/pos/displays/${d.id}`, { method: "PATCH", body: { settings: { language: v } } });
      await list.refetch();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-xl" closeLabel={t("pos.common.close")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MonitorIcon className="size-5" /> {t("pos.display.title")}
            </DialogTitle>
            <DialogDescription>{t("pos.display.intro")}</DialogDescription>
          </DialogHeader>

          <section className="grid gap-2 rounded-xl border p-3">
            <h3 className="text-sm font-semibold">{t("pos.display.thisPc")}</h3>
            <p className="text-sm text-muted-foreground">{t("pos.display.thisPcBody")}</p>
            <div>
              <Button type="button" variant="outline" onClick={() => window.open(displayPath(window.location.pathname, register), "sr-pos-display", "popup,width=1024,height=640")}>
                <ExternalLinkIcon /> {t("pos.display.openHere")}
              </Button>
            </div>
          </section>

          <section className="grid gap-2">
            <h3 className="text-sm font-semibold">{t("pos.display.screens", { register })}</h3>
            {list.isPending ? (
              <Skeleton className="h-14 rounded-xl" />
            ) : list.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{describeError(list.error, t)}</AlertDescription>
              </Alert>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("pos.display.none")}</p>
            ) : (
              <ul className="grid gap-2">
                {items.map((d) => (
                  <li key={d.id} className="grid gap-2 rounded-xl border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{d.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {d.paired ? `${t("pos.display.paired")}${d.lastSeenAt ? ` · ${t("pos.display.seen", { time: timeShort(d.lastSeenAt) })}` : ""}` : t("pos.display.waiting")}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button type="button" size="sm" variant="outline" onClick={() => void newCode(d)}>
                          <RefreshCwIcon /> {t("pos.display.newCode")}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setRemoving(d)}>
                          <Trash2Icon /> {t("pos.display.remove")}
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{t("pos.display.language")}</span>
                      <ToggleGroup type="single" size="sm" variant="outline" value={d.settings.language ?? "auto"} onValueChange={(v) => v && void language(d, v)} aria-label={t("pos.display.language")}>
                        {(["auto", "en", "ta"] as const).map((l) => (
                          <ToggleGroupItem key={l} value={l} className="h-7 px-2 text-xs">
                            {t(`pos.display.lang.${l}`)}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {shown && (
              <div className="grid gap-2 rounded-xl border border-primary/40 bg-primary/5 p-4 text-center">
                <p className="text-sm font-medium">{t("pos.display.codeTitle", { name: shown.name })}</p>
                <p className="font-mono text-4xl font-bold tracking-[0.3em]" data-testid="display-code">
                  {shown.pairing.code}
                </p>
                <p className="text-sm text-muted-foreground">{t("pos.display.codeBody", { url })}</p>
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void navigator.clipboard?.writeText(url).then(() => toast.success(t("pos.display.copied")))}
                  >
                    <CopyIcon /> {t("pos.display.copy")}
                  </Button>
                </div>
              </div>
            )}

            <form
              className="grid gap-2 pt-1"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <Field>
                <FieldLabel>{t("pos.display.name")}</FieldLabel>
                <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={t("pos.display.namePlaceholder")} />
              </Field>
              <div>
                <Button type="submit" disabled={actions.create.isPending}>
                  {actions.create.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} {t("pos.display.create")}
                </Button>
              </div>
            </form>
          </section>
          <p className="text-xs text-muted-foreground">{t("pos.display.idleHint")}</p>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("pos.display.removeTitle", { name: removing?.name ?? "" })}
        description={t("pos.display.removeBody")}
        confirmLabel={t("pos.display.remove")}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await actions.revoke.mutateAsync(removing.id);
            toast.success(t("pos.display.removed"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </>
  );
}

