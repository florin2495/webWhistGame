import { renderIcon } from "@/lib/pwa-icon";

const ICONS: Record<string, { size: number; scale: number }> = {
  "icon-192.png": { size: 192, scale: 0.92 },
  "icon-512.png": { size: 512, scale: 0.92 },
  // maskable: artwork kept inside the central 80% safe zone
  "icon-maskable-512.png": { size: 512, scale: 0.7 },
};

export function generateStaticParams() {
  return Object.keys(ICONS).map((file) => ({ file }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const cfg = ICONS[file];
  if (!cfg) return new Response("Not found", { status: 404 });
  return renderIcon(cfg.size, cfg.scale);
}
