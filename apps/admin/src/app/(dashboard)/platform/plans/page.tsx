"use client";

import { PlansResource } from "@/components/plans/plans-resource";
import { Page } from "@/components/page";
import { SuperAdminOnly } from "@/components/superadmin-only";

export default function PlatformPlansPage() {
  return (
    <SuperAdminOnly>
      <Page>
        <PlansResource />
      </Page>
    </SuperAdminOnly>
  );
}
