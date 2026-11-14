// Scenario 3 (phone only): the worst case for a small screen, a full table of 6 players with 10-character nicknames.
// No screen may scroll sideways, the bid buttons and cards must stay big enough to tap (WCAG 2.2 minimum target:
// 24 x 24 CSS px), and a real touch tap must place a bid that the other phones see live.
// Scenario 1 already plays several hands on the emulated iPhone; this one checks the layout.
import { expect, test, type Locator } from "@playwright/test";
import { createAndJoin, expectNoHorizontalScroll, leaveAll, playMove, startGame, whoseTurn, withPlayers } from "./helpers";

const MIN_TAP_PX = 24;
const NAMES = Array.from({ length: 6 }, (_, i) => `Alexandru${i + 1}`); // 10 chars, the nickname limit

async function smallestSide(buttons: Locator): Promise<number> {
  const sizes = await buttons.evaluateAll((els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)));
  expect(sizes.length).toBeGreaterThan(0);
  return Math.min(...sizes);
}

test("a 6-player table fits a phone screen and is tappable", async ({ browser }) => {
  test.skip(!test.info().project.use.isMobile, "phone layout only");

  await withPlayers(browser, NAMES, async (players, room) => {
    const host = players[0];

    await test.step("home page fits the screen", async () => {
      await host.page.goto("./");
      await expect(host.page.getByTestId("home-submit")).toBeVisible();
      await expectNoHorizontalScroll(host.page);
    });

    await test.step("lobby with 6 players fits the screen", async () => {
      await createAndJoin(players, room);
      await expect(host.page.getByText("6/6")).toBeVisible();
      await expectNoHorizontalScroll(host.page);
      await expectNoHorizontalScroll(players[5].page);
    });

    await test.step("game screen fits every phone, bid buttons and cards are big enough to tap", async () => {
      await startGame(players);
      for (const p of players) {
        await expectNoHorizontalScroll(p.page);
        await expect(p.page.getByTestId("my-hand").getByRole("button")).toHaveCount(1);
        expect(await smallestSide(p.page.getByTestId("my-hand").getByRole("button")), `${p.name}'s cards`).toBeGreaterThanOrEqual(MIN_TAP_PX);
      }
      const mover = await whoseTurn(players);
      expect(await smallestSide(mover.page.getByTestId("bid-picker").getByRole("button")), "bid buttons").toBeGreaterThanOrEqual(MIN_TAP_PX);
    });

    await test.step("a touch tap places a bid, the other phones see it live", async () => {
      const g = await playMove(players, room.code, [], { tap: true });
      expect(g.bids.filter((b) => b !== null)).toHaveLength(1);
      for (const p of players) await expectNoHorizontalScroll(p.page);
    });

    await test.step("everyone leaves (the first one stops the game), the room closes", async () => {
      await leaveAll([...players.slice(1), host]);
      room.closed = true;
    });
  });
});
