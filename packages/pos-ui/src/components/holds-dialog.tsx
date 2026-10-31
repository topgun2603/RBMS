"use client";

import * as React from "react";
import { PauseIcon, PlayIcon, Trash2Icon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  motion,
  Textarea,
} from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { money, timeShort } from "../lib/format";
import type { HeldBill } from "../lib/storage";

/** F8: name the bill (customer name or "Bill 14:05") and an optional note, then park it. */
export function HoldDialog({
  open,
  defaultName,
  onClose,
  onHold,
}: {
  open: boolean;
  defaultName: string;
  onClose: () => void;
  onHold: (name: string, note: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = React.useState("");
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setName(defaultName);
      setNote("");
    }
  }, [open, defaultName]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("pos.common.close")}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onHold(name.trim() || defaultName, note.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("pos.hold.title")}</DialogTitle>
            <DialogDescription>{t("pos.hold.body")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel>{t("pos.hold.name")}</FieldLabel>
            <FieldControl>
              <Input size="lg" value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} autoFocus onFocus={(e) => e.target.select()} />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel optional={t("pos.common.optional")}>{t("pos.hold.note")}</FieldLabel>
            <FieldControl>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={t("pos.hold.notePlaceholder")} />
            </FieldControl>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={onClose}>
              {t("pos.common.cancel")}
            </Button>
            <Button type="submit" size="lg">
              <PauseIcon /> {t("pos.hold.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** F7: held bills on this device for this cashier. Recalling while a cart is open parks the current one first. */
export function HoldsDialog({
  open,
  holds,
  onClose,
  onRecall,
  onDelete,
  cartHasItems,
}: {
  open: boolean;
  holds: HeldBill[];
  onClose: () => void;
  onRecall: (h: HeldBill) => void;
  onDelete: (id: string) => void;
  cartHasItems: boolean;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl" closeLabel={t("pos.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("pos.holds.title")}</DialogTitle>
          <DialogDescription>{cartHasItems ? t("pos.holds.swapHint") : t("pos.holds.body")}</DialogDescription>
        </DialogHeader>
        {holds.length === 0 ? (
          <EmptyState compact icon={PauseIcon} title={t("pos.holds.empty")} description={t("pos.holds.emptyHint")} />
        ) : (
          <ul className="grid max-h-[60dvh] gap-2 overflow-y-auto">
            <AnimatePresence initial={false}>
              {holds.map((h) => (
                <motion.li
                  key={h.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-3 rounded-xl border bg-card p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{h.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {t("pos.holds.meta", { count: h.lines.length, time: timeShort(h.createdAt) })} · {money(h.total)}
                    </p>
                    {h.note && <p className="mt-0.5 line-clamp-2 text-xs">{h.note}</p>}
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="text-destructive" aria-label={t("pos.holds.delete", { name: h.name })} onClick={() => onDelete(h.id)}>
                    <Trash2Icon />
                  </Button>
                  <Button type="button" size="lg" onClick={() => onRecall(h)}>
                    <PlayIcon /> {t("pos.holds.recall")}
                  </Button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
