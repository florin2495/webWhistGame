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
    const text =
      room.status === "playing"
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
  const [error, setError] = useState("");

  return (
    <>
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {players.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2">
            <span className="flex min-w-0 items-center gap-2">
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
