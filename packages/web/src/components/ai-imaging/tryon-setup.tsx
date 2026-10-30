"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, ScanFaceIcon, Trash2Icon } from "lucide-react";
import { Alert, AlertDescription, Button, Input, toast } from "@rbms/ui";
import { useI18n } from "../../lib/i18n";
import { delImg, getImg, postImg, putImg, useImgError, useImgHelper, type ProductImage, type Pt, type TryonAnchors, type TryonKind } from "./shared";

const KINDS: TryonKind[] = ["glasses", "earrings", "nosepin", "necklace"];
const DEFAULT_MM: Record<TryonKind, number> = { glasses: 140, earrings: 22, nosepin: 4, necklace: 150 };

interface Saved {
  tryon: { kind: TryonKind; imageUrl: string; anchors: TryonAnchors } | null;
}
interface Prepared {
  imageUrl: string;
  kind: TryonKind;
  anchors: TryonAnchors;
  needsCheck: boolean;
}

/** The draggable points of an anchors object: key, label, value, and how to write a moved point back. */
export function handlesOf(a: TryonAnchors): { id: string; point: Pt }[] {
  switch (a.kind) {
    case "glasses":
      return [
        { id: "leftEye", point: a.leftEye },
        { id: "rightEye", point: a.rightEye },
      ];
    case "earrings":
      return [{ id: "hook", point: a.hook }];
    case "nosepin":
      return [{ id: "stud", point: a.stud }];
    case "necklace":
      return [{ id: "top", point: a.top }];
  }
}
export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
export function movePoint(a: TryonAnchors, id: string, p: Pt): TryonAnchors {
  const q = { x: clamp01(p.x), y: clamp01(p.y) };
  return { ...a, [id]: q } as TryonAnchors;
}
export function freshAnchors(kind: TryonKind, widthMm?: number): TryonAnchors {
  const w = widthMm ? { widthMm } : {};
  switch (kind) {
    case "glasses":
      return { kind, leftEye: { x: 0.28, y: 0.5 }, rightEye: { x: 0.72, y: 0.5 }, ...w };
    case "earrings":
      return { kind, hook: { x: 0.5, y: 0.05 }, ...w };
    case "nosepin":
      return { kind, stud: { x: 0.5, y: 0.5 }, ...w };
    case "necklace":
      return { kind, top: { x: 0.5, y: 0.02 }, ...w };
  }
}

/**
 * Owner side of "Try it on": pick the product's photo, cut the product out automatically (or use a ready transparent PNG),
 * drag the alignment handles (eye line, hook point, ...) and save. The shopper's phone does the rest, on the phone only.
 */
export function TryonSetup({ productId, productName, images }: { productId: string; productName: string; images: ProductImage[] }) {
  const { t } = useI18n();
  const { show } = useImgHelper("ar-tryon");
  const errText = useImgError();
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["ai-img", "tryon", productId], queryFn: () => getImg<Saved>(`tryon/${productId}`), enabled: show, retry: false });
  const [kind, setKind] = React.useState<TryonKind>("glasses");
  const [source, setSource] = React.useState<string>("");
  const [ready, setReady] = React.useState(false);
  const [draft, setDraft] = React.useState<{ imageUrl: string; anchors: TryonAnchors; needsCheck: boolean } | null>(null);
  const [mm, setMm] = React.useState("");
  const [busy, setBusy] = React.useState<"cut" | "save" | "del" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!source && images[0]) setSource(images[0].url);
  }, [images, source]);
  React.useEffect(() => {
    const s = saved.data?.tryon;
    if (s && !draft) {
      setKind(s.kind);
      setDraft({ imageUrl: s.imageUrl, anchors: s.anchors, needsCheck: false });
      setMm(s.anchors.widthMm ? String(s.anchors.widthMm) : "");
    }
  }, [saved.data, draft]);
  if (!show) return null;

  const prepare = async () => {
    if (!source) return;
    setBusy("cut");
    setError(null);
    try {
      if (ready) {
        setDraft({ imageUrl: source, anchors: freshAnchors(kind), needsCheck: false });
      } else {
        const r = await postImg<Prepared>(`tryon/${productId}/prepare`, { imageUrl: source, kind });
        setDraft({ imageUrl: r.imageUrl, anchors: freshAnchors(kind), needsCheck: r.needsCheck });
      }
      setMm("");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const changeKind = (k: TryonKind) => {
    setKind(k);
    if (draft) setDraft({ ...draft, anchors: freshAnchors(k) });
  };
  const save = async () => {
    if (!draft) return;
    setBusy("save");
    setError(null);
    try {
      const widthMm = Number(mm);
      const anchors = { ...draft.anchors, ...(Number.isFinite(widthMm) && widthMm > 0 ? { widthMm } : { widthMm: undefined }) };
      await putImg(`tryon/${productId}`, { imageUrl: draft.imageUrl, anchors });
      toast.success(t("web.aiImg.tryon.saved"));
      await qc.invalidateQueries({ queryKey: ["ai-img", "tryon", productId] });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy("del");
    try {
      await delImg(`tryon/${productId}`);
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ["ai-img", "tryon", productId] });
      toast.success(t("web.aiImg.tryon.removed"));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="grid gap-3 rounded-xl p-4 ring-1 ring-border" aria-label={t("web.aiImg.tryon.title")} data-testid="tryon-setup">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ScanFaceIcon className="size-4" /> {t("web.aiImg.tryon.title")}
        </h3>
        <p className="text-meta text-muted-foreground">{t("web.aiImg.tryon.intro", { name: productName })}</p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("web.aiImg.tryon.kind")}>
        {KINDS.map((k) => (
          <Button key={k} type="button" role="radio" aria-checked={kind === k} size="sm" variant={kind === k ? "default" : "outline"} onClick={() => changeKind(k)}>
            {t(`web.aiImg.tryon.kind.${k}`)}
          </Button>
        ))}
      </div>
      {images.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">{t("web.aiImg.tryon.pick")}</p>
          <div className="flex flex-wrap gap-2">
            {images.map((i) => (
              <button
                key={i.url}
                type="button"
                aria-pressed={source === i.url}
                onClick={() => setSource(i.url)}
                className={`size-16 overflow-hidden rounded-lg ring-1 ring-border ${source === i.url ? "outline-2 outline-offset-2 outline-primary" : ""}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={i.url} alt={i.alt ?? ""} className="size-full object-cover" />
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} /> {t("web.aiImg.tryon.alreadyPng")}
          </label>
          <div>
            <Button type="button" variant="outline" size="sm" disabled={busy !== null || !source} onClick={() => void prepare()} data-testid="tryon-cut">
              {busy === "cut" && <Loader2Icon className="animate-spin" />} {ready ? t("web.aiImg.tryon.use") : t("web.aiImg.tryon.cut")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("web.aiImg.tryon.needPhoto")}</p>
      )}

      {draft && (
        <div className="grid gap-3">
          {draft.needsCheck && <p className="text-meta text-destructive">{t("web.aiImg.tryon.check")}</p>}
          <AnchorEditor imageUrl={draft.imageUrl} anchors={draft.anchors} onChange={(a) => setDraft({ ...draft, anchors: a })} />
          <label className="grid max-w-60 gap-1 text-sm">
            {t("web.aiImg.tryon.width")}
            <Input inputMode="decimal" value={mm} placeholder={String(DEFAULT_MM[draft.anchors.kind])} onChange={(e) => setMm(e.target.value.replace(/[^0-9.]/g, ""))} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy !== null} onClick={() => void save()} data-testid="tryon-save">
              {busy === "save" && <Loader2Icon className="animate-spin" />} {t("web.aiImg.tryon.save")}
            </Button>
            {saved.data?.tryon && (
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void remove()}>
                <Trash2Icon /> {t("web.aiImg.tryon.remove")}
              </Button>
            )}
          </div>
          <p className="text-meta text-muted-foreground">{t("web.aiImg.tryon.privacy")}</p>
        </div>
      )}
    </section>
  );
}

/** The cut-out on a chequered backdrop with draggable (and arrow-key movable) alignment handles. */
function AnchorEditor({ imageUrl, anchors, onChange }: { imageUrl: string; anchors: TryonAnchors; onChange: (a: TryonAnchors) => void }) {
  const { t } = useI18n();
  const box = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<string | null>(null);
  const at = (e: { clientX: number; clientY: number }): Pt => {
    const r = box.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const handles = handlesOf(anchors);
  return (
    <div className="grid gap-1">
      <div
        ref={box}
        className="relative w-full max-w-md touch-none select-none overflow-hidden rounded-lg ring-1 ring-border"
        style={{ backgroundImage: "repeating-conic-gradient(#e5e5e5 0% 25%, #fff 0% 50%)", backgroundSize: "16px 16px" }}
        onPointerMove={(e) => {
          if (drag.current) onChange(movePoint(anchors, drag.current, at(e)));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" className="block w-full" draggable={false} />
        {anchors.kind === "glasses" && (
          <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <line x1={anchors.leftEye.x * 100} y1={anchors.leftEye.y * 100} x2={anchors.rightEye.x * 100} y2={anchors.rightEye.y * 100} stroke="#e11d48" strokeWidth="0.6" strokeDasharray="2 1.5" />
          </svg>
        )}
        {handles.map((h) => (
          <button
            key={h.id}
            type="button"
            data-testid={`handle-${h.id}`}
            aria-label={t(`web.aiImg.tryon.handle.${h.id}`)}
            title={t(`web.aiImg.tryon.handle.${h.id}`)}
            className="absolute size-6 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full bg-rose-600/90 ring-2 ring-white active:cursor-grabbing"
            style={{ left: `${h.point.x * 100}%`, top: `${h.point.y * 100}%` }}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = h.id;
            }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.05 : 0.01;
              const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
              const m = d[e.key];
              if (!m) return;
              e.preventDefault();
              onChange(movePoint(anchors, h.id, { x: h.point.x + m[0], y: h.point.y + m[1] }));
            }}
          />
        ))}
      </div>
      <p className="text-meta text-muted-foreground">{t(`web.aiImg.tryon.hint.${anchors.kind}`)}</p>
    </div>
  );
}
