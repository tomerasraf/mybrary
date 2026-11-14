import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MyBrary",
    short_name: "MyBrary",
    description: "Where your thoughts become bubbles.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#f6f7f9",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
