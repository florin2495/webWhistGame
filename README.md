# webWhistGame

Whist românesc (cu licitație), 3–6 jucători, pe telefon. Pe stilul [Bingo](https://bingo.hailatat.icu):
Next.js 16 (App Router), Supabase (Postgres + Realtime Broadcast), deploy pe Vercel (fra1).
Adresă: **https://whist.hailatat.icu**

## Reguli

1. Creatorul camerei alege varianta **1-8-1** sau **8-1-8**, bonusul ±10 și tăierea obligatorie.
   Poate schimba regulile cât camera e în lobby. Camera poate avea parolă.
2. Ceilalți intră cu codul camerei sau cu linkul `/room/COD`. Se joacă în **3 până la 6** jucători.
3. Pachetul are 8 cărți pentru fiecare jucător: în 3, de la 9 la A (24 de cărți); în 4, de la 7 la A (32).
4. **1-8-1**: câte o mână de 1 carte pentru fiecare jucător, apoi 2, 3 … 7, câte o mână de 8, 7 … 2, și iar câte una de 1
   (21 de mâini în 3, 24 în 4). **8-1-8** e invers.
5. **Atu**: cartea întoarsă după împărțire. La mâinile de 8 nu rămâne nicio carte, deci nu există atu.
6. **Licitație**: începând cu jucătorul de după cel care a împărțit, fiecare spune câte levate ia.
   Ultimul (cel care a împărțit) nu poate spune numărul care face totalul egal cu numărul de cărți.
7. **Joc**: deschide tot jucătorul de după cel care a împărțit, apoi cine a luat levata. Răspunzi la culoare.
   Dacă nu ai culoarea și ai atu, trebuie să tai (cu tăierea obligatorie activă). Altfel dai orice.
   Ia levata atuul cel mai mare, altfel cartea cea mai mare din culoarea cerută.
8. **Scor**: exact cât ai spus = 5 + numărul spus. Altfel pierzi diferența.
   Bonus: +10 după 5 mâini nimerite la rând, −10 după 5 ratate la rând (apoi seria reîncepe).
9. Câștigă cine are cele mai multe puncte după ultima mână. Host-ul poate porni un **joc nou** în aceeași cameră;
   la fiecare joc nou începe următorul jucător.

### Extra
- Foaia de scor clasică (luat/spus și totalul pe fiecare mână), levata trecută afișată pe masă.
- Dacă un jucător pleacă sau e scos în timpul jocului, jocul se oprește: whist nu poate continua cu un loc gol.
- Camere: lobby/terminate se închid după 10 minute în care nimeni nu le are deschise; un joc în desfășurare
  pe care nu-l mai are nimeni deschis se închide după 6 ore.
- Setări pe dispozitiv: confirmare la jucarea cărții, vibrație când e rândul tău.

## Arhitectură

- Toată logica rulează în Route Handlers (`src/app/api/rooms/...`) cu **service role key**. Regulile pure sunt în
  `src/lib/whist.ts` și sunt testate.
- Starea jocului (inclusiv cărțile fiecăruia) e un jsonb în `whist_rooms.game`, scris cu lock optimist pe `version`.
  `/state` trimite fiecărui jucător doar cărțile lui.
- Tabelele au RLS activat fără policy și `revoke` pentru `anon`/`authenticated`.
- Live: Supabase Realtime Broadcast pe `whist:room:<uuid>` (semnal fără date) + polling la 60 s.

## Setup

1. **Supabase** (proiectul comun al jocurilor): SQL Editor → rulează tot `supabase/schema.sql`.
   Creează doar `whist_rooms` și `whist_players`.
2. **Local**: `npm install`, `cp .env.example .env.local` (aceleași 3 valori ca la celelalte jocuri), `npm run dev`, `npm test`.
3. **Vercel**: Import `florin2495/webWhistGame` → Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` → Deploy (sau Redeploy după ce le adaugi).
4. **Domeniu**: Settings → Domains → Add `whist.hailatat.icu`.
