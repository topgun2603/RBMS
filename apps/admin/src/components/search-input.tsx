"use client";

import * as React from "react";
import { SearchIcon } from "lucide-react";
import { cn, Input } from "@srirealtime/ui";

/** Search box that reports its value after `delay` ms of inactivity (for server-side search). */
export function DebouncedSearch({
  onSearch,
  placeholder,
  delay = 300,
  className,
}: {
  onSearch: (q: string) => void;
  placeholder?: string;
  delay?: number;
  className?: string;
}) {
  const [value, setValue] = React.useState("");
  const cb = React.useRef(onSearch);
  cb.current = onSearch;
  React.useEffect(() => {
    const id = window.setTimeout(() => cb.current(value.trim()), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return (
    <div className={cn("relative w-full sm:max-w-xs", className)}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        size="sm"
        className="pl-8"
      />
    </div>
  );
}
