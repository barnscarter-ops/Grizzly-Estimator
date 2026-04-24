import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Grizzly Estimator",
    short_name: "Grizzly",
    description:
      "Electrical walkthrough capture, AI-assisted takeoff, proposal generation, and Housecall Pro handoff.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5efe6",
    theme_color: "#d96a28",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "48x48",
        type: "image/x-icon",
      },
    ],
  };
}
