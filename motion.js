/* ============================================================
   BrowserSlop — motion input manager
   Normalizes physical laptop motion into a single structure:

     { tiltX, tiltY, ax, ay, az, impact }   (all roughly -1..1, g units)

   Sources, in priority order:
     1. "local"   — a native accelerometer bridge streaming JSON over a
                    local WebSocket (see NATIVE BRIDGE note below).
     2. "browser" — DeviceMotionEvent / DeviceOrientationEvent, when the
                    platform actually delivers data (most Windows laptops
                    fire nothing, which is why the bridge exists).
     3. "mouse"   — pointer position simulates gentle tilt; clicking the
                    empty background simulates a tap impulse.

   NATIVE BRIDGE: to feed real accelerometer data on Windows, run any
   local service that accepts a WebSocket connection on the endpoint
   configured in Settings (default ws://localhost:8765) and streams
   frames shaped like:
     { "x": 0.04, "y": -0.18, "z": 0.98,
       "tiltX": -0.18, "tiltY": 0.04, "impact": 0.12 }
   The page connects lazily, retries quietly every 30 s, and never
   blocks loading when the service is absent.
   ============================================================ */
"use strict";

const MotionInput = (() => {
  const raw = { tiltX: 0, tiltY: 0, ax: 0, ay: 0, az: 0 };
  const smooth = { tiltX: 0, tiltY: 0, ax: 0, ay: 0 };
  const mouseTilt = { x: 0, y: 0 };
  let impulses = []; // pending shockwaves: { x, y, strength }
  let cfg = { enabled: true, sensitivity: 50, tap: 50, ws: "" };
  let source = "unavailable"; // 'local' | 'browser' | 'mouse' | 'unavailable'
  let sourceCb = null;
  let ws = null;
  let wsTimer = 0;
  let lastSensorImpact = 0;
  let mouseSeen = false;

  function setSource(s) {
    if (source === s) return;
    source = s;
    if (sourceCb) sourceCb(s);
  }

  function fallbackSource() {
    return mouseSeen ? "mouse" : "unavailable";
  }

  function pushImpulse(x, y, strength) {
    if (!cfg.enabled) return;
    impulses.push({ x, y, strength: strength * (cfg.tap / 50) });
    if (impulses.length > 6) impulses.shift();
  }

  /* ---------- source 1: local WebSocket bridge ---------- */
  function connectWS() {
    clearTimeout(wsTimer);
    if (!cfg.enabled || !cfg.ws) return;
    try {
      ws = new WebSocket(cfg.ws);
    } catch {
      scheduleRetry();
      return;
    }
    ws.onopen = () => setSource("local");
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        raw.ax = +d.x || 0;
        raw.ay = +d.y || 0;
        raw.az = +d.z || 0;
        raw.tiltX = Math.max(-1, Math.min(1, +d.tiltX || 0));
        raw.tiltY = Math.max(-1, Math.min(1, +d.tiltY || 0));
        const impact = +d.impact || 0;
        if (impact > 0.06 && Date.now() - lastSensorImpact > 200) {
          lastSensorImpact = Date.now();
          pushImpulse(innerWidth / 2, innerHeight / 2, Math.min(1.5, impact * 3));
        }
      } catch { /* malformed frame — ignore */ }
    };
    const drop = () => {
      if (ws) { ws.onclose = ws.onerror = null; ws = null; }
      if (source === "local") setSource(fallbackSource());
      scheduleRetry();
    };
    ws.onclose = drop;
    ws.onerror = drop;
  }

  function scheduleRetry() {
    clearTimeout(wsTimer);
    if (cfg.enabled && cfg.ws) wsTimer = setTimeout(connectWS, 30000);
  }

  /* ---------- source 2: browser motion APIs ---------- */
  addEventListener("deviceorientation", (e) => {
    if (e.beta == null && e.gamma == null) return;
    if (source !== "local") setSource("browser");
    // gamma: left/right tilt (deg), beta: front/back. Normalize ±45° → ±1.
    raw.tiltX = Math.max(-1, Math.min(1, (e.gamma || 0) / 45));
    raw.tiltY = Math.max(-1, Math.min(1, (e.beta || 0) / 45));
  });

  addEventListener("devicemotion", (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    if (source !== "local") setSource("browser");
    raw.ax = a.x / 9.81;
    raw.ay = a.y / 9.81;
    raw.az = a.z / 9.81;
    const magnitude = Math.sqrt(raw.ax * raw.ax + raw.ay * raw.ay + raw.az * raw.az);
    const impact = Math.abs(magnitude - 1);
    if (impact > 0.25 && Date.now() - lastSensorImpact > 250) {
      lastSensorImpact = Date.now();
      pushImpulse(innerWidth / 2, innerHeight / 2, Math.min(1.5, impact * 2));
    }
  });

  /* ---------- source 3: mouse simulation ---------- */
  addEventListener("pointermove", (e) => {
    mouseSeen = true;
    mouseTilt.x = (e.clientX / innerWidth - 0.5) * 2;
    mouseTilt.y = (e.clientY / innerHeight - 0.5) * 2;
    if (source === "unavailable") setSource("mouse");
  });

  addEventListener("pointerdown", (e) => {
    if (!cfg.enabled) return;
    if (source === "local" || source === "browser") return; // real taps come from sensors
    if (document.body.classList.contains("edit-mode")) return;
    // Never fire on interactive surfaces — background clicks only.
    if (e.target.closest("button, a, input, textarea, select, label, .widget, .panel, .gallery, .top-actions, .scrim")) return;
    pushImpulse(e.clientX, e.clientY, 0.6);
  });

  /* ---------- per-frame API ---------- */
  // Heavy low-pass smoothing so sensor noise never becomes visible jitter.
  function sample() {
    const sens = cfg.sensitivity / 50;
    const useMouse = source === "mouse" || source === "unavailable";
    const tx = (useMouse ? mouseTilt.x * 0.35 : raw.tiltX) * sens;
    const ty = (useMouse ? mouseTilt.y * 0.35 : raw.tiltY) * sens;
    smooth.tiltX += (tx - smooth.tiltX) * 0.06;
    smooth.tiltY += (ty - smooth.tiltY) * 0.06;
    smooth.ax += ((useMouse ? 0 : raw.ax) * sens - smooth.ax) * 0.08;
    smooth.ay += ((useMouse ? 0 : raw.ay) * sens - smooth.ay) * 0.08;
    return smooth;
  }

  function drainImpulses() {
    if (!impulses.length) return impulses;
    const out = impulses;
    impulses = [];
    return out;
  }

  function configure(next) {
    const wsChanged = next.ws !== cfg.ws || next.enabled !== cfg.enabled;
    cfg = { ...cfg, ...next };
    if (wsChanged) {
      if (ws) { ws.onclose = ws.onerror = null; try { ws.close(); } catch { /* noop */ } ws = null; }
      clearTimeout(wsTimer);
      if (source === "local") setSource(fallbackSource());
      if (cfg.enabled && cfg.ws) connectWS();
    }
  }

  return {
    sample,
    drainImpulses,
    configure,
    get source() { return source; },
    onSource(cb) { sourceCb = cb; cb(source); }
  };
})();
