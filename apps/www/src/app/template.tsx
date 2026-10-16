import { PageTransition } from "@/components/page-transition";

/** Re-mounts on every navigation: the new page fades / lifts in (never the first, server-rendered one). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
