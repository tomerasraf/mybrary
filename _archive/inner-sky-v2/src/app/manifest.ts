import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TimeFlow",
    short_name: "TimeFlow",
    description: "A cozy home for your goals, days, and thoughts.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4ecdd",
    theme_color: "#c4643a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
