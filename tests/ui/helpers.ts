// Shared steps for the Playwright UI tests (tests/ui/*.e2e.ts). Not a test file itself (no .e2e.ts suffix).
// Rooms are named "e2e-test-ui-…"; a leftover is deleted with the service key (env) as a safety net.
// Whist is random (shuffled deck): the tests never hard-code moves, the player whose screen says "Rândul tău" picks
// the first enabled bid / card, and every screen must then show the same game progress (`hand-info` data-progress).
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/** A change has to show up on another screen within this, without a reload. Polling alone takes up to 60 s. */
export const REALTIME_MS = 5_000;

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
}

/** The part of the move response the tests read (POST /bid, /play return the mover's view of the game). */
interface MoveGame {
  phase: "bidding" | "playing" | "over";
  handIndex: number;
  handSize: number;
  bids: (number | null)[];
  cardsLeft: number[];
  history: unknown[];
}

/** Same formula as progress() in src/components/Game.tsx (rendered as `hand-info` data-progress). */
export function progress(g: MoveGame): string {
  if (g.phase === "over") return "Infinity";
  const bids = g.bids.filter((b) => b !== null).length;
  const played = g.cardsLeft.reduce((a, n) => a + (g.handSize - n), 0);
  return String(g.handIndex * 10_000 + bids * 100 + played);
}

/** A separate browser context = a separate device (own localStorage session), with the project's device settings. */
export async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const use = test.info().project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    locale: use.locale,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
  });
  return { name, context, page: await context.newPage() };
}

/** Host creates a room (no password, default rules 1-8-1) from the home page; returns its code. */
export async function createRoom(host: Player): Promise<string> {
  const page = host.page;
  await page.goto("./");
  await page.getByLabel("Numele camerei").fill(`e2e-test-ui-${Date.now().toString(36)}`);
  await page.getByLabel("Nickname-ul tău").fill(host.name);
  await page.getByTestId("home-submit").click();
  await page.waitForURL(/\/room\/[A-Z2-9]{6}$/);
  await expect(page.getByTestId("start-game")).toBeVisible();
  return page.url().match(/\/room\/([A-Z2-9]{6})$/)![1];
}

/** Opens the invite link and joins with the player's nickname (lands in the lobby or as a spectator). */
export async function joinRoom(p: Player, code: string): Promise<void> {
  await p.page.goto(`room/${code}`);
  await p.page.getByLabel("Nickname-ul tău").fill(p.name);
  await p.page.getByTestId("join-submit").click();
  await expect(p.page.getByTestId("join-submit")).toBeHidden();
}

/** Host creates the room (code stored in `room` at once, for the cleanup), the others join by link; the host sees each live. */
export async function createAndJoin(players: Player[], room: { code: string }): Promise<string> {
  const [host, ...guests] = players;
  room.code = await createRoom(host);
  for (const g of guests) {
    await joinRoom(g, room.code);
    await expect(host.page.getByTestId("player-list")).toContainText(g.name, { timeout: REALTIME_MS });
  }
  return room.code;
}

/** Every screen (players and watchers) shows the game at exactly this progress, without a reload. */
export async function expectSynced(pages: Player[], value: string): Promise<void> {
  for (const p of pages) {
    await expect(p.page.getByTestId("hand-info"), `${p.name}'s screen`).toHaveAttribute("data-progress", value, { timeout: REALTIME_MS });
  }
}

/** Host (players[0]) deals; every screen shows the first hand. */
export async function startGame(players: Player[], watchers: Player[] = []): Promise<void> {
  const host = players[0];
  await expect(host.page.getByTestId("start-game")).toBeEnabled({ timeout: REALTIME_MS });
  await host.page.getByTestId("start-game").click();
  await expectSynced([...players, ...watchers], "0");
  await expect(host.page.getByTestId("hand-info")).toContainText(`Mâna 1/${3 * players.length + 12}`);
}

/** The player whose screen says "Rândul tău" (call only when every screen is synced). */
export async function whoseTurn(players: Player[]): Promise<Player> {
  const hit: { p?: Player } = {};
  await expect
    .poll(
      async () => {
        hit.p = undefined;
        for (const p of players) {
          if ((await p.page.getByTestId("turn-badge").textContent({ timeout: 1_000 }).catch(() => null))?.trim() === "Rândul tău") hit.p ??= p;
        }
        return hit.p?.name ?? "nobody";
      },
      { message: "one screen says Rândul tău", timeout: REALTIME_MS },
    )
    .not.toBe("nobody");
  return hit.p!;
}

/**
 * One move by the player whose turn it is: the first allowed bid, or the first playable card (a touch tap with
 * `tap`). Waits for the server to accept it, then for every screen to show the new progress. Returns the game.
 */
export async function playMove(players: Player[], code: string, watchers: Player[] = [], opts: { tap?: boolean } = {}): Promise<MoveGame> {
  const mover = await whoseTurn(players);
  const page = mover.page;
  const bidding = await page.getByTestId("bid-picker").isVisible();
  const target = (bidding ? page.getByTestId("bid-picker") : page.getByTestId("my-hand")).locator("button:enabled").first();
  await expect(target).toBeVisible();
  const kind = bidding ? "bid" : "play";
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(`/api/rooms/${code}/${kind}`) && r.request().method() === "POST"),
    opts.tap ? target.tap() : target.click(),
  ]);
  expect(res.ok(), `${mover.name}'s ${kind}: ${res.status()}`).toBe(true);
  const game = ((await res.json()) as { game: MoveGame }).game;
  await expectSynced([...players, ...watchers], progress(game));
  return game;
}

/** Plays until `hands` hands are complete (or the game ends). Returns the last game. */
export async function playHands(players: Player[], code: string, hands: number, watchers: Player[] = []): Promise<MoveGame> {
  for (let moves = 0; moves < 500; moves++) {
    const g = await playMove(players, code, watchers);
    if (g.phase === "over" || g.history.length >= hands) return g;
  }
  throw new Error("too many moves");
}

/** Leaves through the "Părăsește" button (accepting the confirm), in the given order. */
export async function leaveAll(players: Player[]): Promise<void> {
  for (const p of players) {
    p.page.once("dialog", (d) => void d.accept());
    await p.page.getByTestId("leave").click();
    await expect(p.page.getByTestId("home-submit")).toBeVisible();
  }
}

/** The page must not scroll sideways (the usual mobile layout bug). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
}

/** Safety net: delete the room straight in the DB if the UI flow did not close it. */
export async function deleteRoom(code: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(`cleanup: no Supabase env, delete room ${code} by hand if it is still there`);
    return;
  }
  const res = await fetch(`${url}/rest/v1/whist_rooms?code=eq.${code}&name=like.e2e-test-ui-*`, {
    method: "DELETE",
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  console.log(`cleanup: room ${code} delete = ${res.status}`);
}

/** Runs `body` with fresh players; always closes their browsers and deletes the room if it was left open. */
export async function withPlayers(
  browser: Browser,
  names: string[],
  body: (players: Player[], room: { code: string; closed: boolean }) => Promise<void>,
): Promise<void> {
  const players = await Promise.all(names.map((n) => newPlayer(browser, n)));
  const room = { code: "", closed: false };
  try {
    await body(players, room);
  } finally {
    if (room.code && !room.closed) await deleteRoom(room.code);
    for (const p of players) await p.context.close();
  }
}
