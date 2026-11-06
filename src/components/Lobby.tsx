"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import type { RoomState } from "@/lib/types";
import { handSizes, MAX_PLAYERS, MIN_PLAYERS, minutesLabel, ROOM_IDLE_MINUTES, type Settings } from "@/lib/whist";
import { PlayerList } from "./PlayerList";
import { RulesForm } from "./RulesForm";
import { Button, Card, ErrorText } from "./ui";

export function Lobby({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const { room, me, players } = state;
  const isHost = room.hostPlayerId === me.id;
  const base = `/api/rooms/${room.code}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  const changeSettings = (s: Settings) => run(() => api(`${base}/settings`, { token, body: s }));
  const start = () => run(() => api(`${base}/start`, { token, body: {} }));

  const n = players.length;
  const canStart = n >= MIN_PLAYERS && n <= MAX_PLAYERS;
  const hands = canStart ? handSizes(n, room.settings.sequence).length : null;

  return (
    <>
      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-bold">Jucători</h2>
          <span className="text-sm text-zinc-500">
            {n}/{MAX_PLAYERS}
          </span>
        </div>
        <PlayerList state={state} token={token} refresh={refresh} />
        {n < MIN_PLAYERS && (
          <p className="mt-2 text-sm text-zinc-500">
            Mai trebuie {MIN_PLAYERS - n} {MIN_PLAYERS - n === 1 ? "jucător" : "jucători"}. Apasă pe cod (sus) ca să trimiți invitația.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-bold">Reguli {isHost ? "" : <span className="text-xs font-normal text-zinc-500">(le alege host-ul)</span>}</h2>
        <RulesForm value={room.settings} onChange={(s) => void changeSettings(s)} disabled={!isHost || busy} />
      </Card>

      <ErrorText>{error}</ErrorText>
      {isHost ? (
        <Button onClick={() => void start()} disabled={busy || !canStart}>
          {canStart ? `Împarte cărțile (${hands} mâini)` : `Ai nevoie de ${MIN_PLAYERS}-${MAX_PLAYERS} jucători`}
        </Button>
      ) : (
        <p className="text-center text-sm text-zinc-500">Așteptăm ca host-ul să înceapă jocul…</p>
      )}
      <p className="text-center text-xs text-zinc-500">
        Camera se închide după {minutesLabel(ROOM_IDLE_MINUTES)} în care nimeni nu o are deschisă.
      </p>
    </>
  );
}
