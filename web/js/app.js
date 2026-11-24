/* UI controller — works the same on the website and inside the Android app. */
(function () {
  'use strict';

  const VERSION = '1.0.0';
  const HISTORY_KEY = 'nst.history.v1';
  const SETTINGS_KEY = 'nst.settings.v1';

  const $ = (id) => document.getElementById(id);
  const Cap = window.capacitorExports && window.capacitorExports.Capacitor;
  const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const NativeNetwork = isNative && window.capacitorNetwork ? window.capacitorNetwork.Network : null;
  const NativeShare = isNative && window.capacitorShare ? window.capacitorShare.Share : null;

  const TYPE_LABEL = { wifi: 'Wi-Fi', cellular: 'Mobile data', ethernet: 'Ethernet', none: 'Offline', unknown: 'Unknown', bluetooth: 'Bluetooth', wimax: 'WiMAX', other: 'Other' };
  const TYPE_ICON = { wifi: '📶', cellular: '📱', ethernet: '🔌', none: '⛔', unknown: '🌐' };

  let conn = { type: 'unknown', online: navigator.onLine };
  let meta = null;
  let test = null;
  let lastResult = null;
  let typeAtStart = null;

  /* ================= storage helpers ================= */
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) { /* ignore */ } },
  };

  /* ================= formatting ================= */
  function fmtSpeed(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 100) return v.toFixed(0);
    if (v >= 10) return v.toFixed(1);
    return v.toFixed(2);
  }
  const fmtMs = (v) => (v == null || !isFinite(v) ? '—' : v < 10 ? v.toFixed(1) : Math.round(v).toString());
  const fmtMB = (bytes) => (bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1);
  const typeLabel = (t) => TYPE_LABEL[t] || t || 'Unknown';

  /* ================= gauge ================= */
  const G = { cx: 150, cy: 150, r: 110, start: 150, sweep: 240 };
  const SCALE = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000];

  function polar(angleDeg, r) {
    const a = (angleDeg * Math.PI) / 180;
    return [G.cx + r * Math.cos(a), G.cy + r * Math.sin(a)];
  }
  function arcPath(fromDeg, toDeg, r) {
    const [x1, y1] = polar(fromDeg, r);
    const [x2, y2] = polar(toDeg, r);
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  function fraction(v) {
    if (!(v > 0)) return 0;
    if (v >= SCALE[SCALE.length - 1]) return 1;
    for (let i = 1; i < SCALE.length; i++) {
      if (v <= SCALE[i]) {
        const seg = (v - SCALE[i - 1]) / (SCALE[i] - SCALE[i - 1]);
        return (i - 1 + seg) / (SCALE.length - 1);
      }
    }
    return 1;
  }
  function initGauge() {
    $('gTrack').setAttribute('d', arcPath(G.start, G.start + G.sweep, G.r));
    const ticks = $('gTicks');
    SCALE.forEach((v, i) => {
      const [x, y] = polar(G.start + (G.sweep * i) / (SCALE.length - 1), G.r - 30);
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', x.toFixed(1));
      t.setAttribute('y', y.toFixed(1));
      t.textContent = v >= 1000 ? '1G' : v;
      ticks.appendChild(t);
    });
    setGauge(0);
  }
  function setGauge(mbps) {
    const f = fraction(mbps);
    const end = G.start + Math.max(0.5, G.sweep * f);
    $('gFill').setAttribute('d', arcPath(G.start, end, G.r));
    $('gFill').style.opacity = f > 0 ? 1 : 0;
    $('gNeedle').style.transform = `rotate(${G.start + G.sweep * f - 270}deg)`;
    $('gValue').textContent = mbps > 0 ? fmtSpeed(mbps) : '0';
  }

  /* ================= connection info ================= */
  function browserConnection() {
    return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  }

  async function refreshConnection() {
    const nc = browserConnection();
    let type = 'unknown';
    if (NativeNetwork) {
      try {
        const st = await NativeNetwork.getStatus();
        type = st.connected ? st.connectionType : 'none';
      } catch (_) { /* fall through */ }
    }
    if (type === 'unknown' && nc && nc.type) type = nc.type; // Chrome on Android exposes this
    if (!navigator.onLine) type = 'none';
    conn = {
      type,
      online: type !== 'none' && navigator.onLine,
      effectiveType: nc && nc.effectiveType,
      downlink: nc && nc.downlink,
      rtt: nc && nc.rtt,
      saveData: nc && nc.saveData,
    };
    renderConnection();
  }

  function effectiveTag() {
    const tag = $('optTag').value;
    return tag === 'auto' ? conn.type : tag;
  }

  function renderConnection() {
    const t = conn.type;
    const chip = $('chipType');
    chip.classList.toggle('online', conn.online);
    chip.classList.toggle('offline', !conn.online);
    $('connType').textContent = `${TYPE_ICON[t] || TYPE_ICON.unknown} ${t === 'unknown' ? 'Network type not exposed' : typeLabel(t)}`;

    const eff = $('chipEff');
    if (conn.effectiveType) { eff.hidden = false; eff.textContent = `Quality class: ${conn.effectiveType.toUpperCase()}`; } else eff.hidden = true;

    $('dType').textContent = t === 'unknown'
      ? (isNative ? 'Unknown' : 'Not exposed by this browser — use “Tag network as”')
      : typeLabel(t);
    $('dEff').textContent = conn.effectiveType ? `${conn.effectiveType.toUpperCase()} (browser estimate)` : '—';
    $('dDownlink').textContent = conn.downlink != null ? `${conn.downlink} Mbps` : '—';
    $('dRtt').textContent = conn.rtt != null ? `${conn.rtt} ms` : '—';
    $('dSave').textContent = conn.saveData == null ? '—' : conn.saveData ? 'On' : 'Off';
    $('dPlatform').textContent = isNative ? `Android app (v${VERSION})` : `Web · ${browserName()}`;

    const onCell = effectiveTag() === 'cellular';
    $('dataWarn').hidden = !onCell || !!test;
    if (onCell) $('dataEst').textContent = estimateData();
  }

  function estimateData() {
    const hist = store.get(HISTORY_KEY, []).filter((h) => h.type === 'cellular' && h.dataMB);
    const secs = Number($('optDuration').value);
    if (hist.length) {
      const avg = hist.slice(0, 5).reduce((s, h) => s + h.dataMB / (h.durationSec || 10), 0) / Math.min(5, hist.length);
      return `~${Math.max(1, Math.round(avg * secs))} MB`;
    }
    return secs <= 5 ? '20–150 MB' : secs <= 10 ? '50–300 MB' : '75–450 MB';
  }

  function browserName() {
    const ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return 'Edge';
    if (/OPR\//.test(ua)) return 'Opera';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Safari\//.test(ua)) return 'Safari';
    return 'Browser';
  }

  function renderMeta() {
    if (!meta) return;
    $('dIp').textContent = meta.ip || '—';
    $('dIsp').textContent = meta.isp ? `${meta.isp}${meta.asn ? ` (AS${meta.asn})` : ''}` : '—';
    $('dLoc').textContent = [meta.city, meta.region, meta.country].filter(Boolean).join(', ') || '—';
    $('dServer').textContent = meta.colo ? `Cloudflare · ${meta.serverCity ? `${meta.serverCity} (${meta.colo})` : meta.colo}` : '—';
    const isp = $('chipIsp');
    if (meta.isp) { isp.hidden = false; isp.textContent = meta.isp; }
  }

  /* ================= test flow ================= */
  function setPhase(name, label) {
    const order = ['meta', 'ping', 'download', 'upload'];
    const idx = order.indexOf(name);
    document.querySelectorAll('#phases span').forEach((el) => {
      const i = order.indexOf(el.dataset.phase);
      el.classList.toggle('active', i === idx);
      el.classList.toggle('done', idx === -1 ? name === 'done' : i < idx);
    });
    $('gPhase').textContent = label;
  }
  function setProgress(overall) { $('progressBar').style.width = `${Math.round(overall * 100)}%`; }

  function resetMetrics() {
    ['mDown', 'mUp', 'mPing', 'mJitter', 'mLdDown', 'mLdUp', 'mMinMax', 'mLoss', 'mBloat', 'mData'].forEach((id) => { $(id).textContent = '—'; });
    $('mBloatInc').textContent = '';
    $('qualityCard').hidden = true;
    $('resultActions').hidden = true;
    $('errorBox').hidden = true;
  }

  function lockOptions(locked) {
    ['optDuration', 'optStreams', 'optTag'].forEach((id) => { $(id).disabled = locked; });
  }

  async function startTest() {
    if (test) { test.cancel(); return; }
    await refreshConnection();
    if (!conn.online) {
      showError('You appear to be offline. Connect to Wi-Fi or mobile data and try again.');
      return;
    }
    resetMetrics();
    const durationSec = Number($('optDuration').value);
    const streams = Number($('optStreams').value);
    test = new NST.SpeedTest({ durationSec, streams });
    typeAtStart = conn.type;
    const tag = effectiveTag();
    const btn = $('goBtn');
    btn.textContent = 'Cancel';
    btn.classList.add('running');
    lockOptions(true);
    $('dataWarn').hidden = true;
    setGauge(0);

    // Overall progress weights: meta 5%, ping 15%, download 40%, upload 40%
    try {
      setPhase('meta', 'Finding server…');
      setProgress(0.02);
      meta = await test.fetchMeta();
      renderMeta();

      setPhase('ping', 'Measuring ping…');
      const lat = await test.measureLatency((ms, f) => {
        setProgress(0.05 + 0.15 * f);
        if (ms != null) { $('mPing').textContent = fmtMs(ms); }
      });
      $('mPing').textContent = fmtMs(lat.ping);
      $('mJitter').textContent = fmtMs(lat.jitter);
      $('mMinMax').textContent = `${fmtMs(lat.min)} / ${fmtMs(lat.max)}`;

      setPhase('download', 'Testing download…');
      const down = await test.measureDownload((mbps, f) => {
        setGauge(mbps);
        $('mDown').textContent = fmtSpeed(mbps);
        setProgress(0.2 + 0.4 * f);
      });
      $('mDown').textContent = fmtSpeed(down.mbps);
      $('mLdDown').textContent = fmtMs(down.loadedLatency);
      setGauge(0);

      setPhase('upload', 'Testing upload…');
      const up = await test.measureUpload((mbps, f) => {
        setGauge(mbps);
        $('mUp').textContent = fmtSpeed(mbps);
        setProgress(0.6 + 0.4 * f);
      });
      $('mUp').textContent = fmtSpeed(up.mbps);
      $('mLdUp').textContent = fmtMs(up.loadedLatency);

      const loss = test.requestLossPct;
      const bloat = NST.bufferbloatGrade(lat.ping, down.loadedLatency, up.loadedLatency);
      const dataBytes = down.bytes + up.bytes;
      $('mLoss').textContent = loss.toFixed(loss < 1 && loss > 0 ? 1 : 0);
      $('mBloat').textContent = bloat.grade;
      $('mBloatInc').textContent = bloat.increase != null ? `(+${Math.round(bloat.increase)} ms)` : '';
      $('mData').textContent = fmtMB(dataBytes);

      setProgress(1);
      setPhase('done', 'Complete ✓');
      setGauge(down.mbps);

      lastResult = {
        ts: Date.now(),
        type: tag,
        typeChanged: conn.type !== typeAtStart,
        download: down.mbps,
        upload: up.mbps,
        ping: lat.ping,
        jitter: lat.jitter,
        pingMin: lat.min,
        pingMax: lat.max,
        loadedLatencyDown: down.loadedLatency,
        loadedLatencyUp: up.loadedLatency,
        loss,
        bufferbloat: bloat.grade,
        dataMB: +(dataBytes / 1e6).toFixed(1),
        durationSec,
        streams,
        effectiveType: conn.effectiveType || '',
        ip: meta.ip, isp: meta.isp, colo: meta.colo, city: meta.city, country: meta.country,
        platform: isNative ? 'android-app' : 'web',
      };
      saveResult(lastResult);
      renderQuality(lastResult);
      $('resultActions').hidden = false;
      if (lastResult.typeChanged) showError('Heads-up: your network changed during the test, so these numbers may be mixed.');
    } catch (e) {
      setGauge(0);
      if (e && e.name === 'AbortError') {
        setPhase('', 'Cancelled');
      } else {
        setPhase('', 'Failed');
        showError((e && e.message) || 'Test failed.');
      }
      setProgress(0);
    } finally {
      test = null;
      btn.textContent = 'GO';
      btn.classList.remove('running');
      lockOptions(false);
      renderConnection();
    }
  }

  function showError(msg) {
    const box = $('errorBox');
    box.textContent = msg;
    box.hidden = false;
  }

  function renderQuality(r) {
    const q = NST.qualityScores(r);
    $('quality').innerHTML = q.map((x) => `
      <div class="q">
        <div class="q-label">${x.label}</div>
        <div class="q-detail">${x.detail}</div>
        <div class="q-grade lvl-${x.level}">${x.grade}</div>
      </div>`).join('');
    $('qualityCard').hidden = false;
  }

  /* ================= history ================= */
  function saveResult(r) {
    const hist = store.get(HISTORY_KEY, []);
    hist.unshift(r);
    store.set(HISTORY_KEY, hist.slice(0, 200));
    renderHistory();
  }

  function renderHistory() {
    const hist = store.get(HISTORY_KEY, []);
    $('historyEmpty').hidden = hist.length > 0;
    $('historyBody').innerHTML = hist.map((h) => {
      const d = new Date(h.ts);
      const when = `${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
      return `<tr>
        <td>${when}</td>
        <td>${TYPE_ICON[h.type] || TYPE_ICON.unknown} ${escapeHtml(typeLabel(h.type))}${h.isp ? `<br><small class="muted">${escapeHtml(h.isp)}</small>` : ''}</td>
        <td><b>${fmtSpeed(h.download)}</b></td>
        <td><b>${fmtSpeed(h.upload)}</b></td>
        <td>${fmtMs(h.ping)}</td>
        <td>${fmtMs(h.jitter)}</td>
      </tr>`;
    }).join('');

    // Averages per network type (Wi-Fi vs Mobile data vs Ethernet…)
    const groups = {};
    hist.forEach((h) => { (groups[h.type] = groups[h.type] || []).push(h); });
    const keys = Object.keys(groups);
    if (!keys.length) {
      $('compare').innerHTML = '<p class="empty">Run tests on Wi-Fi and mobile data to compare them here.</p>';
      return;
    }
    const avg = (arr, k) => arr.reduce((s, x) => s + (x[k] || 0), 0) / arr.length;
    $('compare').innerHTML = keys.map((k) => {
      const g = groups[k];
      return `<div class="cmp">
        <h4>${TYPE_ICON[k] || TYPE_ICON.unknown} ${escapeHtml(typeLabel(k))} <small class="muted">(${g.length} test${g.length > 1 ? 's' : ''})</small></h4>
        <div><span>Download</span><span>${fmtSpeed(avg(g, 'download'))} Mbps</span></div>
        <div><span>Upload</span><span>${fmtSpeed(avg(g, 'upload'))} Mbps</span></div>
        <div><span>Ping</span><span>${fmtMs(avg(g, 'ping'))} ms</span></div>
        <div><span>Jitter</span><span>${fmtMs(avg(g, 'jitter'))} ms</span></div>
        <div><span>Best download</span><span>${fmtSpeed(Math.max(...g.map((x) => x.download)))} Mbps</span></div>
      </div>`;
    }).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function exportCsv() {
    const hist = store.get(HISTORY_KEY, []);
    if (!hist.length) return;
    const cols = ['ts', 'type', 'download', 'upload', 'ping', 'jitter', 'pingMin', 'pingMax', 'loadedLatencyDown', 'loadedLatencyUp', 'loss', 'bufferbloat', 'dataMB', 'durationSec', 'streams', 'effectiveType', 'isp', 'colo', 'city', 'country', 'platform'];
    const rows = [cols.join(',')].concat(hist.map((h) => cols.map((c) => {
      let v = c === 'ts' ? new Date(h.ts).toISOString() : h[c];
      if (typeof v === 'number') v = Math.round(v * 100) / 100;
      v = v == null ? '' : String(v);
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(',')));
    const csv = rows.join('\n');
    if (isNative && NativeShare) {
      NativeShare.share({ title: 'Speed test history', text: csv }).catch(() => {});
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `speed-tests-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ================= share ================= */
  async function shareResult() {
    const r = lastResult;
    if (!r) return;
    const text = [
      `My internet speed (${typeLabel(r.type)}${r.isp ? `, ${r.isp}` : ''}):`,
      `⬇ ${fmtSpeed(r.download)} Mbps  ⬆ ${fmtSpeed(r.upload)} Mbps`,
      `Ping ${fmtMs(r.ping)} ms · Jitter ${fmtMs(r.jitter)} ms · Bufferbloat ${r.bufferbloat}`,
      'Tested with Network Speed Test by Subrahmanyam',
    ].join('\n');
    try {
      if (NativeShare) { await NativeShare.share({ title: 'Speed test result', text }); return; }
      if (navigator.share) { await navigator.share({ title: 'Speed test result', text }); return; }
      await navigator.clipboard.writeText(text);
      $('shareBtn').textContent = 'Copied ✓';
      setTimeout(() => { $('shareBtn').textContent = 'Share result'; }, 1800);
    } catch (_) { /* user cancelled */ }
  }

  /* ================= wiring ================= */
  function switchView(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    if (name === 'history') renderHistory();
  }

  function init() {
    $('year').textContent = new Date().getFullYear();
    $('versionLine').textContent = `Version ${VERSION}${isNative ? ' · Android app' : ' · Web'}`;

    const s = store.get(SETTINGS_KEY, null);
    if (s) {
      if (s.duration) $('optDuration').value = s.duration;
      if (s.streams) $('optStreams').value = s.streams;
    }
    const saveSettings = () => store.set(SETTINGS_KEY, { duration: $('optDuration').value, streams: $('optStreams').value });
    $('optDuration').addEventListener('change', () => { saveSettings(); renderConnection(); });
    $('optStreams').addEventListener('change', saveSettings);
    $('optTag').addEventListener('change', renderConnection);

    initGauge();
    $('goBtn').addEventListener('click', startTest);
    $('againBtn').addEventListener('click', startTest);
    $('shareBtn').addEventListener('click', shareResult);
    $('exportBtn').addEventListener('click', exportCsv);
    $('clearBtn').addEventListener('click', () => {
      if (confirm('Delete all saved results on this device?')) { store.set(HISTORY_KEY, []); renderHistory(); }
    });
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

    // Keep the connection type live (Wi-Fi <-> mobile data switches).
    window.addEventListener('online', refreshConnection);
    window.addEventListener('offline', refreshConnection);
    const nc = browserConnection();
    if (nc && nc.addEventListener) nc.addEventListener('change', refreshConnection);
    if (NativeNetwork) NativeNetwork.addListener('networkStatusChange', refreshConnection);

    refreshConnection();
    renderHistory();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
