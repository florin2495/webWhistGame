import { fail } from "@/lib/server/http";
import { moveHandler } from "@/lib/server/move";
import { isCard, playCard } from "@/lib/whist";

// POST /api/rooms/[code]/play  { card } - the player whose turn it is puts a card on the table.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/play">) {
  const { code } = await ctx.params;
  return moveHandler(req, code, "card_played", (game, seat, body) => {
    if (!isCard(body.card)) fail(400, "Carte invalidă.");
    return playCard(game, seat, body.card);
  });
}
