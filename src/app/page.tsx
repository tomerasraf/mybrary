import { Mind } from "@/components/Mind";
import { getDb } from "@/lib/db";
import { getLibrary } from "@/lib/library";

export const dynamic = "force-dynamic";

export default function Home() {
  return <Mind initial={getLibrary(getDb())} />;
}
