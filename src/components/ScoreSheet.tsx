"use client";

import type { PublicGame } from "@/lib/types";
import { SUIT_SYMBOL } from "@/lib/whist";
import { Card } from "./ui";

/** The classic paper score sheet: one row per hand, bid/taken and running total per player. */
export function ScoreSheet({ g, defaultOpen }: { g: PublicGame; defaultOpen?: boolean }) {
  return (
    <Card className="py-2">
      <details className="group" open={defaultOpen}>
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 font-bold">
          <span className="text-xs transition-transform group-open:rotate-90">▶</span>
          Foaia de scor
        </summary>
        <div className="-mx-2 overflow-x-auto pb-1">
          <table className="w-full min-w-max border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-2 py-1 text-left font-semibold text-zinc-500">#</th>
                {g.names.map((n, i) => (
                  <th key={i} className="px-2 py-1 text-right font-semibold">
                    {n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono">
              {g.sizes.map((size, h) => {
                const r = g.history[h];
                const current = !r && h === g.handIndex && g.phase !== "over";
                return (
                  <tr key={h} className={`border-b border-zinc-100 dark:border-zinc-900 ${current ? "bg-indigo-50 dark:bg-indigo-950" : ""}`}>
                    <td className="px-2 py-1 text-zinc-500">
                      {size}
                      {r && <span className="ml-1">{r.trump ? SUIT_SYMBOL[r.trump] : "·"}</span>}
                    </td>
                    {g.names.map((_, i) => (
                      <td key={i} className="px-2 py-1 text-right">
                        {r ? (
                          <>
                            <span className="text-zinc-500">
                              {r.tricks[i]}/{r.bids[i]}
                            </span>{" "}
                            <span className={r.bids[i] === r.tricks[i] ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                              {r.totals[i]}
                            </span>
                            {r.bonus[i] !== 0 && <span className="text-amber-600">*</span>}
                          </>
                        ) : current && g.bids[i] !== null ? (
                          <span className="text-zinc-500">?/{g.bids[i]}</span>
                        ) : (
                          ""
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-2 pt-1 text-[11px] text-zinc-500">
            luat/spus, apoi totalul. Verde = nimerit (5 + spus), roșu = ratat (− diferența). * = bonus ±10.
          </p>
        </div>
      </details>
    </Card>
  );
}
