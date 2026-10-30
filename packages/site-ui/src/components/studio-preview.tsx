"use client";

import type { StudioPreviewProps } from "@rbms/web";
import { LivePreview } from "./live-preview";

/**
 * The Studio assistant's "your store with this change": the real store in the live preview, with the plan's brand tokens and
 * home sections sent over the same channel the Appearance and Home editors use. Registered from the site module.
 */
export default function StudioLivePreview({ tokens, sections }: StudioPreviewProps) {
  return <LivePreview className="h-full" tokens={tokens ?? null} sections={sections ?? null} mode="browse" defaultDevice="phone" />;
}
