import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Whist",
    short_name: "Whist",
    description: "Whist românesc (1-8-1) între prieteni, pe telefon. 3-6 jucători.",
    id: "/whist/",
    start_url: "/whist/",
    // "/" on purpose: leaving the game for the hub (same origin) stays inside the installed app.
    scope: "/",
    display: "standalone",
    lang: "ro",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/whist/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/whist/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/whist/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
