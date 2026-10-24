"use client";

import * as React from "react";
import { CameraIcon, Loader2Icon, MicIcon, MicOffIcon } from "lucide-react";
import { Button } from "@srirealtime/ui";
import { ApiError, api } from "../../lib/api";
import { describeError, useI18n } from "../../lib/i18n";
import { useAiAssistAllowed, useAiAssistStatus } from "../ai-assist/use-assist";

/**
 * Pieces shared by the Phase 3 part C helpers (repair, tailoring, salon / gym win-back, hardware quotes; docs/ai.md).
 * Every helper only drafts: the person reads the result and chooses what goes into the form.
 */

/** Whether a helper's button shows: the person may use AI and the module's permission, the helper is listed for the shop. */
export function useTradesHelper(key: string, permission: string | readonly string[]) {
  const allowed = useAiAssistAllowed(permission);
  const status = useAiAssistStatus(allowed);
  const listed = !!status.data?.features.some((f) => f.key === key);
  return { show: allowed && listed, status: status.data };
}

export const TRADES_API = "/ai/trades-c";
export const postTrades = <T,>(path: string, body: unknown) => api.post<T>(`${TRADES_API}/${path}`, body);

export interface Run {
  runId: string;
  credits: number;
  provider: "claude" | "mock";
}

/** The message for a failed call: our photo codes first, then the shared AI messages (off, credits, busy...). */
export function useTradesError() {
  const { t } = useI18n();
  return React.useCallback(
    (e: unknown) => {
      if (e instanceof ApiError) {
        if (e.code === "ai_unreadable_image") return t("web.aiTrades.unreadable");
        if (e.code === "ai_bad_image" || e.status === 413) return t("web.aiTrades.badImage");
        if (e.code === "feature_unavailable") return t("web.aiTrades.noModule");
        if (e.code === "opted_out") return t("web.aiTrades.winback.optedOutError");
        if (e.code === "not_at_risk") return t("web.aiTrades.winback.gone");
      }
      return describeError(e, t);
    },
    [t],
  );
}

// ------------------------------------------------------------------ photos

const MAX_SIDE = 1800;
const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("unreadable"));
    r.readAsDataURL(blob);
  });

/** A photo to a JPEG no bigger than 1800 px on its longest side (phone photos are 12 MP). */
export async function shrinkPhoto(file: File): Promise<{ mediaType: "image/jpeg"; data: string }> {
  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("unreadable");
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("unreadable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("unreadable");
    return { mediaType: "image/jpeg", data: await toBase64(blob) };
  } finally {
    bmp.close();
  }
}

/** A "Choose a photo" button: opens the camera or gallery on a phone and hands back the shrunk photos. */
export function PhotoButton({
  label,
  busy,
  onPhotos,
  onError,
  multiple,
  variant = "default",
}: {
  label: string;
  busy?: boolean;
  onPhotos: (photos: { mediaType: "image/jpeg"; data: string }[]) => void;
  onError: (message: string) => void;
  multiple?: boolean;
  variant?: "default" | "outline";
}) {
  const { t } = useI18n();
  const ref = React.useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="ai-trades-photo-input"
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])].slice(0, multiple ? 2 : 1);
          e.target.value = "";
          if (files.length === 0) return;
          try {
            onPhotos(await Promise.all(files.map(shrinkPhoto)));
          } catch {
            onError(t("web.aiTrades.badImage"));
          }
        }}
      />
      <Button type="button" variant={variant} disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? <Loader2Icon className="animate-spin" /> : <CameraIcon />} {label}
      </Button>
    </>
  );
}

// ------------------------------------------------------------------ speech

type SpeechCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
const speechCtor = (): SpeechCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** A small mic button (Web Speech API, ta-IN / en-IN) that appends what was said. Hidden where the browser has no speech recognition. */
export function MicButton({ onText }: { onText: (text: string) => void }) {
  const { t, locale } = useI18n();
  const [ok, setOk] = React.useState(false);
  const [on, setOn] = React.useState(false);
  const rec = React.useRef<InstanceType<SpeechCtor> | null>(null);
  React.useEffect(() => setOk(!!speechCtor()), []);
  if (!ok) return null;
  const toggle = () => {
    if (on) {
      rec.current?.stop();
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = locale === "ta" ? "ta-IN" : "en-IN";
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      const text = Array.from(e.results as ArrayLike<ArrayLike<{ transcript: string }>>)
        .map((x) => x[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (text) onText(text);
    };
    r.onerror = () => setOn(false);
    r.onend = () => setOn(false);
    rec.current = r;
    setOn(true);
    r.start();
  };
  return (
    <Button type="button" size="sm" variant="outline" aria-pressed={on} aria-label={on ? t("web.aiTrades.micStop") : t("web.aiTrades.mic")} onClick={toggle}>
      {on ? <MicOffIcon /> : <MicIcon />} {on ? t("web.aiTrades.micStop") : t("web.aiTrades.mic")}
    </Button>
  );
}

export const rupeesText = (paise: number) => `₹${(Math.round(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
