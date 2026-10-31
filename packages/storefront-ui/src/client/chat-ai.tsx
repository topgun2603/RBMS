"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2Icon, MessageCircleIcon, SendHorizontalIcon, ShoppingBagIcon, SparklesIcon } from "lucide-react";
import { STORE_PATHS } from "@rbms/cms/seo";
import { Button } from "@rbms/ui/components/button";
import { Textarea } from "@rbms/ui/components/textarea";
import { cn } from "@rbms/ui/lib/utils";
import { StoreImage } from "../components/bits";
import { imageUrl, money } from "../lib/format";
import { ApiError, call } from "./api";
import { useQuickAdd } from "./product-card";
import { useStore } from "./store-context";

/** What the API sends back for a shopper question (AI Phase 4 part B, `POST /v1/ai/store/public/chat`). */
export interface AiChatCard {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  price: number;
  priceMax: number;
  mrp: number | null;
  inStock: boolean;
  variantId: string | null;
  variantCount: number;
  kind: "product" | "service";
}
interface AiChatReply {
  available: boolean;
  answer?: string;
  cards?: AiChatCard[];
  handoff?: boolean;
}
interface Turn {
  id: number;
  role: "user" | "assistant";
  text: string;
  cards?: AiChatCard[];
  handoff?: boolean;
  /** The question this answer is for (for the WhatsApp text). */
  question?: string;
}

const HISTORY = 8;

/**
 * Whether the shop offers the AI mode right now (opt-in, plan, credits and the daily cap are checked by the server). Asked each
 * time the panel opens; any error means "not offered" so the panel is the plain human chat.
 */
export function useAiChatAvailable(open: boolean, enabled: boolean): boolean | null {
  const [available, setAvailable] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (!open || !enabled) return;
    let alive = true;
    call<{ available: boolean }>("/ai/store/public/chat/status", { auth: false })
      .then((r) => alive && setAvailable(!!r.available))
      .catch(() => alive && setAvailable(false));
    return () => {
      alive = false;
    };
  }, [open, enabled]);
  return enabled ? available : false;
}

/**
 * The AI mode of the chat panel: a short conversation with the shop's assistant. Answers come from this store's own data on the
 * server; product cards are built from catalogue data (never from the model's text) with a real Add to cart. "Talk to the shop"
 * (the human chat) and WhatsApp are always one tap away, and when the server says the AI mode is not available (daily cap,
 * switched off) the panel quietly falls back to the human chat.
 */
export function AiChatPane({ onHandoff, onUnavailable }: { onHandoff(): void; onUnavailable(): void }) {
  const { t, shell, locale, auth } = useStore();
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const scroller = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLTextAreaElement>(null);
  const seq = React.useRef(0);

  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, busy]);

  const ask = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    const history = turns.slice(-HISTORY).map((x) => ({ role: x.role, text: x.text }));
    setTurns((p) => [...p, { id: ++seq.current, role: "user", text: message }]);
    setDraft("");
    setBusy(true);
    try {
      const r = await call<AiChatReply>("/ai/store/public/chat", { method: "POST", body: { message, history, locale }, auth: !!auth.token });
      if (!r.available) {
        onUnavailable();
        return;
      }
      setTurns((p) => [...p, { id: ++seq.current, role: "assistant", text: r.answer ?? "", cards: r.cards ?? [], handoff: !!r.handoff, question: message }]);
    } catch (err) {
      const limited = err instanceof ApiError && err.status === 429;
      setTurns((p) => [...p, { id: ++seq.current, role: "assistant", text: t(limited ? "aichat.rateLimited" : "aichat.error"), handoff: true, question: message }]);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <>
      <div ref={scroller} className="flex-1 overflow-y-auto overscroll-contain px-3 py-3" aria-live="polite" data-testid="aichat-thread">
        <div className="mb-3 flex gap-2.5 rounded-2xl bg-primary/5 p-3 text-sm" data-testid="aichat-intro">
          <SparklesIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div>
            <p>{t("aichat.intro", { shop: shell.name })}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("aichat.notice")}</p>
          </div>
        </div>
        {turns.length === 0 && (
          <div className="flex flex-wrap gap-2" aria-label={t("aichat.starters")}>
            {(["aichat.starter.1", "aichat.starter.2", "aichat.starter.3"] as const).map((k) => (
              <button key={k} type="button" onClick={() => void ask(t(k))} className="rounded-full border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary/40 hover:text-primary focus-ring" data-testid="aichat-starter">
                {t(k)}
              </button>
            ))}
          </div>
        )}
        <ol className="grid gap-2">
          {turns.map((m) => (
            <li key={m.id} className={cn("flex flex-col", m.role === "user" ? "items-end" : "items-start")} data-testid={m.role === "user" ? "aichat-user" : "aichat-answer"}>
              <div
                className={cn(
                  "max-w-[88%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap shadow-xs",
                  m.role === "user" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground",
                )}
              >
                {m.text}
              </div>
              {m.cards && m.cards.length > 0 && (
                <ul className="mt-2 grid w-full max-w-[94%] gap-2">
                  {m.cards.map((c) => (
                    <li key={c.id}>
                      <AiProductCard card={c} />
                    </li>
                  ))}
                </ul>
              )}
              {m.role === "assistant" && m.handoff && <HandoffRow question={m.question ?? ""} onHandoff={onHandoff} />}
            </li>
          ))}
          {busy && (
            <li className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="aichat-thinking">
              <Loader2Icon className="size-3.5 animate-spin" />
              {t("aichat.thinking")}
            </li>
          )}
        </ol>
      </div>
      <div className="border-t bg-background px-3 pt-2 pb-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
        >
          <Textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(draft);
              }
            }}
            rows={1}
            maxLength={400}
            placeholder={t("aichat.placeholder")}
            aria-label={t("aichat.placeholder")}
            className="max-h-32 min-h-11 resize-none rounded-2xl bg-muted/40 py-2.5"
            data-testid="aichat-input"
          />
          <Button type="submit" size="icon-lg" className="rounded-full" disabled={!draft.trim() || busy} aria-label={t("aichat.send")} data-testid="aichat-send">
            {busy ? <Loader2Icon className="animate-spin" /> : <SendHorizontalIcon />}
          </Button>
        </form>
        <button type="button" onClick={onHandoff} className="mt-2 flex w-full items-center justify-center gap-1.5 text-xs font-medium text-primary hover:underline focus-ring" data-testid="aichat-talk">
          <MessageCircleIcon className="size-3.5" />
          {t("aichat.handoff")}
        </button>
      </div>
    </>
  );
}

function HandoffRow({ question, onHandoff }: { question: string; onHandoff(): void }) {
  const { t, shell } = useStore();
  const wa = shell.whatsapp ? whatsappLink(shell.whatsapp, t("aichat.whatsappText", { shop: shell.name, question })) : null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2" data-testid="aichat-handoff">
      <span className="text-xs text-muted-foreground">{t("aichat.handoffHint")}</span>
      <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={onHandoff}>
        <MessageCircleIcon />
        {t("aichat.handoff")}
      </Button>
      {wa && (
        <Button asChild size="sm" variant="outline" className="rounded-full">
          <a href={wa} target="_blank" rel="noopener noreferrer">
            {t("aichat.whatsapp")}
          </a>
        </Button>
      )}
    </div>
  );
}

function whatsappLink(v: string, text: string): string | null {
  if (/^https?:\/\//i.test(v)) return v;
  const d = v.replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}?text=${encodeURIComponent(text)}`;
}

function AiProductCard({ card }: { card: AiChatCard }) {
  const { t } = useStore();
  const add = useQuickAdd({ id: card.id, slug: card.slug, name: card.name, image: card.image, variantCount: card.variantCount });
  const href = STORE_PATHS.product(card.slug);
  const range = card.priceMax > card.price;
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-card p-2.5 shadow-xs" data-testid="aichat-card">
      <Link href={href} className="size-16 shrink-0 overflow-hidden rounded-xl bg-muted" tabIndex={-1} aria-hidden>
        <StoreImage src={imageUrl(card.image)} alt={card.name} name={card.name} className="size-full object-cover" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={href} className="line-clamp-2 text-sm font-semibold hover:underline">
          {card.name}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold tabular-nums">{range ? t("aichat.from", { price: money(card.price) }) : money(card.price)}</span>
          {card.mrp && card.mrp > card.price && !range && <span className="text-xs text-muted-foreground line-through tabular-nums">{money(card.mrp)}</span>}
        </p>
        <p className={cn("text-xs", card.inStock ? "text-success-ink" : "text-danger-ink")}>{card.inStock ? t("aichat.inStock") : t("aichat.outOfStock")}</p>
      </div>
      {card.kind === "service" ? (
        <Button asChild size="sm" variant="outline" className="rounded-full">
          <Link href={href}>{t("aichat.view")}</Link>
        </Button>
      ) : (
        <Button type="button" size="sm" className="rounded-full" disabled={!card.inStock || add.busy} onClick={(e) => void add.run(e.currentTarget)} data-testid="aichat-add">
          {add.busy ? <Loader2Icon className="animate-spin" /> : <ShoppingBagIcon />}
          {card.variantCount > 1 ? t("aichat.chooseOptions") : t("aichat.addToCart")}
        </Button>
      )}
    </div>
  );
}
