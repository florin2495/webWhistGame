"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { PREF_CONFIRM_PLAY, PREF_VIBRATE, useBoolPref } from "@/lib/client/prefs";
import type { PublicGame, RoomState } from "@/lib/types";
import { type Card, rankLabel, rankOf, SUIT_NAME, SUIT_SYMBOL, suitOf } from "@/lib/whist";
import { tableLayout } from "@/lib/tableLayout";
import { KickBadge } from "./KickCountdown";
import { KickButton, OfflineBadge } from "./PlayerList";
import { PlayingCard, SuitBadge } from "./PlayingCard";
import { ScoreSheet } from "./ScoreSheet";
import { Button, Card as Panel, ErrorText } from "./ui";

const cardName = (c: Card) => `${rankLabel(rankOf(c))}${SUIT_SYMBOL[suitOf(c)]}`;

/** How far a game has got: a response older than what is on screen must not overwrite it. */
function progress(g: PublicGame): number {
  if (g.phase === "over") return Infinity;
  const bids = g.bids.filter((b) => b !== null).length;
  const played = g.cardsLeft.reduce((a, n) => a + (g.handSize - n), 0);
  return g.handIndex * 10_000 + bids * 100 + played;
}

interface MoveResult {
  status: RoomState["room"]["status"];
  game: PublicGame;
}

/** The state as it will look once my pending move is confirmed (card on the table / bid made, turn passed). */
function withPending(s: RoomState, move: { card: Card } | { bid: number } | null): RoomState {
  const g = s.game;
  if (!move || !g || g.mySeat === null) return s;
  const seat = g.mySeat;
  const n = g.names.length;
  if ("bid" in move) {
    const bids = [...g.bids];
    bids[seat] = move.bid;
    return { ...s, game: { ...g, bids, turn: (g.turn + 1) % n, allowedBids: [] } };
  }
  if (g.myHand.includes(move.card) === false) return s;
  const cardsLeft = [...g.cardsLeft];
  cardsLeft[seat] -= 1;
  return {
    ...s,
    game: {
      ...g,
      myHand: g.myHand.filter((c) => c !== move.card),
      trick: [...g.trick, { seat, card: move.card }],
      cardsLeft,
      turn: (g.turn + 1) % n,
      legal: [],
    },
  };
}

export function Game({
  state: serverState,
  token,
  refresh,
  patch,
}: {
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
  /** Applies a change the server just confirmed, without re-fetching /state. */
  patch: (fn: (s: RoomState) => RoomState) => void;
}) {
  // My move in flight: shown on screen right away, rolled back if the server refuses it.
  const [pendingMove, setPendingMove] = useState<{ card: Card } | { bid: number } | null>(null);
  const state = useMemo(() => withPending(serverState, pendingMove), [serverState, pendingMove]);
  const { room, me } = state;
  const g = state.game;
  const base = `/api/rooms/${room.code}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Card | null>(null);
  const [confirmPlay] = useBoolPref(PREF_CONFIRM_PLAY, false);
  const [vibrate] = useBoolPref(PREF_VIBRATE, true);

  const myTurn = g !== null && g.mySeat !== null && g.turn === g.mySeat && g.phase !== "over" && pendingMove === null;
  const turnKey = g ? `${g.handIndex}:${g.phase}:${g.trick.length}:${g.tricks.join(",")}` : "";

  // Buzz once each time it becomes my move.
  const buzzed = useRef("");
  useEffect(() => {
    if (!myTurn || !vibrate || buzzed.current === turnKey) return;
    buzzed.current = turnKey;
    // Browsers block vibrate until the user has tapped the page once.
    if (!navigator.userActivation?.hasBeenActive) return;
    try {
      navigator.vibrate?.(120);
    } catch {
      // not supported
    }
  }, [myTurn, vibrate, turnKey]);

  if (!g) return <p className="text-center text-zinc-500">Se împart cărțile…</p>;

  async function move(kind: "bid" | "play", body: { bid: number } | { card: Card }) {
    setBusy(true);
    setError("");
    setSelected(null);
    setPendingMove("card" in body ? { card: body.card } : { bid: body.bid });
    try {
      const r = await api<MoveResult>(`${base}/${kind}`, { token, body });
      patch((s) =>
        s.game && progress(s.game) > progress(r.game) ? s : { ...s, room: { ...s.room, status: r.status }, game: r.game },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      void refresh(); // e.g. 409: someone moved first, resync
    } finally {
      setPendingMove(null);
      setBusy(false);
    }
  }

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

  const bid = (b: number) => move("bid", { bid: b });
  const play = (c: Card) => move("play", { card: c });

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

      {g.phase !== "over" && <Table g={g} />}

      <Seats g={g} state={state} token={token} refresh={refresh} />

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
          {myTurn ? "Rândul tău" : `Rândul lui ${turnName}`}
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

function Seats({ g, state, token, refresh }: { g: PublicGame; state: RoomState; token: string; refresh: () => Promise<void> }) {
  const [kickError, setKickError] = useState("");
  const canKick = state.room.hostPlayerId === state.me.id && g.phase !== "over";
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
                <OfflineBadge connected={state.players.find((p) => p.id === g.seats[i])?.connected} />
                <KickBadge remainingMs={state.players.find((p) => p.id === g.seats[i])?.kickRemainingMs ?? null} />
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
                {canKick && g.seats[i] !== state.me.id && (
                  <KickButton state={state} token={token} refresh={refresh} playerId={g.seats[i]} nickname={name} onError={setKickError} />
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <ErrorText>{kickError}</ErrorText>
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
  const n = g.names.length;
  const layout = tableLayout(n);
  const showingLast = g.trick.length === 0 && g.lastTrick !== null;
  const plays = showingLast ? g.lastTrick!.plays : g.trick;
  const seatAt = (area: string) => {
    const rel = layout.areas.indexOf(area);
    return ((g.mySeat ?? 0) + rel) % n;
  };

  const tile = (seat: number) => {
    const played = plays.find((p) => p.seat === seat);
    const isTurn = g.phase !== "over" && !showingLast && g.turn === seat;
    const won = showingLast && g.lastTrick!.winner === seat;
    return (
      <div
        className={`flex min-w-0 flex-col items-center gap-0.5 rounded-lg px-1 py-1 ${
          isTurn ? "bg-indigo-600/80 ring-2 ring-indigo-300" : "bg-emerald-900/60 dark:bg-emerald-900/40"
        }`}
      >
        <span className="flex w-full min-w-0 items-center justify-center gap-1 text-[11px] font-bold leading-tight">
          <span className="truncate">{g.names[seat]}</span>
          {seat === g.dealer && g.phase !== "over" && (
            <span title="A împărțit" className="shrink-0 rounded bg-white/25 px-1 text-[9px] uppercase">
              D
            </span>
          )}
        </span>
        <span className="text-[10px] leading-tight text-emerald-100">
          {g.bids[seat] === null ? "–" : `${g.tricks[seat]}/${g.bids[seat]}`} · {g.cardsLeft[seat]}c
        </span>
        <span className={`flex h-11 items-center ${showingLast ? "opacity-70" : ""}`}>
          {played ? <PlayingCard card={played.card} size="xs" highlight={won} /> : <span className="h-11 w-8 rounded-lg border border-dashed border-emerald-200/30" />}
        </span>
      </div>
    );
  };

  return (
    <section className="rounded-xl bg-emerald-800 p-2 text-white shadow-inner dark:bg-emerald-950">
      <div
        className="grid items-center gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
          gridTemplateAreas: layout.rows.map((r) => `"${r}"`).join(" "),
        }}
      >
        {layout.areas.slice(1).map((area) => (
          <div key={area} style={{ gridArea: area }} className="min-w-0">
            {tile(seatAt(area))}
          </div>
        ))}
        <div style={{ gridArea: "c" }} className="px-1 text-center text-[11px] font-semibold uppercase leading-tight tracking-wide text-emerald-100">
          {showingLast ? `Levata trecută: ${g.names[g.lastTrick!.winner]}` : g.trick.length ? "Pe masă" : "Masa e goală"}
          {!showingLast && g.trick.length > 0 && (
            <span className="mt-1 block normal-case tracking-normal">
              cer <SuitBadge card={g.trick[0].card} /> {SUIT_NAME[suitOf(g.trick[0].card)]}
            </span>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex justify-center">
        <div className="w-28 min-w-0">{tile(g.mySeat ?? 0)}</div>
      </div>
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
