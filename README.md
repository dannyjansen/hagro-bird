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
npm run assets
python3 -m http.server 4173 --directory public
```

Dan werkt het spel, maar inloggen/ranking niet.

## 2. Productie (GitHub → Cloudflare Workers Builds)

Niet lokaal `wrangler deploy` naar productie. Koppel deze repo aan Cloudflare Workers Builds. Build command:

```bash
npm test && node scripts/sync-assets.mjs && npx wrangler deploy
```

Sprites staan in `assets/` en worden naar `public/assets` gekopieerd vóór de Worker-deploy. De huidige Vercel-site blijft de static files hosten; `vercel.json` stuurt `/api/*` door naar de Worker, zodat accounts en ranking op de bestaande game-URL werken.

Cloudflare (account van Danny):

1. D1-database `hagro-bird` (`2b836d4a-74df-410d-8fb9-b40f8df2c309`) is aangemaakt in WEUR.
2. Migraties `0001_accounts.sql` en `0002_app_settings.sql` zijn remote toegepast.
3. Loginmails gaan via Cloudflare Email Service (`send_email` binding), afzender `HagroBird <hello@dannojustin.com>` (zelfde geverifieerde domein als Danno). Geen Resend.
4. Optioneel: `npx wrangler secret put AUTH_SECRET` — zonder secret bootstrapt de Worker een HMAC-key in D1 (`app_settings`).

Geen `BETTER_AUTH` / wachtwoorden: dit spel heeft alleen e-mailcodes.

## 3. Vercel

`vercel.json` blijft staan zodat een bestaande Vercel-koppeling de frontend kan blijven serveren. `/api/*` wordt doorgezet naar `https://hagro-bird.dannyjustinjansen.workers.dev`, terwijl statische bestanden op Vercel blijven. De directe Worker-URL blijft ook beschikbaar voor controle.

## Besturing

- Tik of klik in het veld: flap (tijdens het spel)
- Start/opnieuw: de gouden knop
- Spatie / pijl omhoog: flap
- M: mute
- Record op dit toestel blijft in `localStorage`; de ranking is accountgebonden

## Stack

`index.html` · `game.js` · `account.js` · `style.css` · `assets/` — Canvas 2D.
`src/worker.js` + D1 — e-mailcode, sessie, ranking, avatar.
E-mail via [Cloudflare Email Service](https://developers.cloudflare.com/email-service/).
