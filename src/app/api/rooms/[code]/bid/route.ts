import { moveHandler } from "@/lib/server/move";
import { fail } from "@/lib/server/http";
import { placeBid } from "@/lib/whist";

// POST /api/rooms/[code]/bid  { bid } - the player whose turn it is says how many tricks they will take.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/bid">) {
  const { code } = await ctx.params;
  return moveHandler(req, code, "bid", (game, seat, body) => {
    const bid = Number(body.bid);
    if (!Number.isInteger(bid)) fail(400, "Licitație invalidă.");
    return placeBid(game, seat, bid);
  });
}
