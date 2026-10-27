"use client";

import { DisplayScreen } from "../components/display/display-screen";

/** Public route "display" (e.g. /pos/display): this browser as a customer-facing screen (paired by a 6-digit code, or `?local=<register>` on the counter's own PC). */
export default function DisplayPage() {
  return <DisplayScreen />;
}
