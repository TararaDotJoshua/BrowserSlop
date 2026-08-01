/* ============================================================
   BrowserSlop — new tab dashboard
   ============================================================ */
"use strict";

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shiftHue(hex, deg) {
  let [r, g, b] = hexRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d) {
    if (mx === r) hh = ((g - b) / d) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
  }
  hh = (hh * 60 + deg + 360) % 360;
  const l = (mx + mn) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (hh < 60) rgb = [c, x, 0];
  else if (hh < 120) rgb = [x, c, 0];
  else if (hh < 180) rgb = [0, c, x];
  else if (hh < 240) rgb = [0, x, c];
  else if (hh < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => Math.round((v + m) * 255));
}

const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ---------- state ---------- */
const LS = {
  settings: "browserslop.v1.settings",
  layout: "browserslop.v1.layout",
  data: "browserslop.v1.data",
  onboarding: "browserslop.v1.onboarding"
};

const DEFAULT_SETTINGS = {
  theme: "auto",
  accent: "#0a84ff",
  googleClientId: "",
  xClientId: "",
  xClientSecret: "",
  cardAlpha: 72,
  blur: 24,
  ambient: true,
  showGreeting: true,
  showSearch: true,
  particles: { style: "aurora", density: 45, speed: 35, size: 50, interact: true },
  motion: { enabled: true, sensitivity: 50, tap: 50, strength: 50, reduce: false, ws: "ws://localhost:8765" }
};

const DEFAULT_LAYOUT = [
  { t: "today", w: 1, h: 1 },
  { t: "weather", w: 2, h: 1 },
  { t: "focus", w: 1, h: 1 },
  { t: "calendar", w: 4, h: 2 },
  { t: "tasks", w: 4, h: 2 }
];

function loadJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v == null ? structuredClone(fallback) : v;
  } catch {
    return structuredClone(fallback);
  }
}

const state = {
  settings: Object.assign(structuredClone(DEFAULT_SETTINGS), loadJSON(LS.settings, {})),
  layout: loadJSON(LS.layout, DEFAULT_LAYOUT),
  data: loadJSON(LS.data, {})
};
state.settings.particles = Object.assign(
  structuredClone(DEFAULT_SETTINGS.particles),
  state.settings.particles || {}
);
state.settings.motion = Object.assign(
  structuredClone(DEFAULT_SETTINGS.motion),
  state.settings.motion || {}
);
// Migrate style names from earlier versions of the engine.
const PSTYLE_MIGRATE = { drift: "aurora", orbit: "lattice" };
if (PSTYLE_MIGRATE[state.settings.particles.style]) {
  state.settings.particles.style = PSTYLE_MIGRATE[state.settings.particles.style];
}
try {
  const savedXAuth = JSON.parse(localStorage.getItem("browserslop.v1.xauth"));
  if (savedXAuth?.clientId && savedXAuth.clientId !== state.settings.xClientId) {
    localStorage.removeItem("browserslop.v1.xauth");
  }
} catch {
  localStorage.removeItem("browserslop.v1.xauth");
}

const saveSettings = () => localStorage.setItem(LS.settings, JSON.stringify(state.settings));
const saveLayout = () => localStorage.setItem(LS.layout, JSON.stringify(state.layout));
const saveData = () => localStorage.setItem(LS.data, JSON.stringify(state.data));

function widgetData(type, fallback) {
  if (!(type in state.data)) state.data[type] = structuredClone(fallback);
  return state.data[type];
}

/* ============================================================
   Particle engine
   ============================================================ */
const particles = (() => {
  const cv = $("#bg-particles");
  const ctx = cv.getContext("2d");
  const mouse = { x: -1e4, y: -1e4 };
  const ms = { x: -1e4, y: -1e4 }; // smoothed cursor for elastic effects
  // Honor reduced-motion by slowing the animation rather than freezing it.
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Weaker machines get fewer particles automatically.
  const WEAK = (navigator.hardwareConcurrency || 8) <= 4;
  let cfg = null;
  let mcfg = { enabled: true, strength: 50, reduce: false };
  let dark = false;
  let accentRgb = [10, 132, 255];
  let palette = [];
  let parts = [];
  let raf = 0;
  let W = 0;
  let H = 0;
  let t = 0;
  const gShift = { x: 0, y: 0 }; // global motion drift for ribbon-style renderers

  addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  document.addEventListener("pointerleave", () => { mouse.x = -1e4; mouse.y = -1e4; });

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth;
    H = innerHeight;
    cv.width = Math.max(1, W * dpr);
    cv.height = Math.max(1, H * dpr);
    cv.style.width = `${W}px`;
    cv.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (cfg) build();
  }
  addEventListener("resize", resize);

  const speedF = () => (0.15 + (cfg.speed / 100) * 1.3) * (reduced ? 0.3 : 1);
  const sizeF = () => 0.5 + (cfg.size / 100) * 1.5;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const pick = () => palette[(Math.random() * palette.length) | 0];
  const neutral = () => (dark ? [195, 202, 228] : [118, 128, 162]);

  function clear() { ctx.clearRect(0, 0, W, H); }

  function glowDot(x, y, r, c, alpha) {
    ctx.fillStyle = rgba(c, alpha * 0.16);
    ctx.beginPath();
    ctx.arc(x, y, r * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(c, alpha);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function softBlob(x, y, r, c, alpha) {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, rgba(c, alpha));
    grad.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function repel(px, py, range, strength) {
    const dx = px - mouse.x, dy = py - mouse.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < range * range && d2 > 0.01) {
      const d = Math.sqrt(d2);
      const f = ((range - d) / range) * strength;
      return [(dx / d) * f, (dy / d) * f];
    }
    return [0, 0];
  }

  function densityCount(scale, cap) {
    const base = (W * H) / 15000;
    const weakScale = WEAK ? 0.6 : 1;
    return Math.max(6, Math.min(Math.round(base * (0.2 + (cfg.density / 100) * 1.5) * scale * weakScale), cap));
  }

  /* ---------- builders ---------- */
  const builders = {
    aurora() {
      const n = Math.round(4 + (cfg.density / 100) * 6);
      return Array.from({ length: n }, (_, i) => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * speedF() * 0.5,
        vy: (Math.random() - 0.5) * speedF() * 0.5,
        r: (170 + Math.random() * 240) * sizeF(),
        color: palette[i % palette.length],
        ph: Math.random() * Math.PI * 2,
        phs: (0.004 + Math.random() * 0.008) * (0.4 + cfg.speed / 80)
      }));
    },

    lattice() {
      const gap = Math.round(88 - (cfg.density / 100) * 40) + (WEAK ? 14 : 0);
      const dots = [];
      for (let y = gap / 2; y < H + gap; y += gap) {
        for (let x = gap / 2; x < W + gap; x += gap) {
          dots.push({ bx: x, by: y, ox: 0, oy: 0 });
        }
      }
      return dots;
    },

    flow() {
      return Array.from({ length: densityCount(1, 260) }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        color: pick(),
        r: (0.9 + Math.random() * 1.4) * sizeF()
      }));
    },

    constellation() {
      return Array.from({ length: densityCount(1, 150) }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * speedF(),
        vy: (Math.random() - 0.5) * speedF(),
        r: (1.4 + Math.random() * 1.8) * sizeF(),
        alpha: 0.55 + Math.random() * 0.35,
        color: pick()
      }));
    },

    comets() {
      const n = Math.round(7 + (cfg.density / 100) * 18);
      return Array.from({ length: n }, () => {
        const ang = 0.45 + (Math.random() - 0.5) * 0.5;
        const v = (1.2 + Math.random() * 2.4) * speedF() * 1.8;
        return {
          x: Math.random() * W,
          y: Math.random() * H,
          vx: Math.cos(ang) * v,
          vy: Math.sin(ang) * v,
          r: (0.9 + Math.random() * 1.7) * sizeF(),
          color: Math.random() < 0.35 ? (dark ? [235, 240, 255] : accentRgb) : pick()
        };
      });
    },

    ribbons() {
      const n = Math.round(3 + (cfg.density / 100) * 4);
      return Array.from({ length: n }, (_, i) => ({
        yf: 0.14 + (i + 0.5) / n * 0.72,
        amp: 26 + Math.random() * 46,
        amp2: 10 + Math.random() * 18,
        k: 0.004 + Math.random() * 0.004,
        k2: 0.009 + Math.random() * 0.006,
        ph: Math.random() * Math.PI * 2,
        s: (0.5 + Math.random() * 0.7) * (0.3 + cfg.speed / 70),
        s2: (0.3 + Math.random() * 0.5) * (0.3 + cfg.speed / 70),
        w: (1.6 + Math.random() * 2.4) * sizeF(),
        color: palette[i % palette.length]
      }));
    },

    starfield() {
      return Array.from({ length: densityCount(1.2, 320) }, () => {
        const z = 0.15 + Math.random() * 0.85;
        return {
          x: Math.random() * W,
          y: Math.random() * H,
          z,
          r: (0.5 + z * 1.9) * sizeF(),
          tw: Math.random() * Math.PI * 2,
          twSpeed: 0.01 + Math.random() * 0.04,
          color: Math.random() < 0.22 ? pick() : neutral()
        };
      });
    },

    fireflies() {
      return Array.from({ length: densityCount(0.6, 130) }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * speedF() * 0.6,
        vy: (Math.random() - 0.5) * speedF() * 0.6,
        r: (1.8 + Math.random() * 3) * sizeF(),
        tw: Math.random() * Math.PI * 2,
        twSpeed: 0.015 + Math.random() * 0.04,
        color: pick()
      }));
    }
  };

  function build() {
    clear();
    parts = !cfg || cfg.style === "off" || !builders[cfg.style] ? [] : builders[cfg.style]();
    // Motion-physics state: each particle keeps a displacement offset (mx/my)
    // with its own velocity, sprung back toward its home layout position.
    for (const p of parts) {
      p.mx = 0; p.my = 0; p.mvx = 0; p.mvy = 0;
      if (p.depth === undefined) p.depth = p.z !== undefined ? p.z : 0.35 + Math.random() * 0.65;
    }
  }

  /* ---------- motion physics (tilt / inertia / shockwaves) ---------- */
  // Styles whose particles wander by design get forces applied to their own
  // velocity; anchored styles get the sprung offset layer instead.
  const WANDER_STYLES = new Set(["constellation", "fireflies"]);
  // Wave grid answers a tap with a swell that rolls up from the bottom edge
  // instead of a point-radial burst.
  let waves = [];

  function motionStep() {
    if (!mcfg.enabled || cfg.style === "off") return;
    const m = MotionInput.sample();
    const imps = MotionInput.drainImpulses();
    const calm = reduced || mcfg.reduce;
    const k = (mcfg.strength / 50) * (calm ? 0.15 : 1);
    // Steady-state displacement ≈ tiltF / RETURN, so 0.5 → ~33 px at full tilt.
    const tiltF = 0.5 * k;        // steady drift while tilted
    const inertF = 0.55 * k;      // lag opposite to laptop acceleration
    const RETURN = 0.015;         // spring back to home
    const DAMP = 0.9;             // settle naturally
    const MAXD = 110;             // hard clamp so nothing flies away
    const IMP_R = 260;            // shockwave radius
    const impF = 9 * k;

    // Global drift for renderers without discrete particles (ribbons).
    gShift.x += ((m.tiltX * 46 - m.ax * 34) * k - gShift.x) * 0.05;
    gShift.y += ((m.tiltY * 46 - m.ay * 34) * k - gShift.y) * 0.05;

    if (cfg.style === "ribbons") return;

    // Wave grid: a tap launches a wavefront from the bottom edge that travels
    // upward, lifting each row of dots as it passes and letting them settle.
    const isLattice = cfg.style === "lattice";
    if (isLattice) {
      for (const im of imps) waves.push({ p: 0, strength: im.strength });
      if (waves.length > 3) waves.splice(0, waves.length - 3);
      const adv = 0.017 * (calm ? 0.5 : 1);
      for (const w of waves) w.p += adv;
      waves = waves.filter((w) => w.p < 1.2);
    } else if (waves.length) {
      waves = [];
    }
    const WAVE_BAND = 165;   // thickness of the moving crest
    const WAVE_TRAVEL = 180; // extra distance so the crest exits off-screen

    const wander = WANDER_STYLES.has(cfg.style);
    const fxBase = m.tiltX * tiltF - m.ax * inertF;
    const fyBase = m.tiltY * tiltF - m.ay * inertF;

    for (const p of parts) {
      const px = (p.x !== undefined ? p.x : p.bx + p.ox) + p.mx;
      const py = (p.y !== undefined ? p.y : p.by + p.oy) + p.my;
      let fx = fxBase * p.depth;
      let fy = fyBase * p.depth;
      if (isLattice) {
        for (const w of waves) {
          const front = H - w.p * (H + WAVE_TRAVEL);
          const dy = py - front;
          if (dy > -WAVE_BAND * 0.4 && dy < WAVE_BAND) {
            const falloff = 1 - Math.abs(dy) / WAVE_BAND;
            const decay = 1 - w.p * 0.5;
            fy -= w.strength * 7 * k * falloff * falloff * decay * p.depth;
          }
        }
      } else {
        for (const im of imps) {
          const dx = px - im.x;
          const dy = py - im.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < IMP_R) {
            const f = im.strength * impF * (1 - d / IMP_R);
            fx += (dx / d) * f;
            fy += (dy / d) * f;
          }
        }
      }
      if (wander) {
        p.vx = Math.max(-3.5, Math.min(3.5, p.vx + fx));
        p.vy = Math.max(-3.5, Math.min(3.5, p.vy + fy));
      } else {
        p.mvx = (p.mvx + fx - p.mx * RETURN) * DAMP;
        p.mvy = (p.mvy + fy - p.my * RETURN) * DAMP;
        p.mx += p.mvx;
        p.my += p.mvy;
        const dd = Math.hypot(p.mx, p.my);
        if (dd > MAXD) { p.mx *= MAXD / dd; p.my *= MAXD / dd; }
      }
    }
  }

  /* ---------- renderers ---------- */
  function driftWrap(p, pad = 50) {
    if (p.x < -pad) p.x = W + pad; if (p.x > W + pad) p.x = -pad;
    if (p.y < -pad) p.y = H + pad; if (p.y > H + pad) p.y = -pad;
  }

  const renderers = {
    aurora() {
      clear();
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
      for (const p of parts) {
        p.ph += p.phs;
        if (cfg.interact && ms.x > -1e3) {
          p.vx += (ms.x - p.x) * 0.000012;
          p.vy += (ms.y - p.y) * 0.000012;
        }
        p.x += p.vx + Math.cos(p.ph) * 0.3;
        p.y += p.vy + Math.sin(p.ph * 0.8) * 0.3;
        driftWrap(p, p.r);
        const alpha = (dark ? 0.2 : 0.16) * (0.7 + 0.3 * Math.sin(p.ph * 1.4));
        softBlob(p.x + p.mx, p.y + p.my, p.r * (0.85 + 0.15 * Math.sin(p.ph)), p.color, alpha);
      }
      ctx.globalCompositeOperation = "source-over";
    },

    lattice() {
      clear();
      const base = neutral();
      const amp = 6 + sizeF() * 4;
      for (const p of parts) {
        const w1 = Math.sin(p.bx * 0.016 + p.by * 0.011 + t);
        const w2 = Math.cos(p.bx * 0.011 - p.by * 0.016 + t * 0.8);
        let tx = w1 * amp;
        let ty = w2 * amp;
        let near = 0;
        if (cfg.interact) {
          const dx = p.bx - ms.x, dy = p.by - ms.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 170 && d > 0.01) {
            near = 1 - d / 170;
            const f = near * near * 42;
            tx += (dx / d) * f;
            ty += (dy / d) * f;
          }
        }
        p.ox += (tx - p.ox) * 0.12;
        p.oy += (ty - p.oy) * 0.12;
        const pulse = (w1 + 1) / 2;
        const r = (1.3 + pulse * 1.3) * sizeF() * (1 + near * 1.3);
        const alpha = ((dark ? 0.5 : 0.42) * (0.45 + 0.55 * pulse) + near * 0.45);
        const color = near > 0.05
          ? [
              base[0] + (accentRgb[0] - base[0]) * near,
              base[1] + (accentRgb[1] - base[1]) * near,
              base[2] + (accentRgb[2] - base[2]) * near
            ]
          : base;
        ctx.fillStyle = rgba(color, Math.min(1, alpha));
        ctx.beginPath();
        ctx.arc(p.bx + p.ox + p.mx, p.by + p.oy + p.my, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },

    flow() {
      // Fade instead of clear so paths leave silky generative trails.
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.045)";
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
      const v = speedF() * 1.5;
      for (const p of parts) {
        const ang =
          (Math.sin(p.x * 0.0028 + t * 0.32) + Math.cos(p.y * 0.0035 - t * 0.26)) * Math.PI;
        let vx = Math.cos(ang) * v;
        let vy = Math.sin(ang) * v;
        if (cfg.interact) {
          const [fx, fy] = repel(p.x, p.y, 140, 2.4);
          vx += fx; vy += fy;
        }
        p.x += vx; p.y += vy;
        if (p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > H + 10) {
          p.x = Math.random() * W;
          p.y = Math.random() * H;
        }
        ctx.fillStyle = rgba(p.color, dark ? 0.5 : 0.4);
        ctx.beginPath();
        ctx.arc(p.x + p.mx, p.y + p.my, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    },

    constellation() {
      clear();
      for (const p of parts) {
        if (cfg.interact) {
          const [fx, fy] = repel(p.x, p.y, 150, 0.9);
          p.vx += fx * 0.08; p.vy += fy * 0.08;
          p.vx = Math.max(-1.8, Math.min(1.8, p.vx));
          p.vy = Math.max(-1.8, Math.min(1.8, p.vy));
        }
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.995; p.vy *= 0.995;
        driftWrap(p);
        glowDot(p.x, p.y, p.r, p.color, Math.min(1, p.alpha * (dark ? 1.3 : 1)));
      }
      const linkDist = 110 + (cfg.density / 100) * 40;
      const lineAlpha = dark ? 0.4 : 0.3;
      ctx.lineWidth = 1;
      for (let i = 0; i < parts.length; i++) {
        const a = parts[i];
        for (let j = i + 1; j < parts.length; j++) {
          const b = parts[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < linkDist * linkDist) {
            const k = 1 - Math.sqrt(d2) / linkDist;
            ctx.strokeStyle = rgba(a.color, k * lineAlpha);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        if (cfg.interact) {
          const dx = a.x - mouse.x, dy = a.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 170 * 170) {
            const k = 1 - Math.sqrt(d2) / 170;
            ctx.strokeStyle = rgba(a.color, k * 0.45);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
          }
        }
      }
    },

    comets() {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.085)";
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
      for (const p of parts) {
        if (cfg.interact) {
          const [fx, fy] = repel(p.x, p.y, 130, 1.4);
          p.x += fx; p.y += fy;
        }
        p.x += p.vx; p.y += p.vy;
        if (p.x > W + 30 || p.y > H + 30) {
          if (Math.random() < 0.5) { p.x = Math.random() * W * 0.8; p.y = -20; }
          else { p.x = -20; p.y = Math.random() * H * 0.7; }
        }
        glowDot(p.x + p.mx, p.y + p.my, p.r, p.color, dark ? 0.9 : 0.75);
      }
      ctx.globalCompositeOperation = "source-over";
    },

    ribbons() {
      clear();
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
      ctx.lineCap = "round";
      for (const rb of parts) {
        const baseY = rb.yf * H;
        ctx.strokeStyle = rgba(rb.color, dark ? 0.34 : 0.26);
        ctx.lineWidth = rb.w;
        ctx.beginPath();
        for (let x = -20; x <= W + 20; x += 12) {
          let y = baseY + gShift.y * (0.4 + rb.yf * 0.8)
            + Math.sin((x + gShift.x * 2) * rb.k + t * rb.s + rb.ph) * rb.amp
            + Math.sin((x + gShift.x * 2) * rb.k2 - t * rb.s2) * rb.amp2;
          if (cfg.interact && ms.x > -1e3) {
            const dx = x - ms.x;
            const dyc = y - ms.y;
            const fx = Math.max(0, 1 - Math.abs(dx) / 220);
            const fy = Math.max(0, 1 - Math.abs(dyc) / 150);
            y += Math.sign(dyc || 1) * fx * fx * fy * 46;
          }
          if (x === -20) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    },

    starfield() {
      clear();
      const cx = W / 2, cy = H / 2;
      const px = ms.x > -1e3 ? (ms.x - cx) : 0;
      const py = ms.y > -1e3 ? (ms.y - cy) : 0;
      const drift = speedF() * 0.25;
      for (const p of parts) {
        p.tw += p.twSpeed;
        p.x += drift * p.z;
        if (p.x > W + 10) p.x = -10;
        const offX = (cfg.interact ? -px * p.z * 0.028 : 0) + p.mx;
        const offY = (cfg.interact ? -py * p.z * 0.028 : 0) + p.my;
        const alpha = (0.25 + p.z * 0.55) * (0.7 + 0.3 * Math.sin(p.tw)) * (dark ? 1.15 : 1);
        if (p.z > 0.75) glowDot(p.x + offX, p.y + offY, p.r, p.color, Math.min(1, alpha));
        else {
          ctx.fillStyle = rgba(p.color, Math.min(1, alpha));
          ctx.beginPath();
          ctx.arc(p.x + offX, p.y + offY, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },

    fireflies() {
      clear();
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
      for (const p of parts) {
        p.tw += p.twSpeed;
        if (cfg.interact) {
          const [fx, fy] = repel(p.x, p.y, 150, 0.9);
          p.vx += fx * 0.08; p.vy += fy * 0.08;
        }
        p.x += p.vx + Math.sin(p.tw * 0.7) * 0.2;
        p.y += p.vy + Math.cos(p.tw * 0.5) * 0.2;
        p.vx *= 0.99; p.vy *= 0.99;
        driftWrap(p);
        const alpha = 0.12 + (Math.sin(p.tw) * 0.5 + 0.5) * (dark ? 0.8 : 0.65);
        glowDot(p.x, p.y, p.r, p.color, alpha);
      }
      ctx.globalCompositeOperation = "source-over";
    }
  };

  function loop() {
    t += 0.02 * (0.3 + (cfg.speed / 100) * 1.6) * (reduced ? 0.35 : 1);
    ms.x += ((mouse.x < -1e3 ? ms.x : mouse.x) - ms.x) * 0.12;
    ms.y += ((mouse.y < -1e3 ? ms.y : mouse.y) - ms.y) * 0.12;
    if (mouse.x < -1e3 && ms.x < -900) { ms.x = mouse.x; ms.y = mouse.y; }
    motionStep();
    renderers[cfg.style]();
    raf = requestAnimationFrame(loop);
  }

  function start() {
    cancelAnimationFrame(raf);
    if (!cfg || cfg.style === "off" || !renderers[cfg.style]) { clear(); return; }
    if (mouse.x > -1e3) { ms.x = mouse.x; ms.y = mouse.y; }
    loop();
  }

  // Pause when the tab is hidden; resume (and re-fit) when it returns.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else {
      resize();
      start();
    }
  });

  function configure(pcfg, accent, isDark, motionCfg) {
    cfg = pcfg;
    if (motionCfg) mcfg = motionCfg;
    dark = isDark;
    accentRgb = hexRgb(accent);
    palette = [
      accentRgb,
      accentRgb,
      shiftHue(accent, 45),
      shiftHue(accent, -45),
      shiftHue(accent, 120)
    ];
    build();
    start();
  }

  resize();
  return { configure };
})();

/* ============================================================
   Settings
   ============================================================ */
const ACCENTS = [
  ["Blue", "#0a84ff"],
  ["Coral", "#ff6b63"],
  ["Violet", "#8b72f6"],
  ["Teal", "#0fb5ae"],
  ["Green", "#34c759"],
  ["Amber", "#ff9f0a"],
  ["Pink", "#ff375f"],
  ["Graphite", "#8e8e93"]
];

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
darkQuery.addEventListener("change", () => {
  if (state.settings.theme === "auto") applySettings();
});

function applySettings() {
  const s = state.settings;
  const root = document.documentElement;
  const dark = s.theme === "dark" || (s.theme === "auto" && darkQuery.matches);

  root.dataset.theme = dark ? "dark" : "light";
  const [r, g, b] = hexRgb(s.accent);
  root.style.setProperty("--accent", s.accent);
  root.style.setProperty("--accent-rgb", `${r},${g},${b}`);
  root.style.setProperty("--card-alpha", s.cardAlpha / 100);
  root.style.setProperty("--glass-blur", `${s.blur}px`);
  $('meta[name="theme-color"]').content = dark ? "#0e1015" : "#f4f5f9";

  document.body.classList.toggle("no-ambient", !s.ambient);
  $("#hero").classList.toggle("no-greeting", !s.showGreeting);
  $("#hero").classList.toggle("no-search", !s.showSearch);

  MotionInput.configure({
    enabled: s.motion.enabled,
    sensitivity: s.motion.sensitivity,
    tap: s.motion.tap,
    ws: s.motion.ws
  });
  particles.configure(s.particles, s.accent, dark, {
    enabled: s.motion.enabled,
    strength: s.motion.strength,
    reduce: s.motion.reduce
  });
  syncSettingsUI();
}

function bindRange(input, output, get, set, fmt) {
  const draw = () => {
    input.value = get();
    const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty("--fill", `${pct}%`);
    output.textContent = fmt(input.value);
  };
  input.addEventListener("input", () => {
    set(Number(input.value));
    saveSettings();
    applySettings();
  });
  input._draw = draw;
  draw();
}

function syncSettingsUI() {
  const s = state.settings;
  $$("#theme-seg button").forEach((b) => b.classList.toggle("is-active", b.dataset.themeOpt === s.theme));
  $$(".swatch").forEach((b) => b.classList.toggle("is-active", b.dataset.accent === s.accent));
  $$("#particle-style button").forEach((b) => b.classList.toggle("is-active", b.dataset.pstyle === s.particles.style));
  $("#set-ambient").checked = s.ambient;
  $("#set-greeting").checked = s.showGreeting;
  $("#set-search").checked = s.showSearch;
  $("#set-interact").checked = s.particles.interact;
  $("#set-motion").checked = s.motion.enabled;
  $("#set-mreduce").checked = s.motion.reduce;
  ["#set-alpha", "#set-blur", "#set-density", "#set-speed", "#set-size",
   "#set-msens", "#set-mtap", "#set-mstr"].forEach((sel) => {
    const el = $(sel);
    if (el._draw) el._draw();
  });
}

function initSettingsUI() {
  const s = state.settings;

  const swatches = $("#swatches");
  for (const [name, hex] of ACCENTS) {
    const b = h(`<button class="swatch" title="${name}" data-accent="${hex}" style="background:${hex};color:${hex}"></button>`);
    b.addEventListener("click", () => {
      s.accent = hex;
      saveSettings();
      applySettings();
    });
    swatches.append(b);
  }

  $$("#theme-seg button").forEach((b) =>
    b.addEventListener("click", () => {
      s.theme = b.dataset.themeOpt;
      saveSettings();
      applySettings();
    })
  );

  $$("#particle-style button").forEach((b) =>
    b.addEventListener("click", () => {
      s.particles.style = b.dataset.pstyle;
      saveSettings();
      applySettings();
    })
  );

  bindRange($("#set-alpha"), $("#out-alpha"), () => s.cardAlpha, (v) => (s.cardAlpha = v), (v) => `${v}%`);
  bindRange($("#set-blur"), $("#out-blur"), () => s.blur, (v) => (s.blur = v), (v) => `${v}px`);
  bindRange($("#set-density"), $("#out-density"), () => s.particles.density, (v) => (s.particles.density = v), (v) => `${v}%`);
  bindRange($("#set-speed"), $("#out-speed"), () => s.particles.speed, (v) => (s.particles.speed = v), (v) => `${v}%`);
  bindRange($("#set-size"), $("#out-size"), () => s.particles.size, (v) => (s.particles.size = v), (v) => `${v}%`);

  const bindToggle = (sel, get, set) => {
    $(sel).addEventListener("change", (e) => {
      set(e.target.checked);
      saveSettings();
      applySettings();
    });
  };
  bindToggle("#set-ambient", () => s.ambient, (v) => (s.ambient = v));
  bindToggle("#set-greeting", () => s.showGreeting, (v) => (s.showGreeting = v));
  bindToggle("#set-search", () => s.showSearch, (v) => (s.showSearch = v));
  bindToggle("#set-interact", () => s.particles.interact, (v) => (s.particles.interact = v));

  // Motion effects
  bindToggle("#set-motion", () => s.motion.enabled, (v) => (s.motion.enabled = v));
  bindToggle("#set-mreduce", () => s.motion.reduce, (v) => (s.motion.reduce = v));
  bindRange($("#set-msens"), $("#out-msens"), () => s.motion.sensitivity, (v) => (s.motion.sensitivity = v), (v) => `${v}%`);
  bindRange($("#set-mtap"), $("#out-mtap"), () => s.motion.tap, (v) => (s.motion.tap = v), (v) => `${v}%`);
  bindRange($("#set-mstr"), $("#out-mstr"), () => s.motion.strength, (v) => (s.motion.strength = v), (v) => `${v}%`);
  const mws = $("#set-mws");
  mws.value = s.motion.ws || "";
  mws.addEventListener("change", () => {
    s.motion.ws = mws.value.trim();
    saveSettings();
    applySettings();
  });
  const SOURCE_LABEL = {
    local: "Input: local sensor bridge (WebSocket)",
    browser: "Input: browser motion sensors",
    mouse: "Input: mouse simulation",
    unavailable: "Input: unavailable — move the mouse to activate simulation"
  };
  MotionInput.onSource((src) => {
    $("#motion-status").textContent = SOURCE_LABEL[src] || src;
  });

  // Google sync
  const cid = $("#g-client-id");
  const gBtn = $("#g-connect");
  const gStatus = $("#g-status");
  cid.value = s.googleClientId || "";
  cid.addEventListener("change", () => {
    s.googleClientId = cid.value.trim();
    saveSettings();
  });
  const updateGoogleUI = () => {
    const on = GoogleSync.connected();
    gBtn.textContent = on ? "Disconnect Google" : "Connect Google";
    gStatus.textContent = on
      ? "Connected — the calendar and tasks widgets are syncing."
      : GoogleSync.available
        ? ""
        : "Load BrowserSlop as an extension (edge://extensions) to enable sign-in.";
  };
  gBtn.addEventListener("click", async () => {
    if (GoogleSync.connected()) {
      await GoogleSync.signOut();
      updateGoogleUI();
      renderGrid();
      return;
    }
    const clientId = (s.googleClientId || "").trim();
    if (!clientId) {
      gStatus.textContent = "Paste your OAuth client ID above first — the README covers the one-time setup.";
      return;
    }
    gStatus.textContent = "Opening Google sign-in…";
    try {
      await GoogleSync.signIn(clientId);
      updateGoogleUI();
      renderGrid();
    } catch (err) {
      gStatus.textContent = `Sign-in failed: ${err.message}`;
    }
  });
  updateGoogleUI();

  // X timeline sync
  const xCid = $("#x-client-id");
  const xSecret = $("#x-client-secret");
  const xAccessToken = $("#x-access-token");
  const xRefreshToken = $("#x-refresh-token");
  const xBtn = $("#x-connect");
  const xStatus = $("#x-status");
  xCid.value = s.xClientId || "";
  xSecret.value = s.xClientSecret || "";
  xCid.addEventListener("change", () => {
    s.xClientId = xCid.value.trim();
    saveSettings();
  });
  xSecret.addEventListener("change", () => {
    s.xClientSecret = xSecret.value.trim();
    saveSettings();
  });
  const updateXUI = () => {
    const on = XSync.connected();
    xBtn.textContent = on ? "Disconnect X" : "Import X tokens";
    xStatus.textContent = on
      ? "Connected — the X widget is showing your home timeline."
      : XSync.available
        ? ""
        : "Load BrowserSlop as an extension (edge://extensions) to enable sign-in.";
  };
  xBtn.addEventListener("click", async () => {
    if (XSync.connected()) {
      XSync.signOut();
      updateXUI();
      renderGrid();
      return;
    }
    const clientId = (s.xClientId || "").trim();
    if (!clientId) {
      xStatus.textContent = "Paste your X OAuth client ID above first — the README covers the one-time setup.";
      return;
    }
    const clientSecret = (s.xClientSecret || "").trim();
    if (!clientSecret) {
      xStatus.textContent = "Paste your X OAuth 2.0 Client Secret above first.";
      return;
    }
    const accessToken = xAccessToken.value.trim();
    const refreshToken = xRefreshToken.value.trim();
    if (!accessToken || !refreshToken) {
      xStatus.textContent = "Paste the console-generated X access and refresh tokens above first.";
      return;
    }
    xStatus.textContent = "Validating the console-issued token…";
    try {
      await XSync.importConsoleTokens(clientId, clientSecret, accessToken, refreshToken);
      xAccessToken.value = "";
      xRefreshToken.value = "";
      updateXUI();
      renderGrid();
    } catch (err) {
      xStatus.textContent = `Sign-in failed: ${err.message}`;
    }
  });
  updateXUI();

  $("#reset-all").addEventListener("click", () => {
    if (!confirm("Reset BrowserSlop to defaults? This clears layout, settings, and widget data.")) return;
    Object.values(LS).forEach((k) => localStorage.removeItem(k));
    localStorage.removeItem("browserslop.tasks");
    localStorage.removeItem("browserslop.v1.gauth");
    localStorage.removeItem("browserslop.v1.xauth");
    location.reload();
  });

  const panel = $("#settings-panel");
  const scrim = $("#scrim");
  const open = () => {
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    scrim.hidden = false;
    requestAnimationFrame(() => scrim.classList.add("show"));
  };
  const close = () => {
    if (panel.contains(document.activeElement)) document.activeElement.blur();
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    scrim.classList.remove("show");
    setTimeout(() => (scrim.hidden = true), 260);
  };
  $("#settings-toggle").addEventListener("click", () =>
    panel.classList.contains("open") ? close() : open()
  );
  $("#settings-close").addEventListener("click", close);
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
      if (document.body.classList.contains("edit-mode")) setEditMode(false);
    }
  });
}

/* ============================================================
   Widget registry
   ============================================================ */
const tickers = { minute: new Set(), second: new Set() };
let cleanups = [];

function onTick(kind, fn) {
  tickers[kind].add(fn);
  cleanups.push(() => tickers[kind].delete(fn));
  fn();
}

const fmtTime = (d, tz) =>
  new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);

const WIDGETS = {
  today: {
    name: "Today",
    icon: "📅",
    desc: "Big date with your day at a glance",
    w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 1,
    render(root) {
      root.innerHTML = `
        <div class="widget-top"><span>Today</span></div>
        <div class="big-date"><span></span><span></span></div>
        <p class="muted">A clear day ahead.</p>`;
      onTick("minute", () => {
        const now = new Date();
        root.querySelector(".big-date span:first-child").textContent = now.getDate();
        root.querySelector(".big-date span:last-child").textContent =
          new Intl.DateTimeFormat(undefined, { month: "short" }).format(now).toUpperCase();
      });
    }
  },

  clock: {
    name: "Clock",
    icon: "🕐",
    desc: "Large local time with the date",
    w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 1,
    render(root) {
      root.innerHTML = `
        <div class="widget-top"><span>Clock</span></div>
        <div class="clock-time"><strong></strong><span></span></div>
        <p class="muted"></p>`;
      onTick("second", () => {
        const now = new Date();
        const parts = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).formatToParts(now);
        const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
        root.querySelector("strong").textContent = `${get("hour")}:${get("minute")}`;
        const period = get("dayPeriod");
        root.querySelector(".clock-time span").textContent = `:${get("second")}${period ? " " + period : ""}`;
        root.querySelector(".muted").textContent = new Intl.DateTimeFormat(undefined, {
          weekday: "long", month: "long", day: "numeric", year: "numeric"
        }).format(now);
      });
    }
  },

  weather: {
    name: "Weather",
    icon: "☀️",
    desc: "Sky-blue conditions card (sample data)",
    w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 1,
    render(root) {
      root.innerHTML = `
        <div class="widget-top"><span>New York</span><span class="weather-condition">Clear</span></div>
        <div class="weather-main"><span class="sun" aria-hidden="true">&#9728;</span><strong>76&deg;</strong></div>
        <div class="forecast">
          <span>Now <b>76&deg;</b></span>
          <span>2 PM <b>79&deg;</b></span>
          <span>5 PM <b>77&deg;</b></span>
        </div>`;
    }
  },

  focus: {
    name: "Focus timer",
    icon: "⏱️",
    desc: "Pomodoro ring with breaks and custom lengths",
    w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 2,
    render(root) {
      root.classList.add("w-focus", "w-pomo");
      const data = widgetData("focus", {
        focusMin: 25, shortMin: 5, longMin: 15,
        mode: "focus", sessions: 0,
        running: false, endsAt: 0, remaining: 25 * 60
      });

      const MODE_LABEL = { focus: "Focus", short: "Break", long: "Long break" };
      const durFor = (m) =>
        (m === "focus" ? data.focusMin : m === "short" ? data.shortMin : data.longMin) * 60;

      // Recover a timer that finished while no tab was open.
      if (data.running && data.endsAt <= Date.now()) finishPhase(false);

      const CIRC = 2 * Math.PI * 44;
      root.innerHTML = `
        <div class="widget-top">
          <span>Focus</span>
          <button class="ghost-btn pomo-gear" type="button" aria-label="Timer settings">Lengths</button>
        </div>
        <div class="pomo-body">
          <div class="pomo-ring">
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <circle class="ring-track" cx="50" cy="50" r="44" />
              <circle class="ring-fill" cx="50" cy="50" r="44"
                stroke-dasharray="${CIRC}" stroke-dashoffset="0" />
            </svg>
            <div class="pomo-center">
              <strong class="pomo-time">25:00</strong>
              <small class="pomo-mode">Focus</small>
            </div>
          </div>
          <div class="pomo-dots" title="Focus sessions until a long break">
            ${"<span></span>".repeat(4)}
          </div>
          <div class="pomo-controls">
            <button class="ghost-btn pomo-reset" type="button" aria-label="Reset timer">↺</button>
            <button class="primary-button pomo-main" type="button">Start</button>
            <button class="ghost-btn pomo-skip" type="button" aria-label="Skip to next phase">⏭</button>
          </div>
        </div>
        <div class="pomo-settings" hidden>
          <p class="section-kicker" style="margin-bottom:4px">Timer lengths</p>
          ${[
            ["focusMin", "Focus", 5],
            ["shortMin", "Break", 1],
            ["longMin", "Long break", 5]
          ].map(([key, label, st]) => `
            <div class="pomo-set-row" data-key="${key}" data-step="${st}">
              <span>${label}</span>
              <div class="stepper">
                <button type="button" data-d="-1" aria-label="Decrease ${label}">−</button>
                <b></b>
                <button type="button" data-d="1" aria-label="Increase ${label}">+</button>
              </div>
            </div>`).join("")}
          <div class="pomo-set-actions">
            <button class="ghost-btn pomo-cycle-reset" type="button">Reset cycle</button>
            <button class="primary-button pomo-set-done" type="button">Done</button>
          </div>
        </div>`;

      const timeEl = root.querySelector(".pomo-time");
      const modeEl = root.querySelector(".pomo-mode");
      const fillEl = root.querySelector(".ring-fill");
      const mainBtn = root.querySelector(".pomo-main");
      const dots = [...root.querySelectorAll(".pomo-dots span")];
      const panel = root.querySelector(".pomo-settings");

      function remainingNow() {
        return data.running
          ? Math.max(0, Math.round((data.endsAt - Date.now()) / 1000))
          : Math.min(data.remaining, durFor(data.mode));
      }

      function finishPhase(autoStartBreak = true) {
        if (data.mode === "focus") {
          data.sessions += 1;
          data.mode = data.sessions % 4 === 0 ? "long" : "short";
          data.running = autoStartBreak;
          if (autoStartBreak) data.endsAt = Date.now() + durFor(data.mode) * 1000;
          else data.remaining = durFor(data.mode);
        } else {
          data.mode = "focus";
          data.running = false;
          data.remaining = durFor("focus");
        }
        saveData();
      }

      function chime() {
        try {
          const ac = new (window.AudioContext || window.webkitAudioContext)();
          const o = ac.createOscillator();
          const g = ac.createGain();
          o.connect(g);
          g.connect(ac.destination);
          o.type = "sine";
          o.frequency.setValueAtTime(880, ac.currentTime);
          o.frequency.exponentialRampToValueAtTime(660, ac.currentTime + 0.5);
          g.gain.setValueAtTime(0.0001, ac.currentTime);
          g.gain.exponentialRampToValueAtTime(0.12, ac.currentTime + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.7);
          o.start();
          o.stop(ac.currentTime + 0.75);
          o.onended = () => ac.close();
        } catch { /* audio may be blocked before the first user gesture */ }
      }

      function draw() {
        const total = durFor(data.mode);
        const rem = remainingNow();
        if (data.running && rem === 0) {
          finishPhase();
          chime();
          return draw();
        }
        timeEl.textContent =
          `${String(Math.floor(rem / 60)).padStart(2, "0")}:${String(rem % 60).padStart(2, "0")}`;
        modeEl.textContent = MODE_LABEL[data.mode];
        root.classList.remove("mode-focus", "mode-short", "mode-long");
        root.classList.add(`mode-${data.mode}`);
        fillEl.style.strokeDashoffset = CIRC * (1 - (total ? rem / total : 0));
        mainBtn.textContent = data.running
          ? "Pause"
          : rem === total
            ? (data.mode === "focus" ? "Start focus" : "Start break")
            : "Resume";
        const inCycle = data.sessions % 4 || (data.mode === "long" ? 4 : 0);
        dots.forEach((d, i) => d.classList.toggle("on", i < inCycle));
      }

      mainBtn.addEventListener("click", () => {
        if (data.running) {
          data.remaining = remainingNow();
          data.running = false;
        } else {
          data.running = true;
          data.endsAt = Date.now() + remainingNow() * 1000;
        }
        saveData();
        draw();
      });

      root.querySelector(".pomo-reset").addEventListener("click", () => {
        data.running = false;
        data.remaining = durFor(data.mode);
        saveData();
        draw();
      });

      root.querySelector(".pomo-skip").addEventListener("click", () => {
        finishPhase();
        draw();
      });

      const drawSteppers = () => {
        for (const row of panel.querySelectorAll(".pomo-set-row")) {
          row.querySelector("b").textContent = `${data[row.dataset.key]}m`;
        }
      };
      root.querySelector(".pomo-gear").addEventListener("click", () => {
        drawSteppers();
        panel.hidden = !panel.hidden;
      });
      root.querySelector(".pomo-set-done").addEventListener("click", () => { panel.hidden = true; });
      root.querySelector(".pomo-cycle-reset").addEventListener("click", () => {
        data.sessions = 0;
        data.mode = "focus";
        data.running = false;
        data.remaining = durFor("focus");
        saveData();
        panel.hidden = true;
        draw();
      });
      const LIMITS = { focusMin: [5, 120], shortMin: [1, 30], longMin: [5, 60] };
      panel.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-d]");
        if (!btn) return;
        const row = btn.closest(".pomo-set-row");
        const key = row.dataset.key;
        const [lo, hi] = LIMITS[key];
        data[key] = Math.max(lo, Math.min(hi, data[key] + Number(btn.dataset.d) * Number(row.dataset.step)));
        if (!data.running) data.remaining = Math.min(data.remaining, durFor(data.mode));
        saveData();
        drawSteppers();
        draw();
      });

      const interval = setInterval(() => { if (data.running) draw(); }, 500);
      cleanups.push(() => clearInterval(interval));
      draw();
    }
  },

  calendar: {
    name: "Daily calendar",
    icon: "🗓️",
    desc: "Day timeline — syncs with Google Calendar",
    w: 4, h: 2, minW: 2, minH: 2, maxW: 4, maxH: 3,
    render(root) {
      root.classList.add("w-calendar");
      const PX_PER_HOUR = 46;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let selected = new Date(today);
      const cache = new Map();
      let curStartH = 8;
      let curRangePx = 0;

      root.innerHTML = `
        <div class="panel-heading">
          <div>
            <h2 class="cal-title"></h2>
          </div>
          <div class="cal-actions">
            <span class="status-dot cal-src"></span>
            <button class="add-button cal-add"><span aria-hidden="true">+</span> Add event</button>
          </div>
        </div>
        <div class="week-strip" aria-label="This week"></div>
        <div class="allday-row" hidden></div>
        <div class="day-timeline scroll"><div class="tl-inner"></div></div>`;

      const inner = root.querySelector(".tl-inner");
      const tlEl = root.querySelector(".day-timeline");

      root.querySelector(".cal-add").addEventListener("click", () => {
        window.open("https://calendar.google.com/calendar/u/0/r/eventedit", "_blank");
      });

      const strip = root.querySelector(".week-strip");
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      const dayBtns = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + i);
        const b = h(`<button><span></span><b></b></button>`);
        b.querySelector("span").textContent =
          new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
        b.querySelector("b").textContent = date.getDate();
        b.classList.toggle("is-today", date.getTime() === today.getTime());
        b.addEventListener("click", () => { selected = new Date(date); draw(); });
        dayBtns.push([b, date]);
        strip.append(b);
      }

      function at(day, hh, mm) {
        const d = new Date(day);
        d.setHours(hh, mm, 0, 0);
        return d;
      }

      const SAMPLE = (day) => [
        { allDay: false, start: at(day, 9, 30), end: at(day, 10, 0), title: "Team sync", loc: "Studio room" },
        { allDay: false, start: at(day, 11, 15), end: at(day, 12, 30), title: "Deep work", loc: "BrowserSlop planning" },
        { allDay: false, start: at(day, 13, 0), end: at(day, 14, 0), title: "Design review", loc: "Figma" }
      ];

      async function getEvents(day) {
        if (!GoogleSync.connected()) {
          return day.getTime() === today.getTime() ? SAMPLE(day) : [];
        }
        const key = todayKey(day);
        if (cache.has(key)) return cache.get(key);
        const dayEnd = new Date(day);
        dayEnd.setDate(day.getDate() + 1);
        const items = await GoogleSync.events(day, dayEnd);
        const evs = items
          .filter((ev) => ev.status !== "cancelled")
          .map((ev) => {
            const allDay = !!(ev.start && ev.start.date);
            return {
              allDay,
              start: allDay ? new Date(day) : new Date(ev.start.dateTime),
              end: allDay ? new Date(day) : new Date(ev.end.dateTime),
              title: ev.summary || "(untitled)",
              loc: ev.location || ""
            };
          });
        cache.set(key, evs);
        return evs;
      }

      const hourMin = (d) => d.getHours() + d.getMinutes() / 60;

      function layout(events) {
        inner.innerHTML = "";
        const alldayRow = root.querySelector(".allday-row");
        const allday = events.filter((e) => e.allDay);
        const timed = events.filter((e) => !e.allDay).sort((a, b) => a.start - b.start);

        alldayRow.hidden = !allday.length;
        alldayRow.innerHTML = allday
          .map((e) => `<span class="allday-pill" title="${esc(e.title)}">${esc(e.title)}</span>`)
          .join("");

        let startH = 8, endH = 20;
        for (const e of timed) {
          startH = Math.min(startH, e.start.getHours());
          endH = Math.max(endH, e.end.getHours() + (e.end.getMinutes() > 0 ? 1 : 0));
        }
        const isToday = selected.getTime() === today.getTime();
        if (isToday) {
          const nh = new Date().getHours();
          startH = Math.min(startH, nh);
          endH = Math.max(endH, nh + 1);
        }
        startH = Math.max(0, startH);
        endH = Math.min(24, Math.max(endH, startH + 6));
        const range = endH - startH;
        curStartH = startH;
        curRangePx = range * PX_PER_HOUR;
        inner.style.height = `${curRangePx}px`;

        const fmtH = (hh) =>
          new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2000, 0, 1, hh % 24));
        const step = range > 14 ? 2 : 1;
        for (let hh = startH; hh <= endH; hh += step) {
          const line = h(`<div class="tl-hour"><i></i><span>${fmtH(hh)}</span></div>`);
          line.style.top = `${(hh - startH) * PX_PER_HOUR}px`;
          inner.append(line);
        }

        // Greedy lane assignment so overlapping events sit side by side.
        const laneEnds = [];
        for (const e of timed) {
          let lane = laneEnds.findIndex((tEnd) => tEnd <= e.start.getTime());
          if (lane === -1) {
            if (laneEnds.length < 3) { lane = laneEnds.length; laneEnds.push(0); }
            else lane = laneEnds.indexOf(Math.min(...laneEnds));
          }
          laneEnds[lane] = e.end.getTime();
          e.lane = lane;
        }
        const nLanes = Math.max(1, laneEnds.length);

        timed.forEach((e, i) => {
          const topPx = (hourMin(e.start) - startH) * PX_PER_HOUR;
          const hgt = Math.max(21, (hourMin(e.end) - hourMin(e.start)) * PX_PER_HOUR - 3);
          const el = h(`
            <div class="tl-event ev-c${i % 4}">
              <span class="ev-time">${esc(fmtTime(e.start))}</span>
              <b>${esc(e.title)}</b>
              ${e.loc ? `<small>${esc(e.loc)}</small>` : ""}
            </div>`);
          el.style.top = `${topPx}px`;
          el.style.height = `${hgt}px`;
          el.style.left = `calc(${(e.lane / nLanes) * 100}% + 2px)`;
          el.style.width = `calc(${100 / nLanes}% - 8px)`;
          el.title = `${e.title}${e.loc ? " — " + e.loc : ""}`;
          inner.append(el);
        });

        if (!timed.length && !allday.length) {
          inner.append(h(`<p class="tl-empty">No events — enjoy the open day.</p>`));
        }

        const target = isToday
          ? hourMin(new Date()) - 1
          : timed[0] ? hourMin(timed[0].start) - 0.5 : 8;
        tlEl.scrollTop = Math.max(0, (target - startH) * PX_PER_HOUR);
      }

      function drawNow() {
        const old = inner.querySelector(".tl-now");
        if (old) old.remove();
        if (selected.getTime() !== today.getTime() || !curRangePx) return;
        const pos = (hourMin(new Date()) - curStartH) * PX_PER_HOUR;
        if (pos < 0 || pos > curRangePx) return;
        const line = h(`<div class="tl-now" aria-label="Current time"></div>`);
        line.style.top = `${pos}px`;
        inner.append(line);
      }

      async function draw() {
        root.querySelector(".cal-title").textContent = new Intl.DateTimeFormat(undefined, {
          weekday: "long", month: "long", day: "numeric"
        }).format(selected);
        dayBtns.forEach(([b, d]) =>
          b.classList.toggle("is-selected", d.getTime() === selected.getTime())
        );
        const src = root.querySelector(".cal-src");
        src.classList.toggle("ok", GoogleSync.connected());
        src.title = GoogleSync.connected()
          ? "Synced with Google Calendar"
          : "Sample data — connect Google in Settings";
        try {
          layout(await getEvents(selected));
        } catch {
          layout([]);
          const m = inner.querySelector(".tl-empty");
          if (m) m.textContent = "Couldn't load events — reconnect Google in Settings.";
        }
        drawNow();
      }

      onTick("minute", drawNow);
      draw();
    }
  },

  tasks: {
    name: "Tasks",
    icon: "✅",
    desc: "To-do list — syncs with Google Tasks",
    w: 4, h: 2, minW: 2, minH: 1, maxW: 4, maxH: 3,
    render(root) {
      root.classList.add("w-tasks");
      root.innerHTML = `
        <div class="panel-heading">
          <div>
            <h2>To-Dos</h2>
          </div>
          <div class="cal-actions">
            <span class="status-dot task-src"></span>
            <div class="progress-copy"><strong class="task-count"></strong><span>complete</span></div>
          </div>
        </div>
        <div class="progress-track" aria-hidden="true"><span></span></div>
        <div class="task-list scroll"></div>
        <form class="task-add">
          <input class="mini-input" placeholder="Add a task…" aria-label="Add a task" />
          <button class="add-button" type="submit"><span aria-hidden="true">+</span></button>
        </form>`;

      const list = root.querySelector(".task-list");
      const countEl = root.querySelector(".task-count");
      const barEl = root.querySelector(".progress-track span");
      const srcEl = root.querySelector(".task-src");
      const form = root.querySelector(".task-add");
      const input = form.querySelector("input");
      const useGoogle = GoogleSync.connected();

      srcEl.classList.toggle("ok", useGoogle);
      srcEl.title = useGoogle ? "Synced with Google Tasks" : "Local tasks — connect Google in Settings";

      const setProgress = (done, total) => {
        countEl.textContent = `${done} of ${total}`;
        barEl.style.width = total ? `${(done / total) * 100}%` : "0%";
      };

      const makeRow = (title, meta, done, tagCls, tagText) => h(`
        <label class="task-row">
          <input type="checkbox" ${done ? "checked" : ""} />
          <span class="checkmark"></span>
          <span class="task-copy"><strong>${esc(title)}</strong><small>${esc(meta)}</small></span>
          <span class="task-tag ${tagCls}">${esc(tagText)}</span>
          <button class="task-del" type="button" aria-label="Delete task">✕</button>
        </label>`);

      if (useGoogle) {
        let items = [];
        const drawProgressG = () =>
          setProgress(items.filter((t) => t.status === "completed").length, items.length);

        const drawG = () => {
          list.innerHTML = "";
          const byPos = (a, b) =>
            (a.status === "completed") - (b.status === "completed") ||
            (a.position || "").localeCompare(b.position || "");

          const parents = items.filter((tk) => !tk.parent).sort(byPos);
          const kids = new Map();
          for (const tk of items) {
            if (!tk.parent) continue;
            if (!kids.has(tk.parent)) kids.set(tk.parent, []);
            kids.get(tk.parent).push(tk);
          }

          let rendered = 0;
          const renderTask = (tsk, isSub) => {
            rendered++;
            const done = tsk.status === "completed";
            const due = tsk.due
              ? new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" })
                  .format(new Date(tsk.due))
              : "";
            const r = makeRow(
              tsk.title || "(untitled)",
              due ? `Due ${due}` : isSub ? "Subtask" : "Google Tasks",
              done,
              done ? "tag-blue" : due ? "tag-coral" : "tag-neutral",
              done ? "Done" : due || "To do"
            );
            if (isSub) r.classList.add("task-sub");
            r.querySelector("input").addEventListener("change", async (e) => {
              const checked = e.target.checked;
              tsk.status = checked ? "completed" : "needsAction";
              drawProgressG();
              try {
                await GoogleSync.setTaskDone(tsk.id, checked);
              } catch {
                tsk.status = checked ? "needsAction" : "completed";
                drawG();
                drawProgressG();
              }
            });
            r.querySelector(".task-del").addEventListener("click", async (e) => {
              e.preventDefault();
              items = items.filter((x) => x !== tsk);
              drawG();
              drawProgressG();
              try { await GoogleSync.deleteTask(tsk.id); } catch { /* already removed locally */ }
            });
            list.append(r);
          };

          for (const p of parents) {
            renderTask(p, false);
            for (const c of (kids.get(p.id) || []).sort(byPos)) renderTask(c, true);
          }
          // Subtasks whose parent isn't in the list render at top level.
          for (const tk of items) {
            if (tk.parent && !items.some((x) => x.id === tk.parent)) renderTask(tk, false);
          }

          if (!rendered) {
            list.append(h(`<p class="muted" style="padding:16px 0">No tasks — add one below.</p>`));
          }
        };

        list.innerHTML = `<p class="muted" style="padding:16px 0">Loading Google Tasks…</p>`;
        GoogleSync.tasks()
          .then((res) => {
            items = res.filter((t) => t.title);
            drawG();
            drawProgressG();
          })
          .catch(() => {
            list.innerHTML = `<p class="muted" style="padding:16px 0">Couldn't load Google Tasks — reconnect in Settings.</p>`;
            setProgress(0, 0);
          });

        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const title = input.value.trim();
          if (!title) return;
          input.value = "";
          try {
            const created = await GoogleSync.addTask(title);
            items.unshift(created);
            drawG();
            drawProgressG();
          } catch {
            input.value = title;
          }
        });
        return;
      }

      // Local fallback when Google isn't connected.
      const data = widgetData("tasks", {
        items: [
          { id: "t1", title: "Plan the morning", meta: "Today · Personal", tag: "Done", cls: "tag-blue", done: true },
          { id: "t2", title: "Customize BrowserSlop", meta: "Today, 2:30 PM · Design", tag: "Today", cls: "tag-coral", done: false },
          { id: "t3", title: "Prepare weekly notes", meta: "Tomorrow · Work", tag: "Tomorrow", cls: "tag-amber", done: false },
          { id: "t4", title: "Clear priority inbox", meta: "Friday · Personal", tag: "Friday", cls: "tag-neutral", done: false },
          { id: "t5", title: "Outline next week", meta: "Sunday · Planning", tag: "Sunday", cls: "tag-neutral", done: false }
        ]
      });

      const drawProgress = () =>
        setProgress(data.items.filter((t) => t.done).length, data.items.length);

      const drawList = () => {
        list.innerHTML = "";
        for (const t of data.items) {
          const row = makeRow(t.title, t.meta || "", t.done, t.cls || "tag-neutral", t.tag || "");
          row.querySelector("input").addEventListener("change", (e) => {
            t.done = e.target.checked;
            saveData();
            drawProgress();
          });
          row.querySelector(".task-del").addEventListener("click", (e) => {
            e.preventDefault();
            data.items = data.items.filter((x) => x !== t);
            saveData();
            drawList();
            drawProgress();
          });
          list.append(row);
        }
      };

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const title = input.value.trim();
        if (!title) return;
        data.items.push({
          id: `t${Date.now()}`,
          title,
          meta: new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date()) + " · Added",
          tag: "New",
          cls: "tag-blue",
          done: false
        });
        input.value = "";
        saveData();
        drawList();
        drawProgress();
      });

      drawList();
      drawProgress();
    }
  },

  notes: {
    name: "Quick notes",
    icon: "📝",
    desc: "A scratchpad that autosaves as you type",
    w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 3,
    render(root) {
      root.classList.add("w-notes");
      const data = widgetData("notes", { text: "" });
      root.innerHTML = `
        <div class="widget-top"><span>Notes</span><span class="status-dot notes-saved ok" title="Saved"></span></div>
        <textarea class="notes-area scroll" placeholder="Jot something down…"></textarea>`;
      const area = root.querySelector(".notes-area");
      const dotEl = root.querySelector(".notes-saved");
      area.value = data.text;
      let t = null;
      area.addEventListener("input", () => {
        dotEl.classList.remove("ok");
        dotEl.classList.add("warn");
        dotEl.title = "Typing…";
        clearTimeout(t);
        t = setTimeout(() => {
          data.text = area.value;
          saveData();
          dotEl.classList.remove("warn");
          dotEl.classList.add("ok");
          dotEl.title = "Saved";
        }, 400);
      });
      cleanups.push(() => clearTimeout(t));
    }
  },

  links: {
    name: "Quick links",
    icon: "🔗",
    desc: "Favorite sites with favicons, one tap away",
    w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 2,
    render(root) {
      const data = widgetData("links", {
        items: [
          { title: "Gmail", url: "https://mail.google.com" },
          { title: "YouTube", url: "https://youtube.com" },
          { title: "GitHub", url: "https://github.com" },
          { title: "Outlook", url: "https://outlook.com" },
          { title: "Reddit", url: "https://reddit.com" }
        ]
      });

      root.innerHTML = `
        <div class="widget-top"><span>Quick links</span></div>
        <div class="links-grid scroll"></div>
        <form class="link-form" hidden>
          <input class="mini-input lf-title" placeholder="Name" aria-label="Link name" />
          <div class="row">
            <input class="mini-input lf-url" placeholder="https://…" aria-label="Link URL" />
            <button class="add-button" type="submit"><span aria-hidden="true">+</span></button>
          </div>
        </form>`;

      const grid = root.querySelector(".links-grid");
      const form = root.querySelector(".link-form");

      const draw = () => {
        grid.innerHTML = "";
        for (const l of data.items) {
          let host = "";
          try { host = new URL(l.url).hostname; } catch { host = l.url; }
          const tile = h(`
            <a class="link-tile" href="${esc(l.url)}">
              <img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64" alt="" />
              <span>${esc(l.title)}</span>
              <button class="link-del" type="button" aria-label="Remove link">✕</button>
            </a>`);
          tile.querySelector(".link-del").addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            data.items = data.items.filter((x) => x !== l);
            saveData();
            draw();
          });
          grid.append(tile);
        }
        const add = h(`<button class="link-add-tile" type="button" aria-label="Add link">+</button>`);
        add.addEventListener("click", () => {
          form.hidden = !form.hidden;
          if (!form.hidden) form.querySelector(".lf-title").focus();
        });
        grid.append(add);
      };

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const title = form.querySelector(".lf-title").value.trim();
        let url = form.querySelector(".lf-url").value.trim();
        if (!title || !url) return;
        if (!/^https?:\/\//i.test(url)) url = "https://" + url;
        data.items.push({ title, url });
        saveData();
        form.reset();
        form.hidden = true;
        draw();
      });

      draw();
    }
  },

  worldclock: {
    name: "World clock",
    icon: "🌍",
    desc: "Keep an eye on three time zones",
    w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 1,
    render(root) {
      const zones = [
        { label: "Los Angeles", tz: "America/Los_Angeles" },
        { label: "London", tz: "Europe/London" },
        { label: "Tokyo", tz: "Asia/Tokyo" }
      ];
      root.innerHTML = `
        <div class="widget-top"><span>World clock</span></div>
        <div class="zones">${zones.map((z) => `
          <div class="zone" data-tz="${z.tz}">
            <small>${z.label}</small><strong></strong><span></span>
          </div>`).join("")}
        </div>`;
      onTick("minute", () => {
        const now = new Date();
        for (const el of root.querySelectorAll(".zone")) {
          const tz = el.dataset.tz;
          el.querySelector("strong").textContent = fmtTime(now, tz);
          el.querySelector("span").textContent = new Intl.DateTimeFormat(undefined, {
            weekday: "short", timeZone: tz
          }).format(now);
        }
      });
    }
  },

  xfeed: {
    name: "X timeline",
    icon: "𝕏",
    desc: "Your reverse-chronological home timeline",
    w: 1, h: 2, minW: 1, minH: 2, maxW: 2, maxH: 3,
    render(root) {
      root.classList.add("w-xfeed");
      root.innerHTML = `
        <div class="widget-top">
          <span>X timeline</span>
          <span style="display:flex;gap:2px">
            <button class="ghost-btn xf-refresh" type="button" aria-label="Refresh timeline">↻</button>
            <a class="ghost-btn" href="https://x.com/home" target="_blank" rel="noopener" aria-label="Open X">↗</a>
          </span>
        </div>
        <div class="xf-timeline scroll" aria-live="polite"></div>`;

      const timeline = root.querySelector(".xf-timeline");
      const empty = (title, detail, buttonText) => {
        timeline.innerHTML = `
          <div class="xf-empty">
            <span class="xf-mark" aria-hidden="true">𝕏</span>
            <strong>${esc(title)}</strong>
            <p>${esc(detail)}</p>
            ${buttonText ? `<button class="primary-button xf-setup" type="button">${esc(buttonText)}</button>` : ""}
          </div>`;
        timeline.querySelector(".xf-setup")?.addEventListener("click", () => $("#settings-toggle").click());
      };
      const relativeTime = (value) => {
        const seconds = Math.max(0, Math.floor((Date.now() - new Date(value)) / 1000));
        if (seconds < 60) return "now";
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
        return `${Math.floor(seconds / 86400)}d`;
      };
      const safeUrl = (value) => {
        try {
          const url = new URL(value);
          return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
        } catch { return ""; }
      };
      const compactCount = (value) => {
        const count = Number(value || 0);
        if (count < 1000) return String(count);
        if (count < 1000000) return `${(count / 1000).toFixed(count < 10000 ? 1 : 0).replace(".0", "")}K`;
        return `${(count / 1000000).toFixed(count < 10000000 ? 1 : 0).replace(".0", "")}M`;
      };
      const metric = (kind, count, label) => {
        const icons = {
          replies: '<path d="M20.5 11.7c0 4.4-4.2 8-9.4 8-1.2 0-2.3-.2-3.3-.5L3.5 21l1.3-3.7c-1.4-1.4-2.3-3.4-2.3-5.6 0-4.4 4.2-8 9.4-8s8.6 3.6 8.6 8Z"/>',
          reposts: '<path d="m7 7 3-3 3 3M10 4v11a3 3 0 0 0 3 3h6M17 17l3 3 3-3M20 20V9a3 3 0 0 0-3-3h-2"/>',
          likes: '<path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.4 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>',
          views: '<path d="M4 20V10M10 20V4M16 20v-7M22 20V7"/>'
        };
        return `<span class="xf-metric xf-${kind}" title="${esc(`${count || 0} ${label}`)}">
          <svg viewBox="0 0 24 24" aria-hidden="true">${icons[kind]}</svg>
          <span>${compactCount(count)}</span>
        </span>`;
      };
      const mediaGrid = (post, mediaByKey) => {
        const items = (post.attachments?.media_keys || [])
          .map((key) => mediaByKey.get(key))
          .filter(Boolean)
          .slice(0, 4);
        if (!items.length) return null;
        const grid = h(`<div class="xf-media xf-media-${items.length}"></div>`);
        for (const item of items) {
          const source = safeUrl(item.type === "photo" ? item.url : item.preview_image_url || item.url);
          if (!source) continue;
          const figure = h(`<figure class="xf-media-item"><img loading="lazy" referrerpolicy="no-referrer" /><span class="xf-media-type" hidden></span></figure>`);
          const image = figure.querySelector("img");
          image.src = source;
          image.alt = item.alt_text || (item.type === "photo" ? "Post image" : `${item.type || "Media"} preview`);
          if (item.type === "video" || item.type === "animated_gif") {
            const badge = figure.querySelector(".xf-media-type");
            badge.hidden = false;
            badge.textContent = item.type === "video" ? "▶" : "GIF";
          }
          grid.append(figure);
        }
        return grid.childElementCount ? grid : null;
      };
      const load = async (force = false) => {
        if (!XSync.connected()) {
          empty("Connect X to view your timeline", "Your timeline stays private to X; the widget reads it directly from X.", "Set up X sync");
          return;
        }
        timeline.innerHTML = `<p class="xf-loading">Loading your timeline…</p>`;
        try {
          const data = await XSync.timeline(force);
          if (!root.isConnected) return;
          const users = new Map((data.includes?.users || []).map((user) => [user.id, user]));
          const media = new Map((data.includes?.media || []).map((item) => [item.media_key, item]));
          const includedPosts = new Map((data.includes?.tweets || []).map((post) => [post.id, post]));
          if (!data.data?.length) {
            empty("Nothing new right now", "Your X home timeline is up to date.");
            return;
          }
          timeline.innerHTML = "";
          for (const post of data.data) {
            const repostRef = post.referenced_tweets?.find((item) => item.type === "retweeted");
            const displayedPost = repostRef ? includedPosts.get(repostRef.id) || post : post;
            const actor = users.get(post.author_id) || {};
            const user = users.get(displayedPost.author_id) || actor;
            const handle = user.username || "i";
            const postUrl = `https://x.com/${encodeURIComponent(handle)}/status/${encodeURIComponent(displayedPost.id)}`;
            const metrics = displayedPost.public_metrics || {};
            const postEl = h(`
              <a class="xf-post" href="${postUrl}" target="_blank" rel="noopener">
                <div class="xf-repost" hidden></div>
                <div class="xf-post-grid">
                  <span class="xf-avatar"><span></span></span>
                  <div class="xf-post-body">
                    <div class="xf-post-head"><strong></strong><span class="xf-verified" hidden>✓</span><span class="xf-handle"></span><span class="xf-dot">·</span><time></time><b class="xf-more" aria-hidden="true">•••</b></div>
                    <p class="xf-post-text"></p>
                    <div class="xf-post-media"></div>
                    <div class="xf-metrics" aria-label="Post engagement">
                      ${metric("replies", metrics.reply_count, "replies")}
                      ${metric("reposts", metrics.retweet_count, "reposts")}
                      ${metric("likes", metrics.like_count, "likes")}
                      ${metric("views", metrics.impression_count, "views")}
                    </div>
                  </div>
                </div>
              </a>`);
            if (repostRef) {
              const context = postEl.querySelector(".xf-repost");
              context.hidden = false;
              context.textContent = `↻ ${actor.name || `@${actor.username || "Someone"}`} reposted`;
            }
            postEl.querySelector("strong").textContent = user.name || `@${handle}`;
            postEl.querySelector(".xf-handle").textContent = `@${handle}`;
            postEl.querySelector(".xf-verified").hidden = !user.verified;
            postEl.querySelector("time").textContent = displayedPost.created_at ? relativeTime(displayedPost.created_at) : "";
            postEl.querySelector(".xf-post-text").textContent = displayedPost.text || "";
            const avatarUrl = safeUrl(user.profile_image_url);
            const avatar = postEl.querySelector(".xf-avatar");
            if (avatarUrl) {
              const image = document.createElement("img");
              image.src = avatarUrl;
              image.alt = "";
              image.loading = "lazy";
              image.referrerPolicy = "no-referrer";
              avatar.replaceChildren(image);
            } else {
              avatar.querySelector("span").textContent = (user.name || handle).slice(0, 1).toUpperCase();
            }
            const postMedia = mediaGrid(displayedPost, media);
            const mediaSlot = postEl.querySelector(".xf-post-media");
            if (postMedia) mediaSlot.replaceWith(postMedia);
            else mediaSlot.remove();
            timeline.append(postEl);
          }
        } catch (err) {
          empty("Couldn't load your timeline", err.message || "Try reconnecting X in Settings.", "Open X settings");
        }
      };
      root.querySelector(".xf-refresh").addEventListener("click", () => load(true));
      load();
    }
  },

  linkedin: {
    name: "LinkedIn",
    icon: "💼",
    desc: "Quick access to your feed, network, and inbox",
    w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 2,
    render(root) {
      root.classList.add("w-linkedin");
      const LINKS = [
        ["📰", "Feed", "https://www.linkedin.com/feed/"],
        ["👥", "Network", "https://www.linkedin.com/mynetwork/"],
        ["🔔", "Alerts", "https://www.linkedin.com/notifications/"],
        ["💬", "Messages", "https://www.linkedin.com/messaging/"],
        ["🧑‍💻", "Jobs", "https://www.linkedin.com/jobs/"],
        ["🙍", "Profile", "https://www.linkedin.com/in/me/"]
      ];
      root.innerHTML = `
        <div class="widget-top">
          <span>LinkedIn</span>
          <a class="ghost-btn" href="https://www.linkedin.com/feed/" target="_blank" rel="noopener" aria-label="Open LinkedIn">↗</a>
        </div>
        <div class="li-grid scroll">
          ${LINKS.map(([ic, label, url]) => `
            <a class="li-link" href="${url}" target="_blank" rel="noopener">
              <span aria-hidden="true">${ic}</span>${label}
            </a>`).join("")}
        </div>`;
    }
  },

  quote: {
    name: "Daily quote",
    icon: "💬",
    desc: "A little inspiration with each new tab",
    w: 2, h: 1, minW: 1, minH: 1, maxW: 4, maxH: 1,
    render(root) {
      const QUOTES = [
        ["Simplicity is the ultimate sophistication.", "Leonardo da Vinci"],
        ["The best way to predict the future is to invent it.", "Alan Kay"],
        ["Well begun is half done.", "Aristotle"],
        ["Focus is saying no to a thousand good ideas.", "Steve Jobs"],
        ["It always seems impossible until it's done.", "Nelson Mandela"],
        ["Make it work, make it right, make it fast.", "Kent Beck"],
        ["What we think, we become.", "Buddha"],
        ["Action is the foundational key to all success.", "Pablo Picasso"],
        ["Little by little, one travels far.", "J.R.R. Tolkien"],
        ["Quality is not an act, it is a habit.", "Aristotle"],
        ["The obstacle is the way.", "Marcus Aurelius"],
        ["Done is better than perfect.", "Sheryl Sandberg"]
      ];
      const dayIndex = Math.floor(Date.now() / 86400000);
      let i = dayIndex % QUOTES.length;
      root.innerHTML = `
        <div class="widget-top"><span>Daily quote</span><button class="ghost-btn q-next" type="button">↻ New</button></div>
        <p class="quote-text"></p>
        <span class="quote-author"></span>`;
      const draw = () => {
        root.querySelector(".quote-text").textContent = `“${QUOTES[i][0]}”`;
        root.querySelector(".quote-author").textContent = `— ${QUOTES[i][1]}`;
      };
      root.querySelector(".q-next").addEventListener("click", () => {
        i = (i + 1) % QUOTES.length;
        draw();
      });
      draw();
    }
  },

  habits: {
    name: "Habit tracker",
    icon: "🔁",
    desc: "Weekly streak dots for daily habits",
    w: 2, h: 1, minW: 2, minH: 1, maxW: 4, maxH: 2,
    render(root) {
      root.classList.add("w-habits");
      const data = widgetData("habits", {
        habits: [
          { id: "h1", name: "Exercise" },
          { id: "h2", name: "Read" },
          { id: "h3", name: "Meditate" }
        ],
        marks: {}
      });

      const now = new Date();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const week = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return d;
      });
      const todayIdx = week.findIndex((d) => d.toDateString() === now.toDateString());

      root.innerHTML = `
        <div class="widget-top"><span>Habits</span><span class="muted" style="font-size:11px;text-transform:none;letter-spacing:0">This week</span></div>
        <div class="habit-grid scroll">
          <div class="habit-days"><i></i>${week.map((d, i) =>
            `<i class="${i === todayIdx ? "today-col" : ""}">${
              new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(d)
            }</i>`).join("")}<i></i></div>
          <div class="habit-rows"></div>
        </div>
        <form class="task-add">
          <input class="mini-input" placeholder="New habit…" aria-label="New habit" />
          <button class="add-button" type="submit"><span aria-hidden="true">+</span></button>
        </form>`;

      const rows = root.querySelector(".habit-rows");
      const draw = () => {
        rows.innerHTML = "";
        for (const hb of data.habits) {
          const row = h(`<div class="habit-row"><span>${esc(hb.name)}</span></div>`);
          week.forEach((d, i) => {
            const key = todayKey(d);
            const done = !!(data.marks[key] && data.marks[key][hb.id]);
            const dot = h(`<button class="habit-dot ${done ? "done" : ""} ${i === todayIdx ? "today-col" : ""}"
              type="button" aria-label="${esc(hb.name)} on ${key}"></button>`);
            dot.addEventListener("click", () => {
              data.marks[key] = data.marks[key] || {};
              data.marks[key][hb.id] = !data.marks[key][hb.id];
              saveData();
              dot.classList.toggle("done", data.marks[key][hb.id]);
            });
            row.append(dot);
          });
          const del = h(`<button class="habit-del" type="button" aria-label="Delete habit">✕</button>`);
          del.addEventListener("click", () => {
            data.habits = data.habits.filter((x) => x !== hb);
            saveData();
            draw();
          });
          row.append(del);
          rows.append(row);
        }
      };

      root.querySelector(".task-add").addEventListener("submit", (e) => {
        e.preventDefault();
        const input = root.querySelector(".task-add input");
        const name = input.value.trim();
        if (!name) return;
        data.habits.push({ id: `h${Date.now()}`, name });
        input.value = "";
        saveData();
        draw();
      });

      draw();
    }
  },

  water: {
    name: "Water intake",
    icon: "💧",
    desc: "Tap the cups — resets each morning",
    w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 1,
    render(root) {
      const data = widgetData("water", { date: todayKey(), cups: 0 });
      if (data.date !== todayKey()) {
        data.date = todayKey();
        data.cups = 0;
        saveData();
      }
      root.innerHTML = `
        <div class="widget-top"><span>Water</span><span class="water-count" style="font-size:11px;font-weight:700;letter-spacing:0;text-transform:none;color:var(--muted)"></span></div>
        <div class="cups">${Array.from({ length: 8 }, () => `<button class="cup" type="button">💧</button>`).join("")}</div>
        <p class="muted">Stay hydrated.</p>`;
      const cups = [...root.querySelectorAll(".cup")];
      const badge = root.querySelector(".water-count");
      const draw = () => {
        cups.forEach((c, i) => c.classList.toggle("full", i < data.cups));
        badge.textContent = `${data.cups} / 8`;
      };
      cups.forEach((c, i) =>
        c.addEventListener("click", () => {
          data.cups = data.cups === i + 1 ? i : i + 1;
          saveData();
          draw();
        })
      );
      draw();
    }
  },

  countdown: {
    name: "Countdown",
    icon: "⏳",
    desc: "Days until a date that matters to you",
    w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 1,
    render(root) {
      const data = widgetData("countdown", { title: "New Year", date: `${new Date().getFullYear() + 1}-01-01` });
      root.innerHTML = `
        <div class="widget-top"><span class="cd-title"></span><button class="ghost-btn cd-edit" type="button">✎ Edit</button></div>
        <div class="count-num"><strong></strong><span>days</span></div>
        <p class="muted cd-date"></p>
        <form class="count-form" hidden>
          <input class="mini-input cf-title" placeholder="Event name" aria-label="Event name" />
          <input class="mini-input cf-date" type="date" aria-label="Event date" />
          <button class="primary-button" style="margin-top:2px" type="submit">Save</button>
        </form>`;
      const form = root.querySelector(".count-form");
      const draw = () => {
        root.querySelector(".cd-title").textContent = data.title;
        const target = new Date(data.date + "T00:00:00");
        const days = Math.ceil((target - new Date()) / 86400000);
        root.querySelector(".count-num strong").textContent = Math.max(0, days);
        root.querySelector(".count-num span").textContent = days === 1 ? "day" : "days";
        root.querySelector(".cd-date").textContent = new Intl.DateTimeFormat(undefined, {
          month: "long", day: "numeric", year: "numeric"
        }).format(target);
      };
      root.querySelector(".cd-edit").addEventListener("click", () => {
        form.hidden = !form.hidden;
        form.querySelector(".cf-title").value = data.title;
        form.querySelector(".cf-date").value = data.date;
      });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const title = form.querySelector(".cf-title").value.trim();
        const date = form.querySelector(".cf-date").value;
        if (!title || !date) return;
        data.title = title;
        data.date = date;
        saveData();
        form.hidden = true;
        draw();
      });
      draw();
    }
  },

  breathe: {
    name: "Breathe",
    icon: "🫁",
    desc: "A calm box-breathing exercise",
    w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 2,
    render(root) {
      root.classList.add("w-breathe");
      root.innerHTML = `
        <div class="widget-top"><span>Breathe</span><button class="ghost-btn br-toggle" type="button">Start</button></div>
        <div class="breathe-stage">
          <div class="breathe-circle"></div>
          <span class="breathe-label">Box breathing</span>
        </div>`;
      const circle = root.querySelector(".breathe-circle");
      const label = root.querySelector(".breathe-label");
      const btn = root.querySelector(".br-toggle");
      const PHASES = [["Inhale", 4, true], ["Hold", 4, true], ["Exhale", 4, false], ["Hold", 4, false]];
      let timer = null;
      let idx = 0;
      const stop = () => {
        clearTimeout(timer);
        timer = null;
        circle.classList.remove("grow");
        label.textContent = "Box breathing";
        btn.textContent = "Start";
      };
      const run = () => {
        const [name, secs, grow] = PHASES[idx];
        label.textContent = `${name} · ${secs}s`;
        circle.classList.toggle("grow", grow);
        idx = (idx + 1) % PHASES.length;
        timer = setTimeout(run, secs * 1000);
      };
      btn.addEventListener("click", () => {
        if (timer) return stop();
        idx = 0;
        btn.textContent = "Stop";
        run();
      });
      cleanups.push(stop);
    }
  },

  progress: {
    name: "Time progress",
    icon: "📈",
    desc: "How far along the day, month, and year are",
    w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 1,
    render(root) {
      root.innerHTML = `
        <div class="widget-top"><span>Progress</span></div>
        <div class="prog-rows">
          ${["Day", "Month", "Year"].map((l) => `
            <div class="prog-row" data-k="${l}">
              <div class="lbl"><span>${l}</span><b></b></div>
              <div class="prog-bar"><span></span></div>
            </div>`).join("")}
        </div>`;
      onTick("minute", () => {
        const now = new Date();
        const dayPct = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100;
        const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const monthPct = ((now.getDate() - 1 + dayPct / 100) / dim) * 100;
        const start = new Date(now.getFullYear(), 0, 1);
        const end = new Date(now.getFullYear() + 1, 0, 1);
        const yearPct = ((now - start) / (end - start)) * 100;
        const vals = { Day: dayPct, Month: monthPct, Year: yearPct };
        for (const row of root.querySelectorAll(".prog-row")) {
          const v = vals[row.dataset.k];
          row.querySelector("b").textContent = `${Math.round(v)}%`;
          row.querySelector(".prog-bar span").style.width = `${v}%`;
        }
      });
    }
  },

  month: {
    name: "Mini month",
    icon: "📆",
    desc: "A compact month view with today marked",
    w: 1, h: 2, minW: 1, minH: 2, maxW: 2, maxH: 2,
    render(root) {
      root.classList.add("w-month");
      let offset = 0;
      root.innerHTML = `
        <div class="widget-top">
          <span>Calendar</span>
          <div class="month-nav">
            <button class="m-prev" type="button" aria-label="Previous month">‹</button>
            <button class="m-next" type="button" aria-label="Next month">›</button>
          </div>
        </div>
        <p class="month-title"></p>
        <div class="month-grid"></div>`;
      const grid = root.querySelector(".month-grid");
      const title = root.querySelector(".month-title");
      const draw = () => {
        const now = new Date();
        const view = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        title.textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(view);
        grid.innerHTML = "";
        const ref = new Date(2024, 0, 1); // a Monday
        for (let i = 0; i < 7; i++) {
          const d = new Date(ref);
          d.setDate(ref.getDate() + i);
          grid.append(h(`<span class="dow">${new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(d)}</span>`));
        }
        const firstDow = (view.getDay() + 6) % 7;
        const dim = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
        const prevDim = new Date(view.getFullYear(), view.getMonth(), 0).getDate();
        for (let i = 0; i < firstDow; i++) {
          grid.append(h(`<span class="day dim">${prevDim - firstDow + 1 + i}</span>`));
        }
        for (let d = 1; d <= dim; d++) {
          const isToday = offset === 0 && d === now.getDate();
          grid.append(h(`<span class="day ${isToday ? "today" : ""}">${d}</span>`));
        }
        const used = firstDow + dim;
        const trailing = (7 - (used % 7)) % 7;
        for (let i = 1; i <= trailing; i++) grid.append(h(`<span class="day dim">${i}</span>`));
      };
      root.querySelector(".m-prev").addEventListener("click", () => { offset--; draw(); });
      root.querySelector(".m-next").addEventListener("click", () => { offset++; draw(); });
      draw();
    }
  }
};

/* ============================================================
   Grid rendering
   ============================================================ */
const grid = $("#grid");

function currentCols() {
  return innerWidth <= 460 ? 1 : innerWidth <= 800 ? 2 : 4;
}

function applySpans(el, item) {
  const def = WIDGETS[item.t];
  const cols = currentCols();
  const w = Math.min(item.w, def.maxW, cols);
  const hh = Math.min(item.h, def.maxH);
  el.style.gridColumn = `span ${w}`;
  el.style.gridRow = `span ${hh}`;
}

function renderGrid() {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  grid.innerHTML = "";

  state.layout = state.layout.filter((item) => WIDGETS[item.t]);

  for (const item of state.layout) {
    const def = WIDGETS[item.t];
    const el = document.createElement("article");
    el.className = `widget w-${item.t}`;
    el.dataset.type = item.t;
    applySpans(el, item);
    def.render(el);

    const rm = h(`<button class="rm-btn" type="button" aria-label="Remove ${esc(def.name)}">✕</button>`);
    rm.addEventListener("click", () => {
      state.layout = state.layout.filter((x) => x !== item);
      saveLayout();
      renderGrid();
      renderGallery();
    });
    el.append(rm, h(`<div class="rs-handle" aria-hidden="true"></div>`));
    grid.append(el);
  }
}

let resizeTimer = null;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    for (const el of grid.children) {
      const item = state.layout.find((x) => x.t === el.dataset.type);
      if (item) applySpans(el, item);
    }
  }, 120);
});

/* ============================================================
   Edit mode: drag to reorder + resize
   ============================================================ */
let editMode = false;

function setEditMode(on) {
  editMode = on;
  document.body.classList.toggle("edit-mode", on);
  $("#edit-toggle").classList.toggle("is-active", on);
  if (on) renderGallery();
}

$("#edit-toggle").addEventListener("click", () => setEditMode(!editMode));
$("#edit-done").addEventListener("click", () => setEditMode(false));

grid.addEventListener("pointerdown", (e) => {
  if (!editMode || e.button !== 0) return;
  const widget = e.target.closest(".widget");
  if (!widget) return;
  if (e.target.closest(".rs-handle")) return startResize(e, widget);
  if (e.target.closest("button, input, textarea, a, select, [contenteditable]")) return;
  startDrag(e, widget);
});

function startDrag(e, widget) {
  e.preventDefault();
  const rect = widget.getBoundingClientRect();
  const ghost = widget.cloneNode(true);
  ghost.classList.add("drag-ghost");
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  document.body.append(ghost);
  widget.classList.add("drag-src");
  const offX = e.clientX - rect.left;
  const offY = e.clientY - rect.top;

  const move = (ev) => {
    ghost.style.left = `${ev.clientX - offX}px`;
    ghost.style.top = `${ev.clientY - offY}px`;
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const target = under && under.closest(".widget:not(.drag-src):not(.drag-ghost)");
    if (target && target.parentElement === grid) {
      const kids = [...grid.children];
      if (kids.indexOf(target) > kids.indexOf(widget)) target.after(widget);
      else target.before(widget);
    }
  };

  const up = () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    ghost.remove();
    widget.classList.remove("drag-src");
    const order = [...grid.children].map((el) => el.dataset.type);
    state.layout.sort((a, b) => order.indexOf(a.t) - order.indexOf(b.t));
    saveLayout();
  };

  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
}

function startResize(e, widget) {
  e.preventDefault();
  const item = state.layout.find((x) => x.t === widget.dataset.type);
  if (!item) return;
  const def = WIDGETS[item.t];
  const cols = currentCols();
  const gap = 17;
  const cellW = (grid.clientWidth - gap * (cols - 1)) / cols;
  const rowH = parseFloat(getComputedStyle(grid).gridAutoRows) || 190;
  const startX = e.clientX;
  const startY = e.clientY;
  const startW = Math.min(item.w, cols);
  const startH = item.h;

  const move = (ev) => {
    const dw = Math.round((ev.clientX - startX) / (cellW + gap));
    const dh = Math.round((ev.clientY - startY) / (rowH + gap));
    const w = Math.max(def.minW, Math.min(def.maxW, cols, startW + dw));
    const hh = Math.max(def.minH, Math.min(def.maxH, startH + dh));
    if (w !== item.w || hh !== item.h) {
      item.w = w;
      item.h = hh;
      applySpans(widget, item);
    }
  };

  const up = () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    saveLayout();
  };

  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
}

/* ============================================================
   Widget gallery
   ============================================================ */
function renderGallery() {
  const list = $("#gallery-list");
  list.innerHTML = "";
  const used = new Set(state.layout.map((x) => x.t));
  const available = Object.entries(WIDGETS).filter(([type]) => !used.has(type));

  if (!available.length) {
    list.append(h(`<p class="gallery-empty">All widgets are on your dashboard. Remove one to free it up.</p>`));
    return;
  }

  for (const [type, def] of available) {
    const tile = h(`
      <button class="gallery-tile" type="button">
        <span class="g-icon">${def.icon}</span>
        <b>${esc(def.name)}</b>
        <small>${esc(def.desc)}</small>
      </button>`);
    tile.addEventListener("click", () => {
      state.layout.push({ t: type, w: def.w, h: def.h });
      saveLayout();
      renderGrid();
      renderGallery();
    });
    list.append(tile);
  }
}

/* ============================================================
   Header + clock ticks
   ============================================================ */
function drawHeader() {
  const hour = new Date().getHours();
  $("#greeting").textContent =
    hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
}

/* ============================================================
   Search
   ============================================================ */
function initSearch() {
  const form = $("#search-form");
  const input = $("#search-input");
  const modeLabel = $("#search-mode");
  const status = $("#search-status");
  let mode = "google";

  const providers = {
    google: {
      label: "Google",
      inputLabel: "Search Google",
      url: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`
    },
    chatgpt: {
      label: "ChatGPT",
      inputLabel: "Ask ChatGPT",
      url: (query) =>
        `https://chatgpt.com/?prompt=${encodeURIComponent(query)}&browserslop_autosend=1`
    }
  };

  const draw = (announce = false) => {
    const provider = providers[mode];
    modeLabel.textContent = provider.label;
    input.placeholder = provider.inputLabel;
    input.setAttribute("aria-label", provider.inputLabel);
    if (announce) status.textContent = `${provider.label} selected`;
  };

  input.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    mode = mode === "google" ? "chatgpt" : "google";
    draw(true);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) {
      input.focus();
      return;
    }
    window.location.assign(providers[mode].url(query));
  });

  draw();
}

/* ============================================================
   First-run onboarding
   ============================================================ */
function initOnboarding() {
  if (localStorage.getItem(LS.onboarding) === "complete") return;

  const dialog = $("#onboarding");
  const next = $("#onboarding-next");
  const skip = $("#onboarding-skip");
  const title = $("#onboarding-title");
  const copy = $("#onboarding-copy");
  const steps = $$('[data-onboarding-step]', dialog);
  const dots = $$(".onboarding-dots i", dialog);
  let step = 1;

  const finish = () => {
    localStorage.setItem(LS.onboarding, "complete");
    document.body.classList.remove("onboarding-open");
    dialog.hidden = true;
    $("#search-input").focus();
  };

  const draw = () => {
    steps.forEach((item) => { item.hidden = Number(item.dataset.onboardingStep) !== step; });
    dots.forEach((dot, index) => dot.classList.toggle("is-active", index === step - 1));
    const content = {
      1: ["Make your new tab yours.", "A calmer place for focus, plans, and whatever you need next.", "Get started"],
      2: ["Pick your starting vibe.", "Choose what feels right. Every detail stays adjustable.", "Looks good"],
      3: ["You’re all set.", "BrowserSlop is ready when you are.", "Open dashboard"]
    }[step];
    [title.textContent, copy.textContent, next.textContent] = content;
    skip.hidden = step === 3;
  };

  $$("[data-onboarding-theme]", dialog).forEach((button) => {
    button.classList.toggle("is-active", button.dataset.onboardingTheme === state.settings.theme);
    button.addEventListener("click", () => {
      state.settings.theme = button.dataset.onboardingTheme;
      saveSettings();
      applySettings();
      $$("[data-onboarding-theme]", dialog).forEach((item) =>
        item.classList.toggle("is-active", item === button)
      );
    });
  });

  const accentList = $("#onboarding-accents");
  for (const [name, hex] of ACCENTS) {
    const button = h(`<button class="swatch" type="button" title="${name}" aria-label="${name}" data-accent="${hex}" style="background:${hex};color:${hex}"></button>`);
    button.classList.toggle("is-active", state.settings.accent === hex);
    button.addEventListener("click", () => {
      state.settings.accent = hex;
      saveSettings();
      applySettings();
      $$(".swatch", accentList).forEach((item) => item.classList.toggle("is-active", item === button));
    });
    accentList.append(button);
  }

  next.addEventListener("click", () => {
    if (step === 3) finish();
    else { step += 1; draw(); next.focus(); }
  });
  skip.addEventListener("click", finish);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") finish();
  });

  document.body.classList.add("onboarding-open");
  dialog.hidden = false;
  draw();
  next.focus();
}

setInterval(() => {
  drawHeader();
  tickers.minute.forEach((fn) => fn());
}, 30000);
setInterval(() => tickers.second.forEach((fn) => fn()), 1000);

/* ============================================================
   Boot
   ============================================================ */
initSettingsUI();
applySettings();
initSearch();
drawHeader();
renderGrid();
renderGallery();
initOnboarding();
