"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { PREF_CONFIRM_PLAY, PREF_VIBRATE, useBoolPref } from "@/lib/client/prefs";
import type { PublicGame, RoomState } from "@/lib/types";
import { type Card, rankLabel, rankOf, SUIT_NAME, SUIT_SYMBOL, suitOf } from "@/lib/whist";
import { PlayingCard, SuitBadge } from "./PlayingCard";
import { ScoreSheet } from "./ScoreSheet";
import { Button, Card as Panel, ErrorText } from "./ui";

const cardName = (c: Card) => `${rankLabel(rankOf(c))}${SUIT_SYMBOL[suitOf(c)]}`;

export function Game({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const { room, me } = state;
  const g = state.game;
  const base = `/api/rooms/${room.code}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Card | null>(null);
  const [confirmPlay] = useBoolPref(PREF_CONFIRM_PLAY, false);
  const [vibrate] = useBoolPref(PREF_VIBRATE, true);

  const myTurn = g !== null && g.mySeat !== null && g.turn === g.mySeat && g.phase !== "over";
  const turnKey = g ? `${g.handIndex}:${g.phase}:${g.trick.length}:${g.tricks.join(",")}` : "";

  // Buzz once each time it becomes my move.
  const buzzed = useRef("");
  useEffect(() => {
    if (!myTurn || !vibrate || buzzed.current === turnKey) return;
    buzzed.current = turnKey;
    try {
      navigator.vibrate?.(120);
    } catch {
      // not supported
    }
  }, [myTurn, vibrate, turnKey]);

  if (!g) return <p className="text-center text-zinc-500">Se împart cărțile…</p>;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setSelected(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const bid = (b: number) => run(() => api(`${base}/bid`, { token, body: { bid: b } }));
  const play = (c: Card) => run(() => api(`${base}/play`, { token, body: { card: c } }));

  function tapCard(c: Card) {
    if (!myTurn || g!.phase !== "playing" || busy || !g!.legal.includes(c)) return;
    if (!confirmPlay) return void play(c);
    setSelected(selected === c ? null : c);
  }

  const isHost = room.hostPlayerId === me.id;
  const total = g.sizes.length;
  const turnName = g.names[g.turn];
  const lastResult = g.phase === "bidding" && g.history.length > 0 && g.trick.length === 0 ? g.history.at(-1)! : null;

  return (
    <>
      <Panel className="py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Mâna {Math.min(g.handIndex + 1, total)}/{total}
            </p>
            <p className="text-lg font-black">
              {g.handSize} {g.handSize === 1 ? "carte" : "cărți"}
            </p>
          </div>
          <div className="flex items-center gap-2 text-right">
            <div>
              <p className="text-xs font-semibold uppercase text-zinc-500">Atu</p>
              <p className="text-sm font-bold">{g.trump ? SUIT_NAME[g.trump] : "fără atu"}</p>
            </div>
            {g.trumpCard ? (
              <PlayingCard card={g.trumpCard} size="sm" label={`Atu: ${cardName(g.trumpCard)}`} />
            ) : (
              <span className="flex h-14 w-10 items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 text-xs text-zinc-400 dark:border-zinc-700">
                —
              </span>
            )}
          </div>
        </div>
      </Panel>

      <Seats g={g} />

      {g.phase !== "over" && <Table g={g} />}

      {lastResult && (
        <p className="rounded-lg bg-zinc-100 px-3 py-2 text-center text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          Mâna trecută ({lastResult.handSize}):{" "}
          {lastResult.points.map((p, i) => (
            <span key={i} className="mr-2 inline-block">
              {g.names[i]}{" "}
              <b className={p >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                {p > 0 ? `+${p}` : p}
              </b>
              {lastResult.bonus[i] !== 0 && <span> (bonus {lastResult.bonus[i] > 0 ? "+" : ""}{lastResult.bonus[i]})</span>}
            </span>
          ))}
        </p>
      )}

      {g.phase === "over" ? (
        <GameOver g={g} isHost={isHost} busy={busy} onNewGame={() => void run(() => api(`${base}/new-round`, { token, body: {} }))} />
      ) : (
        <p
          className={`rounded-lg px-3 py-2 text-center text-sm font-semibold ${
            myTurn ? "bg-indigo-600 text-white" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
          aria-live="polite"
        >
          {myTurn
            ? g.phase === "bidding"
              ? "Rândul tău: câte levate iei?"
              : g.trick.length === 0
                ? "Rândul tău: deschizi levata."
                : "Rândul tău: joacă o carte."
            : g.phase === "bidding"
              ? `${turnName} licitează…`
              : `${turnName} joacă…`}
        </p>
      )}

      {myTurn && g.phase === "bidding" && <BidPicker g={g} busy={busy} onBid={(b) => void bid(b)} />}

      {g.mySeat !== null && g.phase !== "over" && (
        <Panel>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-bold">Cărțile tale</h2>
            {g.bids[g.mySeat] !== null && (
              <span className="text-sm text-zinc-500">
                ai spus <b>{g.bids[g.mySeat]}</b> · ai luat <b>{g.tricks[g.mySeat]}</b>
              </span>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-1.5 pt-2">
            {g.myHand.map((c) => {
              const playable = myTurn && g.phase === "playing" && g.legal.includes(c);
              return (
                <PlayingCard
                  key={c}
                  card={c}
                  onClick={() => tapCard(c)}
                  disabled={busy || !playable}
                  dim={myTurn && g.phase === "playing" && !playable}
                  selected={selected === c}
                />
              );
            })}
          </div>
          {confirmPlay && selected && myTurn && (
            <Button className="mt-3 w-full" onClick={() => void play(selected)} disabled={busy}>
              Joacă {cardName(selected)}
            </Button>
          )}
        </Panel>
      )}

      <ErrorText>{error}</ErrorText>
      <ScoreSheet g={g} defaultOpen={g.phase === "over"} />
    </>
  );
}

function Seats({ g }: { g: PublicGame }) {
  const bidsSum = g.bids.reduce<number>((a, b) => a + (b ?? 0), 0);
  const allBid = g.bids.every((b) => b !== null);
  return (
    <Panel className="py-2">
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {g.names.map((name, i) => {
          const isTurn = g.phase !== "over" && g.turn === i;
          const streak = g.streaks[i];
          return (
            <li key={i} className={`flex items-center justify-between gap-2 py-2 ${isTurn ? "font-bold text-indigo-600 dark:text-indigo-400" : ""}`}>
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="w-3 text-center">
                  {isTurn ? "▶" : ""}
                </span>
                <span className="truncate">
                  {name}
                  {i === g.mySeat && <span className="font-normal text-zinc-500"> (tu)</span>}
                </span>
                {i === g.dealer && g.phase !== "over" && (
                  <span title="A împărțit, licitează ultimul" className="rounded bg-zinc-200 px-1.5 text-[10px] font-semibold uppercase text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    împarte
                  </span>
                )}
                {Math.abs(streak) >= 3 && (
                  <span className="text-[10px] font-semibold text-zinc-500" title="Serie pentru bonus">
                    {streak > 0 ? `🔥${streak}` : `❄️${-streak}`}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-3 text-sm">
                {g.phase !== "over" && (
                  <span className="font-normal text-zinc-600 dark:text-zinc-400">
                    {g.bids[i] === null ? "–" : `${g.tricks[i]}/${g.bids[i]}`}
                  </span>
                )}
                <span className="w-10 text-right font-mono font-bold">{g.scores[i]}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {g.phase !== "over" && (
        <p className="pt-1 text-right text-[11px] text-zinc-500">
          luat/spus · total spus {bidsSum}
          {allBid ? (bidsSum > g.handSize ? " (peste)" : " (sub)") : ""} din {g.handSize}
        </p>
      )}
    </Panel>
  );
}

function Table({ g }: { g: PublicGame }) {
  const showingLast = g.trick.length === 0 && g.lastTrick !== null;
  const plays = showingLast ? g.lastTrick!.plays : g.trick;
  return (
    <section className="rounded-xl bg-emerald-800 p-3 text-white shadow-inner dark:bg-emerald-950">
      <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-emerald-100">
        {showingLast ? `Levata trecută: a luat-o ${g.names[g.lastTrick!.winner]}` : g.trick.length ? "Pe masă" : "Masa e goală"}
      </p>
      <div className="flex min-h-24 flex-wrap items-end justify-center gap-3">
        {plays.map((p) => (
          <div key={p.seat} className={`flex flex-col items-center gap-1 ${showingLast ? "opacity-70" : ""}`}>
            <PlayingCard card={p.card} highlight={showingLast && p.seat === g.lastTrick!.winner} />
            <span className="max-w-16 truncate text-[11px] font-semibold">{g.names[p.seat]}</span>
          </div>
        ))}
      </div>
      {!showingLast && g.trick.length > 0 && (
        <p className="mt-2 text-center text-xs text-emerald-100">
          Culoarea cerută: <SuitBadge card={g.trick[0].card} /> {SUIT_NAME[suitOf(g.trick[0].card)]}
        </p>
      )}
    </section>
  );
}

function BidPicker({ g, busy, onBid }: { g: PublicGame; busy: boolean; onBid: (b: number) => void }) {
  const options = Array.from({ length: g.handSize + 1 }, (_, i) => i);
  const forbidden = options.find((o) => !g.allowedBids.includes(o));
  return (
    <Panel>
      <div className="grid grid-cols-5 gap-2">
        {options.map((o) => (
          <Button
            key={o}
            variant={g.allowedBids.includes(o) ? "primary" : "secondary"}
            disabled={busy || !g.allowedBids.includes(o)}
            onClick={() => onBid(o)}
            className={g.allowedBids.includes(o) ? "" : "line-through"}
          >
            {o}
          </Button>
        ))}
      </div>
      {forbidden !== undefined && (
        <p className="mt-2 text-xs text-zinc-500">
          Licitezi ultimul: nu poți spune {forbidden}, totalul ar fi egal cu numărul de cărți.
        </p>
      )}
    </Panel>
  );
}

function GameOver({ g, isHost, busy, onNewGame }: { g: PublicGame; isHost: boolean; busy: boolean; onNewGame: () => void }) {
  return (
    <Panel className="text-center">
      {g.abortedBy ? (
        <>
          <p className="text-lg font-black">Joc oprit</p>
          <p className="text-sm text-zinc-500">{g.abortedBy} a ieșit din joc. Scorul rămâne mai jos.</p>
        </>
      ) : (
        <>
          <p className="text-3xl">🏆</p>
          <p className="text-xl font-black">
            {g.winners.map((w) => g.names[w]).join(" și ")} {g.winners.length > 1 ? "câștigă la egalitate" : "câștigă"}
          </p>
          <p className="text-sm text-zinc-500">cu {g.scores[g.winners[0]]} puncte</p>
        </>
      )}
      {isHost ? (
        <Button className="mt-3 w-full" onClick={onNewGame} disabled={busy}>
          Joc nou
        </Button>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">Host-ul poate porni un joc nou.</p>
      )}
    </Panel>
  );
}
