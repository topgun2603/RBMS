import { ImageResponse } from "next/og";
import { LOGO_R, LOGO_SLIP } from "@/components/logo";

export const alt = "RBMS: GST billing and your own online store, all in one, for Tamil Nadu shops";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social card (English only: the OG renderer has no Tamil font bundled). */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#ffc61a",
          color: "#1c1712",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 48, fontWeight: 800 }}>
          <svg width="76" height="76" viewBox="0 0 40 40">
            <path d={LOGO_SLIP} fill="#d6231a" />
            <path d={LOGO_R} fill="white" fillRule="evenodd" />
          </svg>
          RBMS
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 120, fontWeight: 900, lineHeight: 0.98, letterSpacing: -4 }}>
          <div>GST billing.</div>
          <div style={{ color: "#b81a12" }}>Online store.</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, fontWeight: 600 }}>
          <div>All in one, for every kind of shop in Tamil Nadu</div>
          <div>14-day free trial</div>
        </div>
      </div>
    ),
    size,
  );
}
