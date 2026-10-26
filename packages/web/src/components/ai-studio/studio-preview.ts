import type * as React from "react";

/** What the Studio panel hands to the live store preview. Either may be absent when the plan does not touch it. */
export interface StudioPreviewProps {
  /** Brand tokens after the plan (colours, fonts, layout options). */
  tokens?: Record<string, unknown> | null;
  /** Home sections after the plan, each with an id. */
  sections?: Record<string, unknown>[] | null;
}

let renderer: React.ComponentType<StudioPreviewProps> | null = null;

/**
 * The online-store module (site-ui) registers its live preview here, so the Studio panel (which lives in the shared kit and
 * cannot import the store editor) can show the real store with a plan applied. Apps without an online store never register
 * one and the panel shows the before / after list only.
 */
export function registerStudioPreview(component: React.ComponentType<StudioPreviewProps>): void {
  renderer = component;
}
export const studioPreviewComponent = () => renderer;
