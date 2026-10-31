"use client";

import * as React from "react";
import { cn } from "@rbms/ui";
import { fitScale, PREVIEW_DEVICES, type PreviewDevice } from "./live-preview-protocol";

/**
 * The store iframe at a real device width (phone 390 / tablet 820 / desktop 1440 CSS px), scaled down to fit the
 * space it gets, so the store's own breakpoints apply exactly as on that device. Sandboxed without
 * `allow-top-navigation`: the store can't navigate the editor away.
 */
export const LivePreviewFrame = React.forwardRef<HTMLIFrameElement, { src: string | null; device: PreviewDevice; title: string; onLoad?: () => void; className?: string; children?: React.ReactNode }>(
  function LivePreviewFrame({ src, device, title, onLoad, className, children }, ref) {
    const box = React.useRef<HTMLDivElement>(null);
    const [size, setSize] = React.useState({ w: 0, h: 0 });
    React.useLayoutEffect(() => {
      const el = box.current;
      if (!el) return;
      const ro = new ResizeObserver(([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }));
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    const width = PREVIEW_DEVICES[device];
    const scale = fitScale(width, size.w);
    const framed = device !== "desktop";
    return (
      <div ref={box} className={cn("relative min-h-0 w-full overflow-hidden", className)}>
        <div
          className={cn("absolute top-0 left-1/2 origin-top bg-background transition-[width] duration-300", framed ? "rounded-[1.25rem] shadow-elevated ring-1 ring-border" : "rounded-lg ring-1 ring-border")}
          style={{ width, height: size.h > 0 ? size.h / scale : "100%", transform: `translateX(-50%) scale(${scale})` }}
        >
          {src && (
            <iframe
              ref={ref}
              src={src}
              title={title}
              onLoad={onLoad}
              className={cn("size-full border-0 bg-background", framed ? "rounded-[1.25rem]" : "rounded-lg")}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="origin"
              allow="clipboard-write"
            />
          )}
        </div>
        {children}
      </div>
    );
  },
);
