import { TrackPage, trackMetadata } from "@rbms/storefront-ui";

type Props = { params: Promise<{ accessToken: string }> };

export const generateMetadata = trackMetadata;

export default async function Page({ params }: Props) {
  return <TrackPage accessToken={(await params).accessToken} />;
}
