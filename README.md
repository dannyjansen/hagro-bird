# HagroBird

Wachtspelletje voor Hagro-klanten. Tikken met één vinger: de uil (of mus) flapt tussen keukenkasten door.

Static frontend, klaar voor Vercel. Geen backend, geen cookies, geen tracking. Highscore staat in `localStorage`.

## 1. Lokaal testen

Vanuit deze map:

```bash
python3 -m http.server 4173
```

Open [http://localhost:4173](http://localhost:4173) op je telefoon (zelfde wifi) of in Chrome met device toolbar (portrait).

Alternatief:

```bash
npx --yes serve -p 4173
```

## 2. Preview op Vercel

Eenmalig inloggen, daarna vanuit de projectmap:

```bash
npx vercel
```

Volg de vragen (scope, projectnaam). Je krijgt een preview-URL, bijvoorbeeld `https://hagrobird-xxx.vercel.app`.

## 3. Productie

```bash
npx vercel --prod
```

Of: koppel de GitHub-repo in het Vercel-dashboard. Push naar `main` bouwt en publiceert automatisch. Geen GitHub Actions-deploy nodig.

## 4. Eigen subdomain

In het [Vercel-dashboard](https://vercel.com/dashboard) → project **HagroBird** → **Settings** → **Domains**:

- voeg `hagrobird.jouwdomein.nl` toe, of
- gebruik het projectdomein `hagro-bird.vercel.app`

Zet DNS (CNAME) zoals Vercel aangeeft. Die URL gaat op de QR-code.

Geen environment variables of secrets nodig.

## Besturing

- Tik of klik: flap
- Spatie / pijl omhoog: flap
- M: mute
- Record blijft bewaard op dit toestel

## Stack

`index.html` · `game.js` · `style.css` · `assets/` — Canvas 2D, geen framework.
