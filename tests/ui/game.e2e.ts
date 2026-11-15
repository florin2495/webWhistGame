// Scenario 1: three real browsers (Whist needs 3 players) play a live game on the deployed site: create, join by link,
// deal, bid and play the first 4 hands (three 1-card hands and a 2-card hand); after every move each screen must show
// the same progress within 5 s without a reload (Realtime, well under the 60 s polling fallback). Then a player leaves
// (the game stops for everyone), the host starts a new game followed live, everyone leaves. Runs on every project.
import { expect, test } from "@playwright/test";
import { createAndJoin, expectSynced, leaveAll, playHands, REALTIME_MS, startGame, withPlayers } from "./helpers";

const HANDS = 4;

test("three players play the first hands live", async ({ browser }) => {
  await withPlayers(browser, ["Ana", "Bob", "Cris"], async (players, room) => {
    const [host, guest, third] = players;

    await test.step("host creates a room, the others join by link", async () => {
      await createAndJoin(players, room);
      await expect(host.page.getByText("3/6")).toBeVisible();
      await expect(guest.page.getByText("Așteptăm ca host-ul să înceapă jocul")).toBeVisible();
      await expect(guest.page.getByTestId("player-list")).toContainText(third.name, { timeout: REALTIME_MS });
    });

    await test.step("host deals, every screen shows the first hand", () => startGame(players));

    await test.step(`bid and play ${HANDS} hands, every move live on all screens`, async () => {
      const g = await playHands(players, room.code, HANDS);
      expect(g.history).toHaveLength(HANDS);
      for (const p of players) {
        await expect(p.page.getByTestId("hand-info")).toContainText(`Mâna ${HANDS + 1}/21`);
        await expect(p.page.getByTestId("last-hand")).toBeVisible();
        await expect(p.page.getByTestId("my-hand").getByRole("button")).toHaveCount(3); // hand 5 has 3 cards (1, 1, 1, 2, 3, ...)
      }
    });

    await test.step("a player leaves mid-game: the game stops for everyone", async () => {
      await leaveAll([third]);
      for (const p of [host, guest]) {
        await expect(p.page.getByTestId("game-over")).toContainText("Joc oprit", { timeout: REALTIME_MS });
        await expect(p.page.getByTestId("game-over")).toContainText(`${third.name} a ieșit din joc`);
      }
      await expectSynced([host, guest], "Infinity");
    });

    await test.step("host starts a new game, the guest follows live", async () => {
      await host.page.getByTestId("new-round").click();
      await expect(host.page.getByTestId("start-game")).toBeVisible();
      await expect(guest.page.getByText("Așteptăm ca host-ul să înceapă jocul")).toBeVisible({ timeout: REALTIME_MS });
      await expect(guest.page.getByTestId("player-list")).not.toContainText(third.name);
    });

    await test.step("both leave, the room closes", async () => {
      await leaveAll([guest, host]);
      room.closed = true;
    });
  });
});
