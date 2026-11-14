"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiRequestError, clearSession, deviceId, listSessions, parseSession, readSessionRaw, saveSession } from "@/lib/client/api";
import { PREF_NICKNAME, useStringPref, writePref } from "@/lib/client/prefs";
import type { RoomListItem, RoomState } from "@/lib/types";
import { DEFAULT_SETTINGS, NICKNAME_MAX, type Settings } from "@/lib/whist";
import { FeedbackButton } from "./FeedbackButton";
import { RoomList } from "./RoomList";
import { RulesForm } from "./RulesForm";
import { Button, Card, ErrorText, Field } from "./ui";

interface JoinResult {
  code: string;
  playerId: string;
  token: string;
}

export function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Nickname defaults to the last one used on this device.
  const storedNickname = useStringPref(PREF_NICKNAME);
  const [typedNickname, setNickname] = useState<string | null>(null);
  const nickname = typedNickname ?? storedNickname ?? "";
  const [roomName, setRoomName] = useState("");
  const [password, setPassword] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [code, setCode] = useState("");
  const [picked, setPicked] = useState<RoomListItem | null>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);

  function pickRoom(room: RoomListItem) {
    setPicked(room);
    setCode(room.code);
    setPassword("");
    setError("");
    nicknameRef.current?.focus();
  }

  // Password field is hidden only when the picked room is known to have none.
  const showPassword = tab === "create" || !(picked && picked.code === code && !picked.hasPassword);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const joinCode = code.trim().toUpperCase();
    // Already a member on this device: go back to the seat instead of joining again.
    if (tab === "join" && parseSession(readSessionRaw(joinCode))) {
      router.push(`/room/${joinCode}`);
      return;
    }
    setBusy(true);
    setError("");
    writePref(PREF_NICKNAME, nickname.trim());
    try {
      const res =
        tab === "create"
          ? await api<JoinResult>("/api/rooms", { body: { name: roomName, nickname, password, ...settings, deviceId: deviceId() } })
          : await api<JoinResult>(`/api/rooms/${encodeURIComponent(joinCode)}/join`, {
              body: { nickname, password, deviceId: deviceId() },
            });
      saveSession(res.code, { playerId: res.playerId, token: res.token });
      router.push(`/room/${res.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-2">
        {/* Plain <a> on purpose: "/" is the hub zone, outside basePath; needs a full navigation. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300">
          ← Back to haiLaTăt.icu hub
        </a>
        <FeedbackButton />
      </div>
      <header className="text-center">
        <h1 className="text-4xl font-black tracking-tight">
          Whist <span className="text-rose-600">♥</span>
          <span>♠</span>
        </h1>
        <p className="mt-1 text-sm text-zinc-500">Whist-ul de la masă, cu 2-5 prieteni, pe telefon.</p>
      </header>

      <RejoinCards onRejoin={(c) => router.push(`/room/${c}`)} />

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-200 p-1 dark:bg-zinc-800" role="tablist">
        {(["create", "join"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setError("");
            }}
            className={`min-h-10 rounded-lg text-sm font-semibold ${tab === t ? "bg-white shadow dark:bg-zinc-950" : "text-zinc-600 dark:text-zinc-400"}`}
          >
            {t === "create" ? "Creează cameră" : "Intră în cameră"}
          </button>
        ))}
      </div>

      {tab === "join" && (
        <Card className="relative">
          <h2 className="mb-3 pr-10 font-bold">Camere disponibile</h2>
          <RoomList selected={picked?.code === code ? code : null} onSelect={pickRoom} onRejoin={(c) => router.push(`/room/${c}`)} />
        </Card>
      )}

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {tab === "join" && (
            <Field
              label="Codul camerei"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="ex. K7QM2X"
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              required
            />
          )}
          {tab === "create" && (
            <Field label="Numele camerei" value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={40} required />
          )}
          <Field
            ref={nicknameRef}
            label="Nickname-ul tău"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={NICKNAME_MAX}
            autoComplete="nickname"
            required
          />
          {showPassword && (
            <Field
              label={tab === "create" ? "Parolă (opțional)" : picked?.code === code ? "Parola camerei" : "Parolă (dacă are camera)"}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={100}
              autoComplete="off"
              required={tab === "join" && picked?.code === code && picked.hasPassword}
            />
          )}

          {tab === "create" && <RulesForm value={settings} onChange={setSettings} />}

          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy} data-testid="home-submit">
            {busy ? "Se încarcă…" : tab === "create" ? "Creează camera" : "Intră"}
          </Button>
        </form>
      </Card>

      <details className="text-sm text-zinc-600 dark:text-zinc-400">
        <summary className="cursor-pointer font-semibold">Reguli</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>3 până la 6 jucători. Pachetul are 8 cărți de fiecare jucător: la 3 de la 9 la A, la 4 de la 7 la A, la 5 de la 5 la A, la 6 de la 3 la A.</li>
          <li>Varianta 1-8-1: întâi câte o mână de 1 carte pentru fiecare jucător, apoi 2…7, câte o mână de 8, 7…2 și iar de 1.</li>
          <li>Atuul e cartea întoarsă după împărțire. La mâinile de 8 nu există atu.</li>
          <li>Fiecare spune câte levate ia. Ultimul (cel care a împărțit) nu poate spune numărul care face totalul egal cu numărul de cărți.</li>
          <li>Răspunzi la culoare. Dacă nu ai, tai cu atu (dacă e activă tăierea obligatorie), altfel dai orice.</li>
          <li>Dacă iei exact cât ai spus: 5 + numărul spus. Altfel pierzi diferența.</li>
          <li>Bonus: +10 la 5 mâini nimerite la rând, −10 la 5 ratate la rând.</li>
        </ol>
      </details>
    </main>
  );
}

/**
 * Rooms this device still has a valid seat in (lobby or a running game, which the public list does not
 * show). Stored sessions are checked once against /state; 401/404 ones are dropped.
 */
function RejoinCards({ onRejoin }: { onRejoin: (code: string) => void }) {
  const [rooms, setRooms] = useState<{ code: string; name: string; playing: boolean }[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const checks = await Promise.all(
        listSessions().map(async ({ code, session }) => {
          try {
            const s = await api<RoomState>(`/api/rooms/${code}/state`, { token: session.token });
            return { code, name: s.room.name, playing: s.room.status === "playing" };
          } catch (err) {
            if (err instanceof ApiRequestError && (err.status === 401 || err.status === 404)) clearSession(code);
            return null;
          }
        }),
      );
      if (!cancelled) setRooms(checks.filter((r) => r !== null));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (rooms.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {rooms.map((r) => (
        <button
          key={r.code}
          type="button"
          onClick={() => onRejoin(r.code)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3 text-left dark:border-indigo-800 dark:bg-indigo-950"
        >
          <span className="min-w-0">
            <span className="block font-bold">
              Revino în camera <span className="font-mono tracking-widest">{r.code}</span>
            </span>
            <span className="block truncate text-xs text-zinc-600 dark:text-zinc-400">
              {r.name}
              {r.playing ? " · joc în desfășurare" : ""}
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-indigo-600 dark:text-indigo-400">Reintră →</span>
        </button>
      ))}
    </div>
  );
}
