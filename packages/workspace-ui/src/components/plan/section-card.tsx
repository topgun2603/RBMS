"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from "@srirealtime/ui";

/** Card with an icon chip, title, description and an optional action on the right (stacks on phones). */
export function SectionCard({
  icon: Icon,
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("gap-4 py-5", className)}>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className="icon-chip size-9 shrink-0 rounded-xl text-primary">
              <Icon className="size-4" />
            </span>
          )}
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            {description && <CardDescription className="text-xs sm:text-sm">{description}</CardDescription>}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </CardHeader>
      {children !== undefined && <CardContent className={cn("px-4 sm:px-5", contentClassName)}>{children}</CardContent>}
    </Card>
  );
}
