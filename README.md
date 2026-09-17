# HagroBird

Wachtspelletje voor Hagro-klanten. Tikken met één vinger: de uil (of mus) flapt tussen keukenkasten door.

Accounts werken met een e-mailcode (geen wachtwoord). Ranking en profielfoto hangen aan dat account. De canvas-game blijft vanilla JS.

## 1. Lokaal

```bash
cp .dev.vars.example .dev.vars
npm install
npm test
npm run dev
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787). Met `DEV_RETURN_LOGIN_CODE=1` in `.dev.vars` verschijnt de login-code in het scherm (geen e-mail nodig).

Zonder Worker, alleen de oude static preview:

```bash
python3 -m http.server 4173 --directory public
```

Dan werkt het spel, maar inloggen/ranking niet.

## 2. Productie (GitHub → Cloudflare Workers Builds)

Niet lokaal `wrangler deploy` naar productie. Koppel deze repo aan Cloudflare Workers Builds (zoals Mony): `npm test` mag als build-command, daarna `npx wrangler deploy`. De huidige Vercel-site blijft de static files hosten tot die overstap; accounts vereisen de Worker + D1.

Eenmalig in Cloudflare (account van Danny):

1. D1-database `hagro-bird` aanmaken (EU mag).
2. `database_id` in `wrangler.jsonc` zetten.
3. Migratie **vóór** de Worker-release:

```bash
npx wrangler d1 migrations apply DB --remote
```

4. Secrets:

```bash
npx wrangler secret put AUTH_SECRET
npx wrangler secret put RESEND_API_KEY
```

5. `EMAIL_FROM` in `wrangler.jsonc` (of als secret) naar een geverifieerd Resend-adres. De placeholder `beth.t@example.com` mailt alleen naar het Resend-account zelf tot er een eigen domein is geverifieerd.

Geen `BETTER_AUTH` / wachtwoorden: dit spel heeft alleen e-mailcodes.

## 3. Vercel

`vercel.json` blijft staan zodat een bestaande Vercel-koppeling de frontend kan blijven serveren. `/api/*` bestaat daar niet; login toont dan dat de accountserver ontbreekt. Speelbaar blijft het.

## Besturing

- Tik of klik in het veld: flap (tijdens het spel)
- Start/opnieuw: de gouden knop
- Spatie / pijl omhoog: flap
- M: mute
- Record op dit toestel blijft in `localStorage`; de ranking is accountgebonden

## Stack

`index.html` · `game.js` · `account.js` · `style.css` · `assets/` — Canvas 2D.
`src/worker.js` + D1 — e-mailcode, sessie, ranking, avatar.
E-mail via [Resend](https://resend.com).
