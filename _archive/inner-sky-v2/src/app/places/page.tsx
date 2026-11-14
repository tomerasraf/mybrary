import { PlacesView } from "@/components/places/PlacesView";
import { listPlaces } from "@/lib/repo/places";
import { PLACE_HEX } from "@/lib/sky/nodes";

export const dynamic = "force-dynamic";

export default function PlacesPage() {
  const places = listPlaces();
  const explored = places.filter((p) => p.status !== "want").length;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Your city</h1>
        <p className="lede">
          {explored > 0
            ? `${explored} of ${places.length} places explored. Where to next?`
            : "Pin where you train, shop, and go to meet people."}
        </p>
      </header>
      <PlacesView places={places} colors={PLACE_HEX} />
    </div>
  );
}
