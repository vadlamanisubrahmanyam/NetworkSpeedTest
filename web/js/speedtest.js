/*
 * Speed test engine.
 *
 * Talks to Cloudflare's public speed-test endpoints (the same ones
 * speed.cloudflare.com uses). They send `Access-Control-Allow-Origin: *`,
 * so the page works from any origin — a website, file://, or the Android
 * WebView — with no backend of our own.
 *
 *   GET  /__down?bytes=N   -> N bytes (+ cf-meta-* headers: ip, colo, city, asn…)
 *   POST /__up             -> accepts any body
 *
 * Every response carries `Server-Timing: cfSpeedEdge;dur=x, cfSpeedWorker;dur=y`.
 * That server-side processing time is subtracted from latency samples so the
 * numbers reflect the network, not Cloudflare's worker.
 */
(function (global) {
  'use strict';

  const BASE = 'https://speed.cloudflare.com';
  const MB = 1e6;

  // Cloudflare data-centre (IATA) codes -> city, for the most common locations.
  const COLO_CITY = {
    HYD: 'Hyderabad', BOM: 'Mumbai', DEL: 'New Delhi', MAA: 'Chennai', BLR: 'Bengaluru', CCU: 'Kolkata',
    AMD: 'Ahmedabad', COK: 'Kochi', NAG: 'Nagpur', PAT: 'Patna', BBI: 'Bhubaneswar', IXC: 'Chandigarh',
    KNU: 'Kanpur', CMB: 'Colombo', DAC: 'Dhaka', KTM: 'Kathmandu', KHI: 'Karachi', DXB: 'Dubai',
    SIN: 'Singapore', HKG: 'Hong Kong', NRT: 'Tokyo', KIX: 'Osaka', ICN: 'Seoul', SYD: 'Sydney',
    MEL: 'Melbourne', LHR: 'London', FRA: 'Frankfurt', AMS: 'Amsterdam', CDG: 'Paris', MAD: 'Madrid',
    IAD: 'Ashburn', EWR: 'Newark', JFK: 'New York', ORD: 'Chicago', DFW: 'Dallas', ATL: 'Atlanta',
    LAX: 'Los Angeles', SJC: 'San Jose', SEA: 'Seattle', YYZ: 'Toronto', GRU: 'São Paulo', JNB: 'Johannesburg',
  };

  const now = () => performance.now();
  const rnd = () => Math.random().toString(36).slice(2);

  function median(arr) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /** Mean absolute difference between consecutive samples (RFC 3550 style). */
  function jitterOf(arr) {
    if (arr.length < 2) return null;
    let sum = 0;
    for (let i = 1; i < arr.length; i++) sum += Math.abs(arr[i] - arr[i - 1]);
    return sum / (arr.length - 1);
  }

  /** Sum of cfSpeedEdge + cfSpeedWorker durations (ms) from Server-Timing. */
  function serverTimeMs(header) {
    if (!header) return 0;
    let total = 0;
    for (const part of header.split(',')) {
      if (!/^\s*cfSpeed/i.test(part)) continue;
      const m = part.match(/dur=([\d.]+)/);
      if (m) total += parseFloat(m[1]);
    }
    return total;
  }

  /** Server-observed TCP RTT (ms) from the cfL4 Server-Timing entry, if present. */
  function serverRttMs(header) {
    if (!header) return null;
    const m = header.match(/[?&]min_rtt=(\d+)/);
    return m ? parseInt(m[1], 10) / 1000 : null;
  }

  function abortError() {
    const e = new Error('Test cancelled');
    e.name = 'AbortError';
    return e;
  }

  class SpeedTest {
    /**
     * @param {object} opts
     * @param {number} opts.durationSec  seconds per transfer phase
     * @param {number} opts.streams      parallel connections
     * @param {number} opts.pingCount    idle latency samples
     */
    constructor(opts = {}) {
      this.opts = Object.assign({ durationSec: 10, streams: 4, pingCount: 20 }, opts);
      this.cancelled = false;
      this.controllers = new Set();
      this.xhrs = new Set();
      this.bytesDown = 0;
      this.bytesUp = 0;
      this.pingsSent = 0;
      this.pingsFailed = 0;
    }

    cancel() {
      this.cancelled = true;
      this.controllers.forEach((c) => c.abort());
      this.xhrs.forEach((x) => x.abort());
    }

    _check() {
      if (this.cancelled) throw abortError();
    }

    _controller() {
      const c = new AbortController();
      this.controllers.add(c);
      return c;
    }

    /* ---------------- metadata ---------------- */

    async fetchMeta() {
      const c = this._controller();
      const t = setTimeout(() => c.abort(), 8000);
      try {
        const res = await fetch(`${BASE}/__down?bytes=0&r=${rnd()}`, { cache: 'no-store', signal: c.signal });
        await res.arrayBuffer();
        const h = (k) => res.headers.get(k) || '';
        const meta = {
          ip: h('cf-meta-ip'),
          colo: h('cf-meta-colo'),
          city: h('cf-meta-city'),
          country: h('cf-meta-country'),
          asn: h('cf-meta-asn'),
          isp: '',
        };
        const quick = async (url, ms) => {
          const ic = this._controller();
          const it = setTimeout(() => ic.abort(), ms);
          try { return await fetch(url, { cache: 'no-store', signal: ic.signal }); }
          finally { clearTimeout(it); this.controllers.delete(ic); }
        };
        // Test-server data centre + country (best-effort).
        try {
          const txt = await (await quick(`${BASE}/cdn-cgi/trace`, 4000)).text();
          const kv = Object.fromEntries(txt.trim().split('\n').map((l) => l.split('=')));
          meta.colo = meta.colo || kv.colo || '';
          meta.country = meta.country || kv.loc || '';
          meta.ip = meta.ip || kv.ip || '';
        } catch (_) { /* ignore */ }
        // Friendly ISP name + city (best-effort; the test works without it).
        try {
          const j = await (await quick('https://ipwho.is/?fields=isp,connection,city,region,country', 4000)).json();
          meta.isp = (j.connection && (j.connection.isp || j.connection.org)) || j.isp || '';
          if (j.connection && j.connection.asn && !meta.asn) meta.asn = String(j.connection.asn);
          meta.city = meta.city || j.city || '';
          meta.region = j.region || '';
          if (j.country) meta.country = j.country;
        } catch (_) { /* ignore */ }
        if (!meta.isp && meta.asn) meta.isp = `AS${meta.asn}`;
        meta.serverCity = COLO_CITY[meta.colo] || '';
        return meta;
      } finally {
        clearTimeout(t);
        this.controllers.delete(c);
      }
    }

    /* ---------------- latency ---------------- */

    /** One latency probe. Returns ms, or null on failure/timeout (counted as loss). */
    async pingOnce(timeoutMs = 3000) {
      this._check();
      const c = this._controller();
      const t = setTimeout(() => c.abort(), timeoutMs);
      this.pingsSent++;
      try {
        const t0 = now();
        const res = await fetch(`${BASE}/__down?bytes=0&r=${rnd()}`, { cache: 'no-store', signal: c.signal });
        await res.arrayBuffer();
        const elapsed = now() - t0;
        const st = res.headers.get('server-timing');
        const ms = elapsed - serverTimeMs(st);
        const floor = serverRttMs(st) || 0.5;
        return Math.max(floor, ms);
      } catch (e) {
        if (this.cancelled) throw abortError();
        this.pingsFailed++;
        return null;
      } finally {
        clearTimeout(t);
        this.controllers.delete(c);
      }
    }

    async measureLatency(onSample) {
      // Warm-up: open the connection (DNS + TCP + TLS) so it isn't counted.
      await this.pingOnce(5000);
      this.pingsSent = 0;
      this.pingsFailed = 0;
      const samples = [];
      for (let i = 0; i < this.opts.pingCount; i++) {
        const ms = await this.pingOnce();
        if (ms != null) samples.push(ms);
        onSample && onSample(ms, (i + 1) / this.opts.pingCount, samples);
      }
      if (!samples.length) throw new Error('Could not reach the test server. Check your connection.');
      return {
        ping: median(samples),
        jitter: jitterOf(samples),
        min: Math.min(...samples),
        max: Math.max(...samples),
        samples,
      };
    }

    /** Ping repeatedly while a transfer is running ("loaded latency" / bufferbloat). */
    _loadedLatencyLoop() {
      const samples = [];
      let running = true;
      const loop = (async () => {
        while (running && !this.cancelled) {
          const ms = await this.pingOnce(4000).catch(() => null);
          if (ms != null && running) samples.push(ms);
          await new Promise((r) => setTimeout(r, 250));
        }
      })();
      return {
        stop: async () => { running = false; await loop.catch(() => {}); return samples; },
      };
    }

    /* ---------------- throughput sampling ---------------- */

    /**
     * Samples a byte counter every 200 ms and reports live speed.
     * Final speed ignores the first 25% of the phase (TCP slow-start ramp-up)
     * and is computed over the remainder — similar to how commercial testers
     * discard the warm-up.
     */
    _sampler(getBytes, onProgress, durationMs) {
      const pts = [{ t: now(), b: 0 }];
      const start = pts[0].t;
      const id = setInterval(() => {
        const t = now();
        const b = getBytes();
        pts.push({ t, b });
        // live speed over the last ~1 s
        let j = pts.length - 1;
        while (j > 0 && t - pts[j].t < 1000) j--;
        const dt = (t - pts[j].t) / 1000;
        const mbps = dt > 0 ? ((b - pts[j].b) * 8) / dt / MB : 0;
        onProgress && onProgress(mbps, Math.min(1, (t - start) / durationMs));
      }, 200);
      return {
        finish: () => {
          clearInterval(id);
          const end = { t: now(), b: getBytes() };
          pts.push(end);
          const warm = start + (end.t - start) * 0.25;
          const w = pts.find((p) => p.t >= warm) || pts[0];
          const dt = (end.t - w.t) / 1000;
          const mbps = dt > 0.3 ? ((end.b - w.b) * 8) / dt / MB : ((end.b * 8) / Math.max(0.001, (end.t - start) / 1000)) / MB;
          return { mbps, bytes: end.b, seconds: (end.t - start) / 1000 };
        },
      };
    }

    /* ---------------- download ---------------- */

    async measureDownload(onProgress) {
      this._check();
      const durationMs = this.opts.durationSec * 1000;
      const deadline = now() + durationMs;
      let bytes = 0;
      const sampler = this._sampler(() => bytes, onProgress, durationMs);
      const loaded = this._loadedLatencyLoop();
      let errors = 0;

      const stream = async () => {
        let size = 250e3;
        while (now() < deadline && !this.cancelled) {
          const c = this._controller();
          const t0 = now();
          try {
            const res = await fetch(`${BASE}/__down?bytes=${size}&r=${rnd()}`, { cache: 'no-store', signal: c.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            if (res.body && res.body.getReader) {
              const reader = res.body.getReader();
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                bytes += value.length;
                if (now() >= deadline || this.cancelled) { c.abort(); break; }
              }
            } else {
              bytes += (await res.arrayBuffer()).byteLength;
            }
          } catch (e) {
            if (this.cancelled) return;
            if (now() < deadline && ++errors > 20) throw new Error('Download failed repeatedly. Check your connection.');
          } finally {
            this.controllers.delete(c);
          }
          // Grow request size until each request lasts ~1 s (max 50 MB).
          if (now() - t0 < 1000) size = Math.min(size * 2, 50e6);
        }
      };

      try {
        await Promise.all(Array.from({ length: this.opts.streams }, stream));
      } finally {
        const latency = await loaded.stop();
        var result = sampler.finish();
        result.loadedLatency = median(latency);
        result.loadedJitter = jitterOf(latency);
      }
      this._check();
      this.bytesDown = result.bytes;
      return result;
    }

    /* ---------------- upload ---------------- */

    _payload(size) {
      if (!this._chunk) {
        // 1 MB of random bytes (incompressible), reused to build larger bodies.
        const buf = new Uint8Array(1 << 20);
        for (let i = 0; i < buf.length; i += 65536) crypto.getRandomValues(buf.subarray(i, i + 65536));
        this._chunk = buf;
      }
      const parts = [];
      let left = size;
      while (left > 0) {
        const n = Math.min(left, this._chunk.length);
        parts.push(n === this._chunk.length ? this._chunk : this._chunk.subarray(0, n));
        left -= n;
      }
      return new Blob(parts, { type: 'text/plain' }); // text/plain avoids a CORS preflight
    }

    _uploadOnce(size, onBytes) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        this.xhrs.add(xhr);
        let last = 0;
        xhr.upload.onprogress = (e) => { onBytes(e.loaded - last); last = e.loaded; };
        const done = (fn) => () => { this.xhrs.delete(xhr); fn(); };
        xhr.onload = done(() => { onBytes(size - last); resolve(); });
        xhr.onerror = done(() => reject(new Error('Upload error')));
        xhr.onabort = done(() => resolve());
        xhr.ontimeout = done(() => reject(new Error('Upload timeout')));
        xhr.open('POST', `${BASE}/__up?r=${rnd()}`, true);
        xhr.timeout = 60000;
        xhr.send(this._payload(size));
      });
    }

    async measureUpload(onProgress) {
      this._check();
      const durationMs = this.opts.durationSec * 1000;
      const deadline = now() + durationMs;
      let bytes = 0;
      const sampler = this._sampler(() => bytes, onProgress, durationMs);
      const loaded = this._loadedLatencyLoop();
      let errors = 0;
      const stopTimer = setTimeout(() => this.xhrs.forEach((x) => x.abort()), durationMs);

      const stream = async () => {
        let size = 256e3;
        while (now() < deadline && !this.cancelled) {
          const t0 = now();
          try {
            await this._uploadOnce(size, (d) => { if (now() < deadline) bytes += Math.max(0, d); });
          } catch (e) {
            if (this.cancelled) return;
            if (now() < deadline && ++errors > 20) throw new Error('Upload failed repeatedly. Check your connection.');
          }
          if (now() - t0 < 1000) size = Math.min(size * 2, 32e6);
        }
      };

      try {
        await Promise.all(Array.from({ length: this.opts.streams }, stream));
      } finally {
        clearTimeout(stopTimer);
        const latency = await loaded.stop();
        var result = sampler.finish();
        result.loadedLatency = median(latency);
        result.loadedJitter = jitterOf(latency);
      }
      this._check();
      this.bytesUp = result.bytes;
      return result;
    }

    get requestLossPct() {
      return this.pingsSent ? (this.pingsFailed / this.pingsSent) * 100 : 0;
    }
  }

  /* ---------------- scoring ---------------- */

  function grade(level) {
    return { 3: 'Great', 2: 'Good', 1: 'Fair', 0: 'Poor' }[level];
  }

  /** Simple use-case quality ratings, in the spirit of Cloudflare's AIM scores. */
  function qualityScores(r) {
    const down = r.download, up = r.upload, ping = r.ping, jit = r.jitter || 0;
    const loss = r.loss || 0;
    const loaded = Math.max(r.loadedLatencyDown || ping, r.loadedLatencyUp || ping);

    const streaming =
      down >= 25 && loaded < 150 ? 3 : down >= 10 ? 2 : down >= 3 ? 1 : 0;
    const gaming =
      ping < 30 && jit < 10 && loss < 1 && loaded < 100 ? 3 :
      ping < 60 && jit < 20 && loss < 2 ? 2 :
      ping < 100 && jit < 40 ? 1 : 0;
    const video =
      down >= 5 && up >= 3 && ping < 50 && jit < 15 ? 3 :
      down >= 2 && up >= 1.5 && ping < 100 && jit < 30 ? 2 :
      down >= 1 && up >= 0.5 && ping < 200 ? 1 : 0;
    const browsing =
      down >= 10 && ping < 60 ? 3 : down >= 3 && ping < 120 ? 2 : down >= 1 ? 1 : 0;

    return [
      { key: 'streaming', label: 'Video streaming', detail: down >= 25 ? '4K UHD' : down >= 5 ? 'Full HD' : 'SD', level: streaming },
      { key: 'gaming', label: 'Online gaming', detail: `${Math.round(ping)} ms ping`, level: gaming },
      { key: 'video', label: 'Video calls', detail: 'Zoom / Meet / Teams', level: video },
      { key: 'browsing', label: 'Web browsing', detail: 'Pages & apps', level: browsing },
    ].map((q) => Object.assign(q, { grade: grade(q.level) }));
  }

  /** Bufferbloat grade from latency increase under load (Waveform-style). */
  function bufferbloatGrade(idle, loadedDown, loadedUp) {
    const loaded = Math.max(loadedDown || 0, loadedUp || 0);
    if (!idle || !loaded) return { grade: '—', increase: null };
    const inc = Math.max(0, loaded - idle);
    const g = inc < 5 ? 'A+' : inc < 30 ? 'A' : inc < 60 ? 'B' : inc < 200 ? 'C' : inc < 400 ? 'D' : 'F';
    return { grade: g, increase: inc };
  }

  global.NST = { SpeedTest, qualityScores, bufferbloatGrade, median, jitterOf };
})(window);
