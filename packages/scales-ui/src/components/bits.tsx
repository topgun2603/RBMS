"use client";

import * as React from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@rbms/ui";

export function InlineError({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  );
}

/** A barcode's digits split into prefix · PLU · value · check digit, in a monospace strip. */
export function BarcodeDigits({ parts, labels }: { parts: { prefix: string; plu: string; value: string; check: string }; labels: { prefix: string; plu: string; value: string; check: string } }) {
  const cell = (digits: string, label: string, tone: string) => (
    <span className="grid justify-items-center gap-0.5">
      <span className={`rounded px-1.5 py-0.5 font-mono text-base tracking-widest tabular-nums ${tone}`}>{digits}</span>
      <span className="text-meta text-muted-foreground">{label}</span>
    </span>
  );
  return (
    <span className="inline-flex flex-wrap items-start gap-1">
      {cell(parts.prefix, labels.prefix, "bg-muted")}
      {cell(parts.plu, labels.plu, "bg-primary/10 text-primary")}
      {cell(parts.value, labels.value, "bg-success/10 text-success-ink")}
      {cell(parts.check, labels.check, "bg-muted")}
    </span>
  );
}
