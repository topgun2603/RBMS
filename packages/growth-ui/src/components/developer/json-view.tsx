"use client";

import * as React from "react";
import { cn } from "@rbms/ui";
import { CopyButton } from "../bits";

/** Monospace, scrollable code block with a copy button in the corner. */
export function CodeBlock({
  code,
  label,
  className,
  maxHeight = "max-h-96",
  wrap = false,
}: {
  code: string;
  /** Small caption over the block ("Node.js", "JSON"). */
  label?: React.ReactNode;
  className?: string;
  maxHeight?: string;
  /** Wrap long lines instead of scrolling sideways (response bodies). */
  wrap?: boolean;
}) {
  return (
    <div className={cn("relative min-w-0 overflow-hidden rounded-xl border bg-muted/40", className)}>
      <div className="flex items-center justify-between gap-2 border-b bg-muted/50 px-3 py-1.5">
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        <CopyButton value={code} size="icon-sm" variant="ghost" className="-my-1 -mr-2" />
      </div>
      <pre
        className={cn(
          "overflow-auto p-3 font-mono text-xs leading-relaxed text-foreground",
          wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre",
          maxHeight,
        )}
        tabIndex={0}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Pretty-printed JSON value in a CodeBlock. */
export function JsonView({ value, label, className, maxHeight }: { value: unknown; label?: React.ReactNode; className?: string; maxHeight?: string }) {
  const text = React.useMemo(() => {
    try {
      return JSON.stringify(value, null, 2) ?? "null";
    } catch {
      return String(value);
    }
  }, [value]);
  return <CodeBlock code={text} label={label ?? "JSON"} className={className} maxHeight={maxHeight} />;
}
