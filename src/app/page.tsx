import { Mind } from "@/components/Mind";
import { getDb } from "@/lib/db";
import { getLibrary } from "@/lib/library";
import { getPage } from "@/lib/page";

export const dynamic = "force-dynamic";

export default function Home() {
  const db = getDb();
  return <Mind initial={getLibrary(db)} initialPage={getPage(db)} />;
}
