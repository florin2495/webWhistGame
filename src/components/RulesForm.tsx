"use client";

import { type Sequence, SEQUENCES, type Settings } from "@/lib/whist";
import { Toggle } from "./ui";

const SEQ_HINT: Record<Sequence, string> = {
  "1-8-1": "Începe cu mâini de 1 carte, urcă la 8, coboară la 1.",
  "8-1-8": "Începe cu mâini de 8 cărți, coboară la 1, urcă la 8.",
};

/** Game rules picker, used on the create form and by the host in the lobby. */
export function RulesForm({
  value,
  onChange,
  disabled,
}: {
  value: Settings;
  onChange: (s: Settings) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Varianta">
        {SEQUENCES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={value.sequence === s}
            disabled={disabled}
            onClick={() => onChange({ ...value, sequence: s })}
            className={`min-h-11 rounded-lg border-2 font-mono font-bold disabled:opacity-40 ${
              value.sequence === s
                ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <p className="text-xs text-zinc-500">{SEQ_HINT[value.sequence]}</p>
      <Toggle
        label="Bonus ±10 la 5 la rând"
        hint="+10 după 5 mâini consecutive nimerite, −10 după 5 ratate."
        checked={value.bonus}
        disabled={disabled}
        onChange={(bonus) => onChange({ ...value, bonus })}
      />
      <Toggle
        label="Tăiere obligatorie"
        hint="Dacă nu ai culoarea cerută și ai atu, trebuie să tai."
        checked={value.mustTrump}
        disabled={disabled}
        onChange={(mustTrump) => onChange({ ...value, mustTrump })}
      />
    </div>
  );
}
