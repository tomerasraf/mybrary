import { Mind } from "@/components/Mind";
import { getDb } from "@/lib/db";
import { listThoughts } from "@/lib/thoughts";

export const dynamic = "force-dynamic";

export default function Home() {
  return <Mind initialThoughts={listThoughts(getDb())} />;
}
