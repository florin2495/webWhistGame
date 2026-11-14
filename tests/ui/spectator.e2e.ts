// Scenario 2: someone opens the invite link of a running game. They become a spectator (no cards, no bid buttons),
// the players see them live, they see every move live, they queue for the next game ("în coadă" seen by the players),
// see the game stop when a player leaves, and the host's "Joc nou" turns them into a player. Desktop Chromium only:
// it checks game logic and Realtime, the device does not matter (scenario 1 already runs on WebKit).
import { expect, test } from "@playwright/test";
import { createAndJoin, joinRoom, leaveAll, playHands, REALTIME_MS, startGame, withPlayers } from "./helpers";

test("a late joiner watches as a spectator and plays from the next game", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop-chromium", "game logic, one browser is enough");

  await withPlayers(browser, ["Ana", "Bob", "Cris", "Dan"], async (all, room) => {
    const players = all.slice(0, 3);
    const [host, guest, third] = players;
    const spectator = all[3];

    await test.step("three players start a game", async () => {
      await createAndJoin(players, room);
      await startGame(players);
    });

    await test.step("a fourth person joins mid-game and becomes a spectator", async () => {
      await joinRoom(spectator, room.code);
      const sp = spectator.page;
      await expect(sp.getByTestId("spectator-banner")).toContainText("Ești spectator");
      await expect(sp.getByTestId("hand-info")).toHaveAttribute("data-progress", "0");
      await expect(sp.getByTestId("game-table")).toBeVisible();
      for (const id of ["my-hand", "bid-picker"]) await expect(sp.getByTestId(id)).toHaveCount(0);
      await expect(sp.getByTestId("turn-badge")).not.toHaveText("Rândul tău");
      for (const p of players) {
        await expect(p.page.getByTestId("spectator-list")).toContainText(spectator.name, { timeout: REALTIME_MS });
      }
    });

    await test.step("the spectator queues for the next game, the players see it live", async () => {
      await spectator.page.getByTestId("queue-toggle").click();
      await expect(spectator.page.getByTestId("queue-toggle")).toContainText("Ești în coadă");
      await expect(host.page.getByTestId("spectator-list")).toContainText("în coadă", { timeout: REALTIME_MS });
    });

    await test.step("the first hand is played; the spectator sees every move live", async () => {
      const g = await playHands(players, room.code, 1, [spectator]);
      expect(g.history).toHaveLength(1);
      await expect(spectator.page.getByTestId("last-hand")).toBeVisible();
    });

    await test.step("a player leaves: the spectator sees the game stop", async () => {
      await leaveAll([third]);
      await expect(spectator.page.getByTestId("game-over")).toContainText("Joc oprit", { timeout: REALTIME_MS });
    });

    await test.step("new game: the queued spectator becomes a player", async () => {
      await host.page.getByTestId("new-round").click();
      await expect(spectator.page.getByTestId("spectator-banner")).toHaveCount(0, { timeout: REALTIME_MS });
      await expect(spectator.page.getByTestId("player-list")).toContainText(`${spectator.name} (tu)`);
      await expect(host.page.getByTestId("player-list")).toContainText(spectator.name, { timeout: REALTIME_MS });
      await expect(host.page.getByTestId("spectator-list")).toHaveCount(0);
      await expect(host.page.getByTestId("start-game")).toBeEnabled(); // Ana, Bob, Dan = 3 players
    });

    await test.step("everyone leaves, the room closes", async () => {
      await leaveAll([guest, spectator, host]);
      room.closed = true;
    });
  });
});
