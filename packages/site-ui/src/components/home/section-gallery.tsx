"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { HOME_SECTION_TYPES, type HomeSectionType } from "../../lib/content";
import { SECTION_ICONS, SectionThumb } from "./section-meta";

/** "Add a section" picker: one card per section type with a wireframe thumbnail and a one-line description. */
export function SectionGallery({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (type: HomeSectionType) => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("site.home.gallery.title")}</DialogTitle>
          <DialogDescription>{t("site.home.gallery.subtitle")}</DialogDescription>
        </DialogHeader>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {HOME_SECTION_TYPES.map((type) => {
            const Icon = SECTION_ICONS[type];
            return (
              <li key={type}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(type);
                    onOpenChange(false);
                  }}
                  className="group grid h-full w-full gap-2 rounded-xl border bg-card p-2.5 text-left outline-none transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-raised focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
                >
                  <span className="block rounded-lg bg-background p-1.5 text-primary ring-1 ring-border/70">
                    <SectionThumb type={type} className="h-auto w-full" />
                  </span>
                  <span className="flex items-center gap-1.5 text-sm font-medium group-hover:text-primary">
                    <Icon className="size-4 shrink-0" /> {t(`site.home.type.${type}`)}
                  </span>
                  <span className="text-xs leading-snug text-muted-foreground">{t(`site.home.typeHint.${type}`)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
