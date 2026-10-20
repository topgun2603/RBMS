import * as React from "react";
import { cn } from "@srirealtime/ui/lib/utils";
import type { GridLayout } from "../lib/grid";
import { ProductGridSkeleton } from "./product-card";

/* Branded loading skeletons (shimmer sweep, transform-only; static with reduced motion). Same boxes and aspect ratios
 * as the real pages so nothing jumps when content arrives. Used by the app's loading.tsx files and Suspense fallbacks. */

export function Bone({ className }: { className?: string }) {
  return <div aria-hidden className={cn("sf-shimmer rounded-xl", className)} />;
}

function Shell({ children, label, className }: { children: React.ReactNode; label?: string; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label ?? "Loading"} className={cn("mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8", className)}>
      {children}
    </div>
  );
}

export function ListingSkeleton({ layout = "sidebar" }: { layout?: GridLayout }) {
  return (
    <Shell>
      <Bone className="h-3 w-40 rounded-full" />
      <Bone className="mt-4 mb-8 h-9 w-64" />
      <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-10">
        <div className="hidden gap-4 lg:grid lg:content-start">
          {[0, 1, 2, 3].map((i) => (
            <Bone key={i} className="h-24" />
          ))}
        </div>
        <div>
          <div className="mb-6 flex justify-between">
            <Bone className="h-4 w-28 rounded-full" />
            <Bone className="h-10 w-40 rounded-full" />
          </div>
          <ProductGridSkeleton count={8} layout={layout} />
        </div>
      </div>
    </Shell>
  );
}

export function ProductPageSkeleton() {
  return (
    <Shell>
      <Bone className="mb-5 h-3 w-48 rounded-full" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14">
        <div className="flex gap-4">
          <div className="hidden w-20 shrink-0 flex-col gap-3 lg:flex">
            {[0, 1, 2, 3].map((i) => (
              <Bone key={i} className="aspect-[var(--sf-image-ratio,4/5)]" />
            ))}
          </div>
          <Bone className="aspect-[var(--sf-image-ratio,4/5)] flex-1 rounded-3xl" />
        </div>
        <div className="grid content-start gap-5">
          <Bone className="h-3 w-24 rounded-full" />
          <Bone className="h-10 w-4/5" />
          <Bone className="h-8 w-40" />
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Bone key={i} className="h-11 w-14" />
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Bone className="h-12 rounded-full" />
            <Bone className="h-12 rounded-full" />
          </div>
          <Bone className="h-28 rounded-2xl" />
        </div>
      </div>
    </Shell>
  );
}

export function CartSkeleton() {
  return (
    <Shell>
      <Bone className="mb-6 h-9 w-40" />
      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="grid content-start gap-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-4">
              <Bone className="size-24 shrink-0 sm:size-28" />
              <div className="grid flex-1 content-start gap-2">
                <Bone className="h-4 w-2/3 rounded-full" />
                <Bone className="h-3 w-1/4 rounded-full" />
                <Bone className="mt-4 h-8 w-28 rounded-full" />
              </div>
            </div>
          ))}
        </div>
        <Bone className="h-80 rounded-3xl" />
      </div>
    </Shell>
  );
}

export function CheckoutSkeleton({ bare }: { bare?: boolean }) {
  const body = (
    <div className="grid gap-8 lg:grid-cols-[1fr_400px]" aria-busy="true">
      <div className="grid content-start gap-5">
        {[0, 1, 2].map((i) => (
          <Bone key={i} className="h-40 rounded-3xl" />
        ))}
      </div>
      <Bone className="h-96 rounded-3xl" />
    </div>
  );
  if (bare) return body;
  return (
    <Shell>
      <Bone className="mb-6 h-9 w-44" />
      <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
        <div className="grid content-start gap-5">
          {[0, 1, 2].map((i) => (
            <Bone key={i} className="h-40 rounded-3xl" />
          ))}
        </div>
        <Bone className="h-96 rounded-3xl" />
      </div>
    </Shell>
  );
}

export function AccountSkeleton({ bare }: { bare?: boolean }) {
  const body = (
    <div className="grid gap-8 lg:grid-cols-[240px_1fr] lg:gap-12" aria-busy="true">
      <div className="grid content-start gap-3">
        <Bone className="h-12 w-48" />
        {[0, 1, 2, 3].map((i) => (
          <Bone key={i} className="h-10 rounded-full lg:rounded-xl" />
        ))}
      </div>
      <div className="grid content-start gap-3">
        {[0, 1, 2].map((i) => (
          <Bone key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    </div>
  );
  if (bare) return body;
  return (
    <Shell className="py-8 sm:py-12">
      <div className="grid gap-8 lg:grid-cols-[240px_1fr] lg:gap-12">
        <div className="grid content-start gap-3">
          <Bone className="h-8 w-40" />
          {[0, 1, 2, 3].map((i) => (
            <Bone key={i} className="h-10 rounded-full lg:rounded-xl" />
          ))}
        </div>
        <div className="grid content-start gap-3">
          {[0, 1, 2].map((i) => (
            <Bone key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      </div>
    </Shell>
  );
}

export function TrackSkeleton() {
  return (
    <Shell className="max-w-3xl py-10">
      <Bone className="h-9 w-48" />
      <Bone className="mt-8 h-44 rounded-3xl" />
      <Bone className="mt-8 h-64 rounded-3xl" />
    </Shell>
  );
}

/** Rail of product tiles (related products, recently viewed) while it streams in. */
export function RailSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden sm:gap-5" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="w-[44%] shrink-0 sm:w-[30%] lg:w-[23%]">
          <Bone className="aspect-[var(--sf-image-ratio,4/5)] rounded-[var(--sf-radius-card)]" />
          <Bone className="mt-3 h-3.5 w-3/4 rounded-full" />
          <Bone className="mt-2 h-3.5 w-1/3 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Help centre: hero, search pill, two FAQ groups. */
export function HelpSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <div className="border-b bg-tint-1 py-10 sm:py-14">
        <div className="mx-auto grid max-w-xl justify-items-center gap-3 px-4">
          <Bone className="size-14 rounded-2xl" />
          <Bone className="h-3 w-32 rounded-full" />
          <Bone className="h-10 w-64" />
          <Bone className="h-4 w-80 max-w-full rounded-full" />
        </div>
      </div>
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:px-8">
        <Bone className="mx-auto h-13 w-full max-w-2xl rounded-full" />
        {[0, 1].map((g) => (
          <div key={g} className="grid gap-4">
            <Bone className="h-7 w-48" />
            <div className="grid gap-px overflow-hidden rounded-2xl border">
              {[0, 1, 2].map((i) => (
                <Bone key={i} className="h-14 rounded-none" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Seller page: header with logo, then the product grid. */
export function SellerSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <div className="border-b bg-tint-1">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-5 px-4 py-10 sm:px-6 lg:px-8">
          <Bone className="size-20 rounded-3xl sm:size-24" />
          <div className="grid flex-1 gap-3">
            <Bone className="h-5 w-40 rounded-full" />
            <Bone className="h-9 w-72 max-w-full" />
            <Bone className="h-4 w-24 rounded-full" />
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <Bone className="mb-6 h-8 w-64" />
        <ProductGridSkeleton count={8} />
      </div>
    </div>
  );
}
