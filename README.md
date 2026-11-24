# Network Speed Test

A speed test that works as a **website** (a single page) and as an **Android app**,
built from the same code. Developed by **Subrahmanyam**.

It covers the core features of the well-known speed test apps (Ookla Speedtest,
Cloudflare Speed Test, Fast.com) and adds a Wi-Fi vs mobile-data comparison.

## What it measures

| Metric | How |
|---|---|
| **Download** (Mbps) | 1, 4 or 8 parallel connections. Request size grows to about 1 s per request, and the first 25% of the phase (ramp-up) is not counted |
| **Upload** (Mbps) | Parallel XHR POSTs of random (incompressible) data, measured from upload progress |
| **Ping** (idle) | Median of 20 round trips after a warm-up request. Cloudflare's server processing time (`Server-Timing`) is subtracted |
| **Jitter** | Mean difference between consecutive ping samples |
| **Min / Max ping** | From the idle samples |
| **Loaded latency ⬇ / ⬆** | Pings sent *while* downloading and uploading |
| **Bufferbloat grade** | A+ … F, based on how much latency rises under load |
| **Request loss** | % of latency probes that failed or timed out (an HTTP stand-in for packet loss) |
| **Data used** | Total MB the test sent and received |
| **Quality ratings** | Streaming (SD/HD/4K), gaming, video calls, browsing |
| **Connection details** | Network type (Wi-Fi / mobile data / Ethernet), browser quality class (4G/3G…), OS bandwidth and RTT estimates, data saver, public IP, ISP + ASN, your city, and the test server's data centre |

Other features:
- **History** saved on the device, **averages by network type** (Wi-Fi vs mobile data vs Ethernet), and **CSV export**
- Live detection of the network type, with a warning if the network changes during a test
- **Mobile-data warning** with an estimate of the data a test will use
- Quick (5 s), Standard (10 s) and Extended (15 s) modes
- "Tag network as" option for desktop browsers, which don't report Wi-Fi vs Ethernet
- Share results (Android share sheet, Web Share API, or copy to clipboard)
- Light and dark theme, works on phones and desktops

### Test servers
The test uses Cloudflare's public speed-test endpoints (`speed.cloudflare.com/__down`,
`/__up`, `/cdn-cgi/trace`), the same ones used by speed.cloudflare.com. They allow
cross-origin requests, so **no backend is needed**. ISP name and city come from
`ipwho.is`; if that lookup fails, the app shows the ASN instead.

## Project layout

```
web/                     <- the whole app (single page, no build step)
  index.html
  css/app.css
  js/speedtest.js        <- measurement engine
  js/app.js              <- UI, history, connection detection, share
  vendor/                <- Capacitor runtime (copied by `npm run vendor`)
android/                 <- Capacitor Android project (committed)
android-keystore/        <- release signing key (keep this file!)
assets/                  <- icon and splash sources
scripts/                 <- vendor copy, local server, icon generator
.github/workflows/
  android.yml            <- builds the signed release APK on every push to main
  web.yml                <- deploys web/ to GitHub Pages
```

## Run the website locally

```powershell
npm install
npm run serve
```
Then open http://localhost:8080. You can also open `web/index.html` directly, or
host the `web/` folder on any static host (GitHub Pages, Netlify, Cloudflare Pages,
or IIS).

## Android APK

**On GitHub (recommended, no local Android SDK needed):** push to `main`, then open
**Actions → Build Android APK → artifact `NetworkSpeedTest-release-apk`**.

**Locally** (needs JDK 21 and the Android SDK):
```powershell
npm install
npm run cap:sync
cd android; .\gradlew assembleRelease
```
The APK is written to `android/app/build/outputs/apk/release/app-release.apk`.

After changing anything in `web/`, run `npm run cap:sync` before building the app.
To release a new app version, increase `versionCode` and `versionName` in
`android/app/build.gradle` and `VERSION` in `web/js/app.js`.

## Website on GitHub Pages
In the repo, go to **Settings → Pages → Source: GitHub Actions**. The `web.yml`
workflow then publishes the site at `https://<user>.github.io/NetworkingSpeedTest/`.

## Limits (MVP)
- True UDP packet loss can't be measured from a browser, so the app reports HTTP request loss instead.
- Wi-Fi SSID, signal strength (RSSI), cell tower and band details need extra native
  Android permissions (location). These are planned for a later version.
- Desktop browsers don't report Wi-Fi vs Ethernet. Use "Tag network as" there.
  On Android (app or Chrome) the type is detected automatically.

---
Developed by **Subrahmanyam** · Package `com.subrahmanyam.networkspeedtest`
