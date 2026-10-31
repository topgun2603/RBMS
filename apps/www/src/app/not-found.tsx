import Link from "next/link";
import { Button } from "@rbms/ui/components/button";
import { FadeIn } from "@rbms/ui/motion";
import { getT } from "@/lib/i18n-server";
import { Container } from "@/components/sections";

export default async function NotFound() {
  const { t } = await getT();
  return (
    <Container className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 py-20 text-center">
      <FadeIn y={10} className="space-y-4">
        <p className="text-gradient font-display text-7xl font-bold">404</p>
        <h1 className="font-display text-2xl font-bold">{t("notFound.title")}</h1>
        <p className="text-muted-foreground">{t("notFound.body")}</p>
        <Button asChild className="rounded-full">
          <Link href="/">{t("notFound.home")}</Link>
        </Button>
      </FadeIn>
    </Container>
  );
}
