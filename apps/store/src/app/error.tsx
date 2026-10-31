"use client";

import { StoreErrorView } from "@rbms/storefront-ui/client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <StoreErrorView error={error} reset={reset} />;
}
