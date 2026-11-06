"use client";

import { type Card, isRed, rankLabel, rankOf, SUIT_SYMBOL, suitOf } from "@/lib/whist";

const SIZES = {
  sm: "h-14 w-10 text-sm",
  md: "h-20 w-14 text-lg",
} as const;

/** One playing card face. As a button when `onClick` is given. */
export function PlayingCard({
  card,
  size = "md",
  onClick,
  disabled,
  selected,
  dim,
  highlight,
  label,
}: {
  card: Card;
  size?: keyof typeof SIZES;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  /** Greyed out: not playable right now. */
  dim?: boolean;
  /** Ring around it (e.g. the winning card of a trick). */
  highlight?: boolean;
  label?: string;
}) {
  const suit = suitOf(card);
  const color = isRed(suit) ? "text-rose-600 dark:text-rose-400" : "text-zinc-900 dark:text-zinc-100";
  const name = `${rankLabel(rankOf(card))}${SUIT_SYMBOL[suit]}`;
  const face = (
    <>
      <span className="leading-none font-black">{rankLabel(rankOf(card))}</span>
      <span className="leading-none">{SUIT_SYMBOL[suit]}</span>
    </>
  );
  const cls = `${SIZES[size]} ${color} flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border-2 bg-white shadow-sm transition dark:bg-zinc-900 ${
    selected
      ? "-translate-y-2 border-indigo-500 ring-2 ring-indigo-400"
      : highlight
        ? "border-amber-400 ring-2 ring-amber-300"
        : "border-zinc-300 dark:border-zinc-700"
  } ${dim ? "opacity-35" : ""}`;

  if (!onClick) {
    return (
      <span className={cls} aria-label={label ?? name}>
        {face}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${cls} enabled:hover:-translate-y-1`} aria-label={label ?? name}>
      {face}
    </button>
  );
}

/** Suit symbol coloured like a card. */
export function SuitBadge({ card }: { card: Card }) {
  const s = suitOf(card);
  return <span className={isRed(s) ? "text-rose-600 dark:text-rose-400" : ""}>{SUIT_SYMBOL[s]}</span>;
}
