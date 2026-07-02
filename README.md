# My Next Bus

A tablet-first Progressive Web App for displaying live KMB/LWB and Citybus
arrival times at home. It calls the official DATA.GOV.HK feeds directly from
the browser. Favourite journeys and cached results stay on the device; there is
no account, database, API key, or analytics service.

## Local development

Use Node.js 22.13 or later.

```bash
npm install
npm run dev
```

Open the local URL, choose **Add route**, and select an operator, route,
direction, and boarding stop.

## Production validation

```bash
npm run lint
npm run build
```

For GitHub Pages, use the static export instead:

```bash
npm run build:github
```

The included `.github/workflows/deploy-pages.yml` workflow builds and deploys
the site automatically. See [GITHUB-DEPLOYMENT.md](GITHUB-DEPLOYMENT.md) for the
complete beginner-friendly setup and Android installation instructions.

## Data sources

- KMB/LWB: `https://data.etabus.gov.hk/v1/transport/kmb/`
- Citybus: `https://rt.data.gov.hk/v2/transport/citybus/`

Arrival data is advisory and remains subject to traffic and operator changes.

## Tablet requirements

Practical supported baseline:

- Android 9 or later is recommended.
- Google Chrome 90 or later; use the latest Chrome available to the tablet.
- JavaScript, cookies/site storage, and automatic date/time enabled.
- Reliable home Wi-Fi while live ETA updates are required.
- Landscape orientation is recommended; portrait is also supported.
- No SIM card, GPS, Bluetooth, account, or API key is required.

The app is intentionally lightweight. A tablet with 2 GB RAM and roughly 20 MB
of free browser storage is ample. The shell and last-known arrivals remain
visible through a brief Wi-Fi outage, but fresh ETAs require Internet access.

The **Keep awake** button uses the browser Screen Wake Lock API and therefore
needs an HTTPS deployment (localhost is also accepted during development). On
older Chrome versions or when Android Battery Saver blocks wake lock, set the
tablet's screen timeout manually and keep it connected to a sound charger.

## Install on an Android tablet

After deploying to an HTTPS URL:

1. Open the URL in Chrome.
2. Open Chrome's menu and choose **Add to Home screen** → **Install**.
3. Launch **My Next Bus** from the new home-screen icon.
4. Tap **Route** and choose operator, route, direction, and boarding stop.
5. Tap **Keep awake**, then use the fullscreen button if desired.

Favourites and cached arrivals are stored only in that browser profile. Clear
site data only if you intend to reset the board.
