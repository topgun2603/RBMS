import { FileWarningIcon } from "lucide-react";
import type { Translator } from "@srirealtime/i18n/client";
import { Card } from "@srirealtime/ui/components/card";
import { FadeIn, Reveal } from "@srirealtime/ui/motion";
import { Container } from "./sections";

/** Legal page shell with an unmistakable "placeholder" banner. */
export function LegalPage({ t, title, sections }: { t: Translator; title: string; sections: { h: string; p: string }[] }) {
  return (
    <Container className="max-w-3xl py-12 sm:py-16">
      <FadeIn y={8}>
        <h1 className="mb-6 font-display text-4xl font-bold text-balance">{title}</h1>
      </FadeIn>
      <FadeIn delay={0.08} y={8}>
        <Card role="note" className="mb-10 flex-row items-start gap-3 rounded-2xl border-2 border-dashed border-warning bg-warning/10 p-5" data-testid="legal-placeholder">
          <FileWarningIcon className="mt-0.5 size-5 shrink-0 text-warning-ink" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold text-warning-ink">{t("legal.placeholder")}</p>
            <p className="text-sm">{t("legal.placeholderBody")}</p>
          </div>
        </Card>
      </FadeIn>
      <div className="space-y-8">
        {sections.map((s) => (
          <Reveal key={s.h} as="section" className="space-y-2">
            <h2 className="font-display text-xl font-semibold">{s.h}</h2>
            <p className="text-muted-foreground">
              <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{t("legal.placeholder")}</span>
              {s.p}
            </p>
          </Reveal>
        ))}
      </div>
    </Container>
  );
}
