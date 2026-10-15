import { PolicyPage, policyMetadata } from "@srirealtime/storefront-ui";

type Props = { params: Promise<{ kind: string }> };

export async function generateMetadata({ params }: Props) {
  return policyMetadata((await params).kind);
}

export default async function Page({ params }: Props) {
  return <PolicyPage kind={(await params).kind} />;
}
