"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CopyIcon, DownloadIcon, Loader2Icon, MegaphoneIcon, Share2Icon } from "lucide-react";
import { Alert, AlertDescription, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Label, toast } from "@srirealtime/ui";
import { api } from "../../lib/api";
import { describeError, useI18n } from "../../lib/i18n";
import { useAiAssistAllowed, useAiAssistStatus } from "../ai-assist/use-assist";

interface Draft {
  instagram: { en: string; ta: string };
  whatsapp: { en: string; ta: string };
  hashtags: string[];
  removed: { sentence: string; reason: string }[];
  isNew: boolean;
}
interface PostResult {
  productId: string;
  product: { name: string; price: number | null };
  draft: Draft;
  source: "ai" | "template";
  credits: number;
  image: string | null;
}
interface NewArrival {
  id: string;
  name: string;
  image: string | null;
  price: number | null;
  createdAt: string;
}

function useSocialAllowed() {
  const allowed = useAiAssistAllowed("catalogue.manage");
  const status = useAiAssistStatus(allowed);
  return allowed && !!status.data?.features.some((f) => f.key === "social-posts");
}

const fileOf = async (dataUrl: string, name: string) => {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: blob.type });
};

/** One caption with a copy button. */
function Caption({ title, lang, text }: { title: string; lang: "en" | "ta"; text: string }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-1" data-testid={`caption-${lang}`}>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{title}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void navigator.clipboard?.writeText(text).then(() => toast.success(t("web.aiStore.social.copied")))}
        >
          <CopyIcon /> {t("web.aiStore.social.copy")}
        </Button>
      </div>
      <p lang={lang} className="rounded-md border bg-muted/30 p-2.5 text-sm whitespace-pre-wrap">
        {text}
      </p>
    </div>
  );
}

/** The result: picture (download / share), captions per language, hashtags. */
function PostView({ r }: { r: PostResult }) {
  const { t } = useI18n();
  const canShare = typeof navigator !== "undefined" && typeof navigator.canShare === "function";
  const file = `${r.product.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "post"}.png`;
  const share = async () => {
    if (!r.image) return;
    try {
      const f = await fileOf(r.image, file);
      const text = `${r.draft.instagram.en}\n\n${r.draft.hashtags.map((h) => `#${h}`).join(" ")}`;
      if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], text });
      else await navigator.share({ text });
      toast.success(t("web.aiStore.social.shared"));
    } catch {
      /* cancelled */
    }
  };
  const tags = r.draft.hashtags.map((h) => `#${h}`).join(" ");
  return (
    <div className="grid gap-4" data-testid="social-result">
      <p className="text-xs text-muted-foreground">{t("web.aiStore.social.checkFirst")}</p>
      {r.image && (
        <div className="grid gap-2">
          <img src={r.image} alt={r.product.name} className="mx-auto aspect-square w-full max-w-sm rounded-xl border object-cover" data-testid="social-image" />
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={r.image} download={file} data-testid="social-download">
                <DownloadIcon /> {t("web.aiStore.social.download")}
              </a>
            </Button>
            {canShare && (
              <Button type="button" variant="outline" size="sm" onClick={() => void share()}>
                <Share2Icon /> {t("web.aiStore.social.share")}
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="grid gap-3">
        <p className="text-sm font-medium">{t("web.aiStore.social.insta")}</p>
        <Caption title={t("web.aiStore.social.english")} lang="en" text={r.draft.instagram.en} />
        <Caption title={t("web.aiStore.social.tamil")} lang="ta" text={r.draft.instagram.ta} />
        <p className="text-sm font-medium">{t("web.aiStore.social.status")}</p>
        <Caption title={t("web.aiStore.social.english")} lang="en" text={r.draft.whatsapp.en} />
        <Caption title={t("web.aiStore.social.tamil")} lang="ta" text={r.draft.whatsapp.ta} />
        {tags && (
          <div className="grid gap-1">
            <Label className="text-xs">{t("web.aiStore.social.hashtags")}</Label>
            <p className="rounded-md border bg-muted/30 p-2.5 text-sm break-words" data-testid="social-hashtags">
              {tags}
            </p>
          </div>
        )}
      </div>
      {r.draft.removed.length > 0 && <p className="text-xs text-muted-foreground">{t("web.aiStore.social.removed", { count: r.draft.removed.length })}</p>}
      {r.source === "template" && <p className="text-xs text-muted-foreground">{t("web.aiStore.social.fromTemplate")}</p>}
      {r.credits > 0 && <p className="text-xs text-muted-foreground">{t("web.aiStore.social.used", { credits: r.credits })}</p>}
    </div>
  );
}

function usePost() {
  const { t } = useI18n();
  return useMutation({
    mutationFn: (p: { productId: string; badge: boolean }) => api.post<PostResult>(`/ai/store/social/${p.productId}`, { badge: p.badge, format: "png", includeImage: true }),
    onError: (e) => toast.error(describeError(e, t)),
  });
}

/** "Social post" for one product (product editor or list row). */
export function SocialPostButton({ productId, className }: { productId?: string; className?: string }) {
  const { t } = useI18n();
  const allowed = useSocialAllowed();
  const [open, setOpen] = React.useState(false);
  const post = usePost();
  if (!allowed || !productId) return null;
  return (
    <>
      <Button type="button" variant="outline" size="sm" className={className} onClick={() => setOpen(true)} data-testid="social-post-button">
        <MegaphoneIcon /> {t("web.aiStore.social.button")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !post.isPending && setOpen(o)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("web.aiStore.social.title")}</DialogTitle>
            <DialogDescription>{t("web.aiStore.social.intro")}</DialogDescription>
          </DialogHeader>
          {post.data ? (
            <PostView r={post.data} />
          ) : (
            <Button type="button" onClick={() => post.mutate({ productId, badge: true })} disabled={post.isPending} data-testid="social-make">
              {post.isPending ? <Loader2Icon className="animate-spin" /> : <MegaphoneIcon />}
              {post.isPending ? t("web.aiStore.social.making") : t("web.aiStore.social.make")}
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Posts for new arrivals": pick one of this week's new products, then make its post. */
export function NewArrivalPostsButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const allowed = useSocialAllowed();
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<string | null>(null);
  const list = useQuery<{ items: NewArrival[] }>({ queryKey: ["ai", "store", "new-arrivals"], queryFn: () => api.get("/ai/store/social/new-arrivals"), enabled: allowed && open, retry: false });
  const post = usePost();
  if (!allowed) return null;
  return (
    <>
      <Button type="button" variant="outline" className={className} onClick={() => setOpen(true)} data-testid="new-arrival-posts">
        <MegaphoneIcon /> {t("web.aiStore.social.newButton")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (post.isPending) return;
          setOpen(o);
          if (!o) {
            setPicked(null);
            post.reset();
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("web.aiStore.social.title")}</DialogTitle>
            <DialogDescription>{t("web.aiStore.social.intro")}</DialogDescription>
          </DialogHeader>
          {post.data ? (
            <PostView r={post.data} />
          ) : (
            <div className="grid gap-3">
              <Label>{t("web.aiStore.social.pick")}</Label>
              {list.isPending ? (
                <Loader2Icon className="animate-spin text-muted-foreground" />
              ) : (list.data?.items.length ?? 0) === 0 ? (
                <Alert>
                  <AlertDescription>{t("web.aiStore.social.noNew")}</AlertDescription>
                </Alert>
              ) : (
                <ul className="grid max-h-64 gap-1.5 overflow-y-auto">
                  {list.data!.items.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setPicked(p.id)}
                        aria-pressed={picked === p.id}
                        className={`flex w-full items-center gap-3 rounded-lg border p-2 text-start text-sm ${picked === p.id ? "border-primary bg-primary/5" : "hover:bg-accent"}`}
                      >
                        {p.image ? <img src={p.image} alt="" className="size-10 rounded-md object-cover" /> : <span className="size-10 rounded-md bg-muted" />}
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Button type="button" onClick={() => picked && post.mutate({ productId: picked, badge: true })} disabled={!picked || post.isPending}>
                {post.isPending ? <Loader2Icon className="animate-spin" /> : <MegaphoneIcon />}
                {post.isPending ? t("web.aiStore.social.making") : t("web.aiStore.social.make")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
