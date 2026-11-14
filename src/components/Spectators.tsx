"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import type { RoomState } from "@/lib/types";
import { MAX_SPECTATORS } from "@/lib/spectators";
import { KickBadge } from "./KickCountdown";
import { KickButton, OfflineBadge } from "./PlayerList";
import { Button, Card, ErrorText } from "./ui";

/** Spectator banner with "Intră la runda următoare" (spectators only) and the list of spectators (everyone). */
export function Spectators({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const { me, room, spectators } = state;
  const isSpectator = me.role === "spectator";
  const isHost = room.hostPlayerId === me.id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/queue`, { token, body: {} });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  if (!isSpectator && spectators.length === 0) return null;
  const queuePos = spectators.filter((s) => s.queued).findIndex((s) => s.id === me.id) + 1;

  return (
    <Card className="flex flex-col gap-3">
      {isSpectator && (
        <div className="rounded-lg bg-indigo-50 p-3 text-center dark:bg-indigo-950" data-testid="spectator-banner">
          <p className="text-sm font-semibold">Ești spectator: vezi jocul, dar nu poți juca.</p>
          <Button className="mt-2 w-full" variant={me.queued ? "secondary" : "primary"} onClick={() => void toggle()} disabled={busy} data-testid="queue-toggle">
            {me.queued ? `Ești în coadă (#${queuePos}). Renunță` : "Intră la runda următoare"}
          </Button>
        </div>
      )}
      {spectators.length > 0 && (
        <div>
          <h2 className="mb-1 flex items-baseline justify-between font-bold">
            Spectatori
            <span className="text-sm font-normal text-zinc-500">
              {spectators.length}/{MAX_SPECTATORS}
            </span>
          </h2>
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800" data-testid="spectator-list">
            {spectators.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">
                    {s.nickname}
                    {s.id === me.id && <span className="text-zinc-500"> (tu)</span>}
                  </span>
                  {s.queued && (
                    <span className="shrink-0 rounded bg-indigo-100 px-1.5 text-[10px] font-semibold uppercase text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">
                      în coadă
                    </span>
                  )}
                  <OfflineBadge connected={s.connected} />
                  <KickBadge remainingMs={s.kickRemainingMs} />
                </span>
                {isHost && s.id !== me.id && (
                  <KickButton state={state} token={token} refresh={refresh} playerId={s.id} nickname={s.nickname} onError={setError} />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
