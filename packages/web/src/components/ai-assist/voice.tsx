"use client";

import * as React from "react";
import { MicIcon, MicOffIcon } from "lucide-react";
import { Button, cn } from "@rbms/ui";
import { useI18n } from "../../lib/i18n";

/**
 * Voice input for the AI panels (Web Speech API; Chrome sends the audio to Google's recogniser, so it needs internet).
 * The spoken language is chosen next to the mic (தமிழ் / English, remembered on this device) instead of following the
 * screen language, so an owner can speak Tamil with the app in English. Listens through short pauses, shows the words as
 * they are heard, and stops after a few seconds of silence or on a tap.
 */

export type VoiceLang = "ta" | "en";

type Alt = { transcript: string };
type ResultList = ArrayLike<ArrayLike<Alt> & { isFinal?: boolean }>;
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ResultList }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

const ctor = (): RecognitionCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const LANG_KEY = "sr_voice_lang";
const SILENCE_MS = 3000;
const MAX_MS = 60_000;

function storedLang(fallback: VoiceLang, key: string = LANG_KEY): VoiceLang {
  try {
    const v = window.localStorage.getItem(key);
    return v === "ta" || v === "en" ? v : fallback;
  } catch {
    return fallback;
  }
}

export type VoiceError = "denied" | "no-speech" | "network" | "unsupported-lang" | "failed";

/** The recogniser with interim results, silence stop and restart when Android ends a session early. */
export function useVoice(opts: {
  onText: (text: string, final: boolean) => void;
  /** The spoken language when the person has not chosen one yet (default: the screen language). Voice billing starts in Tamil. */
  defaultLang?: VoiceLang;
  /** Remember the chosen language under this key instead of the shared one (so a helper can have its own default). */
  storageKey?: string;
  /** Stop after this many ms of silence (default 3000). */
  silenceMs?: number;
}) {
  const { locale } = useI18n();
  const [supported, setSupported] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const [error, setError] = React.useState<VoiceError | null>(null);
  const [lang, setLangState] = React.useState<VoiceLang>(opts.defaultLang ?? (locale === "ta" ? "ta" : "en"));
  const rec = React.useRef<Recognition | null>(null);
  const want = React.useRef(false);
  const finals = React.useRef("");
  const silence = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = React.useRef(0);
  const onText = React.useRef(opts.onText);
  onText.current = opts.onText;

  React.useEffect(() => {
    setSupported(!!ctor());
    setLangState(storedLang(opts.defaultLang ?? (locale === "ta" ? "ta" : "en"), opts.storageKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the options are fixed for a mounted helper
  }, [locale]);

  const clearSilence = () => {
    if (silence.current) clearTimeout(silence.current);
    silence.current = null;
  };

  const stop = React.useCallback(() => {
    want.current = false;
    clearSilence();
    try {
      rec.current?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  React.useEffect(() => () => {
    want.current = false;
    clearSilence();
    try {
      rec.current?.abort();
    } catch {
      /* ignore */
    }
  }, []);

  const setLang = (l: VoiceLang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(opts.storageKey ?? LANG_KEY, l);
    } catch {
      /* private mode */
    }
    if (want.current) stop();
  };

  const armSilence = () => {
    clearSilence();
    silence.current = setTimeout(stop, opts.silenceMs ?? SILENCE_MS);
  };

  const launch = (Ctor: RecognitionCtor, l: VoiceLang) => {
    const r = new Ctor();
    r.lang = l === "ta" ? "ta-IN" : "en-IN";
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const said = res[0]?.transcript ?? "";
        if (res.isFinal) finals.current = `${finals.current} ${said}`.replace(/\s+/g, " ").trim();
        else interim += said;
      }
      const text = `${finals.current} ${interim}`.replace(/\s+/g, " ").trim();
      if (text) onText.current(text, !interim);
      armSilence();
    };
    r.onerror = (e) => {
      const code = e?.error;
      if (code === "no-speech" || code === "aborted") {
        if (code === "no-speech" && !finals.current) setError("no-speech");
        return;
      }
      want.current = false;
      setError(code === "not-allowed" || code === "service-not-allowed" ? "denied" : code === "network" ? "network" : code === "language-not-supported" ? "unsupported-lang" : "failed");
    };
    r.onend = () => {
      // Android Chrome ends "continuous" sessions after a pause: start again while the user still wants to talk.
      if (want.current && Date.now() - startedAt.current < MAX_MS) {
        try {
          launch(Ctor, l);
          return;
        } catch {
          /* fall through */
        }
      }
      want.current = false;
      clearSilence();
      setListening(false);
    };
    rec.current = r;
    r.start();
  };

  const start = () => {
    const Ctor = ctor();
    if (!Ctor) return;
    setError(null);
    finals.current = "";
    want.current = true;
    startedAt.current = Date.now();
    setListening(true);
    armSilence();
    try {
      launch(Ctor, lang);
    } catch {
      want.current = false;
      setListening(false);
      setError("failed");
    }
  };

  return { supported, listening, error, lang, setLang, start, stop, toggle: () => (want.current ? stop() : start()) };
}

const ERR_KEY: Record<VoiceError, string> = {
  denied: "web.voice.err.denied",
  "no-speech": "web.voice.err.noSpeech",
  network: "web.voice.err.network",
  "unsupported-lang": "web.voice.err.lang",
  failed: "web.voice.err.failed",
};

/** Language chip + mic, for a text box: what is said replaces the words spoken this time, after what was already typed. */
export function VoiceInput({ value, onChange, className, showLabel = false }: { value: string; onChange: (text: string) => void; className?: string; showLabel?: boolean }) {
  const { t } = useI18n();
  const base = React.useRef("");
  const v = useVoice({ onText: (text) => onChange(base.current ? `${base.current} ${text}` : text) });
  if (!v.supported) return null;
  const toggle = () => {
    if (!v.listening) base.current = value.trim();
    v.toggle();
  };
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      <VoiceLangChip lang={v.lang} onChange={v.setLang} />
      <Button type="button" size="sm" variant={v.listening ? "default" : "outline"} aria-pressed={v.listening} aria-label={v.listening ? t("web.voice.stop") : t("web.voice.start")} onClick={toggle}>
        {v.listening ? <MicOffIcon className="animate-pulse" /> : <MicIcon />}
        {showLabel && (v.listening ? t("web.voice.stop") : t("web.voice.start"))}
      </Button>
      {v.listening && <span className="text-xs text-muted-foreground" role="status">{t("web.voice.listening")}</span>}
      {v.error && <span className="basis-full text-xs text-destructive" role="alert">{t(ERR_KEY[v.error])}</span>}
    </span>
  );
}

/** Mic that hands over the final words (for "append to this note" uses). */
export function VoiceAppendButton({ onText, className }: { onText: (text: string) => void; className?: string }) {
  const { t } = useI18n();
  const [live, setLive] = React.useState("");
  const last = React.useRef("");
  const v = useVoice({
    onText: (text) => {
      last.current = text;
      setLive(text);
    },
  });
  React.useEffect(() => {
    if (!v.listening && last.current) {
      onText(last.current);
      last.current = "";
      setLive("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hand over once when listening stops
  }, [v.listening]);
  if (!v.supported) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      <VoiceLangChip lang={v.lang} onChange={v.setLang} />
      <Button type="button" size="sm" variant={v.listening ? "default" : "outline"} aria-pressed={v.listening} onClick={v.toggle}>
        {v.listening ? <MicOffIcon className="animate-pulse" /> : <MicIcon />} {v.listening ? t("web.voice.stop") : t("web.voice.start")}
      </Button>
      {v.listening && <span className="max-w-full truncate text-xs text-muted-foreground" role="status">{live || t("web.voice.listening")}</span>}
      {v.error && <span className="basis-full text-xs text-destructive" role="alert">{t(ERR_KEY[v.error])}</span>}
    </span>
  );
}

export function VoiceLangChip({ lang, onChange }: { lang: VoiceLang; onChange: (l: VoiceLang) => void }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex rounded-full border p-0.5 text-xs" role="group" aria-label={t("web.voice.lang")}>
      {(["ta", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => onChange(l)}
          className={cn("rounded-full px-2 py-0.5", lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
        >
          {l === "ta" ? "தமிழ்" : "EN"}
        </button>
      ))}
    </span>
  );
}
