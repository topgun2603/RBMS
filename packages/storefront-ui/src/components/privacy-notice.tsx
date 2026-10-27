import * as React from "react";
import { formatDate } from "../lib/format";
import type { Locale, Translator } from "../lib/messages";

interface NoticeSection {
  id: string;
  heading: string;
  paragraphs: string[];
  items?: string[];
}
interface NoticeText {
  title: string;
  intro: string;
  sections: NoticeSection[];
}
/** `GET /v1/consent/notice`: the shop's generated privacy notice in both languages (DPDP, docs/privacy-dpdp.md). */
export interface PublicNotice {
  version: number;
  createdAt: string;
  content: { en: NoticeText; ta: NoticeText };
}

/** The generated notice in the shopper's language. The "review with your lawyer" note is for the owner and is not shown here. */
export function NoticeBody({ notice, locale, t }: { notice: PublicNotice; locale: Locale; t: Translator }) {
  const text = notice.content[locale === "ta" ? "ta" : "en"];
  return (
    <section className="grid gap-6 text-[17px] leading-relaxed text-foreground/85" data-testid="privacy-notice" lang={locale}>
      <p className="text-sm text-muted-foreground">{t("privacy.noticeVersion", { version: notice.version, date: formatDate(notice.createdAt, locale) })}</p>
      <p>{text.intro}</p>
      {text.sections.map((s) => (
        <div key={s.id} className="grid gap-2">
          <h2 className="font-display text-xl font-semibold text-foreground">{s.heading}</h2>
          {s.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {s.items && s.items.length > 0 && (
            <ul className="list-disc space-y-1 pl-6">
              {s.items.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
