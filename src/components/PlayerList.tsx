"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import type { RoomState } from "@/lib/types";
import { KickBadge } from "./KickCountdown";
import { ErrorText } from "./ui";

/** Shown next to a player not seen for 45 s (phone in the background, closed tab, no network). */
export function OfflineBadge({ connected }: { connected: boolean | undefined }) {
  if (connected !== false) return null;
  return (
    <span className="shrink-0 rounded bg-zinc-200 px-1.5 text-[10px] font-semibold uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      deconectat
    </span>
  );
}

/** Host-only "Scoate" button. In a running game the player gets 10 s to press "Ignoră" first. */
export function KickButton({
  state,
  token,
  refresh,
  playerId,
  nickname,
  onError,
}: {
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
  playerId: string;
  nickname: string;
  onError?: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const { room } = state;
  const target = state.players.find((p) => p.id === playerId);
  if (target && target.kickRemainingMs !== null) return null; // already pending: the badge says so

  async function kick() {
    const spectating = state.spectators.some((s) => s.id === playerId);
    const text =
      room.status === "playing" && !spectating
        ? `Scoți jucătorul ${nickname} din cameră? Are 10 secunde să refuze; dacă nu, jocul se oprește pentru toți.`
        : `Scoți jucătorul ${nickname} din cameră?`;
    if (!window.confirm(text)) return;
    setBusy(true);
    onError?.("");
    try {
      await api(`/api/rooms/${room.code}/kick`, { token, body: { playerId } });
      await refresh();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void kick()}
      disabled={busy}
      className="min-h-8 shrink-0 rounded-md border border-rose-300 px-2 text-xs font-semibold text-rose-600 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
      aria-label={`Scoate pe ${nickname}`}
    >
      {busy ? "…" : "Scoate"}
    </button>
  );
}

/** Lobby list of members, with a "Scoate" (kick) button for the host. */
export function PlayerList({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const { players, me, room } = state;
  const canKick = room.hostPlayerId === me.id;
  const canReorder = canKick && room.status === "lobby" && players.length > 1;
  const [error, setError] = useState("");
  const [moving, setMoving] = useState(false);

  async function move(index: number, delta: -1 | 1) {
    const order = players.map((p) => p.id);
    [order[index], order[index + delta]] = [order[index + delta], order[index]];
    setMoving(true);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/reorder`, { token, body: { order } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setMoving(false);
    }
  }

  const arrow = "flex size-8 shrink-0 items-center justify-center rounded-md border border-zinc-300 text-sm disabled:opacity-30 dark:border-zinc-700";

  return (
    <>
      {canReorder && <p className="mb-1 text-xs text-zinc-500">Ordinea de joc: primul din listă deschide. Mută cu săgețile.</p>}
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800" data-testid="player-list">
        {players.map((p, i) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2">
            <span className="flex min-w-0 items-center gap-2">
              {canReorder && (
                <span className="flex shrink-0 gap-1">
                  <button type="button" className={arrow} disabled={moving || i === 0} onClick={() => void move(i, -1)} aria-label={`Mută ${p.nickname} mai sus`}>
                    ▲
                  </button>
                  <button type="button" className={arrow} disabled={moving || i === players.length - 1} onClick={() => void move(i, 1)} aria-label={`Mută ${p.nickname} mai jos`}>
                    ▼
                  </button>
                </span>
              )}
              <span className="w-4 shrink-0 text-center text-xs text-zinc-500">{i + 1}</span>
              <span className="truncate">
                {p.nickname}
                {p.id === me.id && <span className="text-zinc-500"> (tu)</span>}
              </span>
              {p.isHost && (
                <span className="rounded bg-zinc-200 px-1.5 text-[10px] font-semibold uppercase dark:bg-zinc-800">host</span>
              )}
              <OfflineBadge connected={p.connected} />
              <KickBadge remainingMs={p.kickRemainingMs} />
            </span>
            {canKick && p.id !== me.id && (
              <KickButton state={state} token={token} refresh={refresh} playerId={p.id} nickname={p.nickname} onError={setError} />
            )}
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
    </>
  );
}
