"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { KICK_NETWORK_GRACE_MS, secondsLabel } from "@/lib/kick";
import type { RoomState } from "@/lib/types";
import { Button, ErrorText } from "./ui";

/** When the last /state arrived and the current time; remaining ms = value from the server minus elapsed. */
const KickClock = createContext({ stateAt: 0, now: 0 });
export const KickClockProvider = KickClock.Provider;

/**
 * Ticks while any kick is pending and refreshes the state when a countdown reaches 0 (so the removal
 * is enforced promptly even though the poll is slow), and once more after the network grace.
 */
export function useKickClock(state: RoomState | null, stateAt: number, refresh: () => Promise<void>) {
  const [now, setNow] = useState(() => Date.now());
  const remaining = state ? state.players.map((p) => p.kickRemainingMs).filter((v): v is number => v !== null) : [];
  const pending = remaining.length > 0;
  const minMs = pending ? Math.min(...remaining) : null;
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!pending) return;
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(tick);
  }, [pending]);

  useEffect(() => {
    if (minMs === null) return;
    const left = minMs - (Date.now() - stateAt);
    // Still counting: refresh when it hits 0. Already at 0: wait out the network grace, then refresh.
    const delay = left > 0 ? left + 150 : KICK_NETWORK_GRACE_MS + 500;
    const t = window.setTimeout(() => void refreshRef.current(), delay);
    return () => window.clearTimeout(t);
  }, [minMs, stateAt]);

  return { stateAt, now };
}

/** Live seconds left for a remaining-ms value taken from the latest /state. */
export function useKickSeconds(remainingMs: number | null): number | null {
  const { stateAt, now } = useContext(KickClock);
  if (remainingMs === null) return null;
  return secondsLabel(remainingMs - Math.max(0, now - stateAt));
}

/** "iese în N s" next to a player with a pending kick. */
export function KickBadge({ remainingMs }: { remainingMs: number | null }) {
  const s = useKickSeconds(remainingMs);
  if (s === null) return null;
  return (
    <span className="shrink-0 rounded bg-rose-100 px-1.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
      iese în {s} s
    </span>
  );
}

/** Blocking modal for the kicked player: only "Ignoră" closes it. */
export function KickModal({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const seconds = useKickSeconds(state.me.kickRemainingMs) ?? 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ignore() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${state.room.code}/kick/ignore`, { token, body: {} });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kick-title"
        aria-describedby="kick-text"
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 text-center text-zinc-900 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
      >
        <h2 id="kick-title" className="text-xl font-black">
          Ai fost scos din joc
        </h2>
        <p id="kick-text" className="mt-2 text-base">
          Gazda te-a scos din cameră. Apasă „Ignoră” în {seconds} s ca să rămâi în joc.
        </p>
        <p aria-hidden className="my-3 font-mono text-5xl font-black text-rose-600 dark:text-rose-400">
          {seconds}
        </p>
        <ErrorText>{error}</ErrorText>
        <Button autoFocus className="mt-2 w-full" onClick={() => void ignore()} disabled={busy}>
          Ignoră
        </Button>
      </div>
    </div>
  );
}
