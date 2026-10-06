// The world map: a dot grid on a canvas, with pan, pinch-zoom and tapping.
(() => {
  const MAP = window.PLAGUE_MAP;
  const COLS = MAP.cols;
  const ROWS = MAP.rows.length;
  const KEYS = MAP.keys;

  // Decode the character grid into flat arrays once.
  const cellRegion = new Int8Array(COLS * ROWS).fill(-1);
  const landCells = []; // [index, col, row]
  const regionCells = KEYS.map(() => []);
  for (let r = 0; r < ROWS; r++) {
    const row = MAP.rows[r];
    for (let c = 0; c < COLS; c++) {
      const ch = row[c];
      if (!ch || ch === ".") continue;
      const idx = MAP.chars.indexOf(ch);
      if (idx < 0) continue;
      const i = r * COLS + c;
      cellRegion[i] = idx;
      landCells.push(i);
      regionCells[idx].push(i);
    }
  }

  // A representative cell per region, for bubbles: the land cell closest to
  // the region's average position.
  const regionAnchor = regionCells.map((cells) => {
    let sc = 0;
    let sr = 0;
    for (const i of cells) {
      sc += i % COLS;
      sr += (i - (i % COLS)) / COLS;
    }
    const ac = sc / cells.length;
    const ar = sr / cells.length;
    let best = cells[0];
    let bestD = Infinity;
    for (const i of cells) {
      const c = i % COLS;
      const r = (i - c) / COLS;
      const d = (c - ac) ** 2 + (r - ar) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { cell: best, col: best % COLS, row: (best - (best % COLS)) / COLS };
  });

  // The cells just outside each region: a selection is drawn here, so the
  // region's own colour is never painted over.
  const regionHalo = regionCells.map((cells) => {
    const own = new Set(cells);
    const halo = new Set();
    for (const i of cells) {
      const c = i % COLS;
      const r = (i - c) / COLS;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
          const j = rr * COLS + cc;
          if (!own.has(j)) halo.add(j);
        }
      }
    }
    return [...halo];
  });

  // Bounding box per region, so drawing can skip what is off screen.
  const regionBox = regionCells.map((cells) => {
    let c0 = COLS;
    let c1 = 0;
    let r0 = ROWS;
    let r1 = 0;
    for (const i of cells) {
      const c = i % COLS;
      const r = (i - c) / COLS;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
    }
    return { c0, c1, r0, r1 };
  });

  function mix(a, b, t) {
    const k = Math.max(0, Math.min(1, t));
    return [
      Math.round(a[0] + (b[0] - a[0]) * k),
      Math.round(a[1] + (b[1] - a[1]) * k),
      Math.round(a[2] + (b[2] - a[2]) * k),
    ];
  }
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

  const C_LAND = [60, 82, 87];
  const C_LAND_SEEN = [86, 110, 112];
  const C_INF = [229, 64, 44];
  const C_DEAD = [84, 26, 22];
  const C_OCEAN_DOT = [21, 36, 46];
  const C_SEL = [244, 166, 59];

  class MapView {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { alpha: false });
      this.onPick = opts.onPick || (() => {});
      this.onBubble = opts.onBubble || (() => {});
      this.state = null;
      this.selected = null;
      this.scale = 6;
      this.minScale = 2;
      this.maxScale = 26;
      this.x = 0; // top-left of the view, in cells
      this.y = 0;
      this.pointers = new Map();
      this.moved = 0;
      this.dirty = true;
      this.pulse = 0;
      this.oceanTile = null;
      this.oceanTileScale = 0;
      // The ocean and land dots are redrawn into an offscreen layer only when
      // the camera or the world actually changes, and blitted every frame.
      this.layer = document.createElement("canvas");
      this.layerCtx = this.layer.getContext("2d", { alpha: false });
      this.layerKey = "";
      this.worldVersion = 0;
      this.bindEvents();
      this.resize(true);
    }

    get viewW() {
      return this.canvas.clientWidth;
    }
    get viewH() {
      return this.canvas.clientHeight;
    }

    resize(fit) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (!w || !h) return;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.minScale = Math.max(1.4, Math.min(w / COLS, h / ROWS));
      if (fit) {
        this.scale = Math.max(this.minScale, Math.min(w / COLS, (h / ROWS) * 1.15));
        this.centerOn(COLS / 2, ROWS * 0.46);
      }
      this.clamp();
      this.dirty = true;
    }

    centerOn(col, row) {
      this.x = col - this.viewW / this.scale / 2;
      this.y = row - this.viewH / this.scale / 2;
      this.clamp();
      this.dirty = true;
    }

    clamp() {
      const cw = this.viewW / this.scale;
      const ch = this.viewH / this.scale;
      const slackX = Math.min(8, COLS * 0.1);
      const slackY = Math.min(8, ROWS * 0.1);
      if (cw >= COLS) this.x = (COLS - cw) / 2;
      else this.x = Math.max(-slackX, Math.min(COLS - cw + slackX, this.x));
      if (ch >= ROWS) this.y = (ROWS - ch) / 2;
      else this.y = Math.max(-slackY, Math.min(ROWS - ch + slackY, this.y));
    }

    zoomBy(factor, px, py) {
      const cx = px === undefined ? this.viewW / 2 : px;
      const cy = py === undefined ? this.viewH / 2 : py;
      const beforeC = this.x + cx / this.scale;
      const beforeR = this.y + cy / this.scale;
      this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
      this.x = beforeC - cx / this.scale;
      this.y = beforeR - cy / this.scale;
      this.clamp();
      this.dirty = true;
    }

    cellAt(px, py) {
      const c = Math.floor(this.x + px / this.scale);
      const r = Math.floor(this.y + py / this.scale);
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return -1;
      return r * COLS + c;
    }

    // The nearest region within a few cells, so fat fingers still hit islands.
    regionAt(px, py) {
      const i = this.cellAt(px, py);
      if (i < 0) return null;
      if (cellRegion[i] >= 0) return KEYS[cellRegion[i]];
      const c = i % COLS;
      const r = (i - c) / COLS;
      const reach = Math.max(1, Math.round(16 / this.scale));
      let best = null;
      let bestD = Infinity;
      for (let dr = -reach; dr <= reach; dr++) {
        for (let dc = -reach; dc <= reach; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
          const k = cellRegion[rr * COLS + cc];
          if (k < 0) continue;
          const d = dr * dr + dc * dc;
          if (d < bestD) {
            bestD = d;
            best = KEYS[k];
          }
        }
      }
      return best;
    }

    bubbleAt(px, py) {
      if (!this.state) return null;
      for (const b of this.state.bubbles) {
        const p = this.bubblePos(b);
        if (!p) continue;
        const rad = Math.max(22, this.scale * 2.2);
        if ((p.x - px) ** 2 + (p.y - py) ** 2 < rad * rad) return b;
      }
      return null;
    }

    bubblePos(b) {
      const idx = KEYS.indexOf(b.region);
      if (idx < 0) return null;
      const a = regionAnchor[idx];
      return {
        x: (a.col + 0.5 - this.x) * this.scale,
        y: (a.row + 0.5 - this.y) * this.scale,
      };
    }

    bindEvents() {
      const el = this.canvas;
      el.style.touchAction = "none";

      el.addEventListener("pointerdown", (e) => {
        // Capture keeps a drag alive outside the canvas, but it can throw for
        // a pointer the browser no longer considers active; the drag still
        // works without it, so never let that kill the handler.
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* no capture, drag still tracked below */
        }
        this.pointers.set(e.pointerId, {
          x: e.offsetX,
          y: e.offsetY,
          sx: e.offsetX,
          sy: e.offsetY,
        });
        this.moved = 0;
        if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        }
        el.classList.add("dragging");
      });

      el.addEventListener("pointermove", (e) => {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        const dx = e.offsetX - p.x;
        const dy = e.offsetY - p.y;
        p.x = e.offsetX;
        p.y = e.offsetY;
        if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (this.pinchDist > 0) {
            this.zoomBy(dist / this.pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
          }
          this.pinchDist = dist;
          this.moved += 10;
        } else {
          this.x -= dx / this.scale;
          this.y -= dy / this.scale;
          this.moved += Math.abs(dx) + Math.abs(dy);
          this.clamp();
          this.dirty = true;
        }
      });

      const end = (e) => {
        const p = this.pointers.get(e.pointerId);
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.pinchDist = 0;
        if (this.pointers.size === 0) el.classList.remove("dragging");
        if (!p || this.moved > 10) return;
        const bubble = this.bubbleAt(p.sx, p.sy);
        if (bubble) {
          this.onBubble(bubble);
          return;
        }
        this.onPick(this.regionAt(p.sx, p.sy));
      };
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", (e) => {
        this.pointers.delete(e.pointerId);
        if (this.pointers.size === 0) el.classList.remove("dragging");
      });

      el.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY);
        },
        { passive: false },
      );

      el.addEventListener("keydown", (e) => {
        const stepPx = 60;
        const moves = {
          ArrowLeft: [-stepPx, 0],
          ArrowRight: [stepPx, 0],
          ArrowUp: [0, -stepPx],
          ArrowDown: [0, stepPx],
        };
        if (moves[e.key]) {
          e.preventDefault();
          this.x += moves[e.key][0] / this.scale;
          this.y += moves[e.key][1] / this.scale;
          this.clamp();
          this.dirty = true;
        } else if (e.key === "+" || e.key === "=") {
          this.zoomBy(1.25);
        } else if (e.key === "-") {
          this.zoomBy(0.8);
        }
      });
    }

    setState(state) {
      if (state !== this.state) this.worldVersion++;
      this.state = state;
      // The land layer only has to change when a day has passed.
      const v = state ? `${state.day}:${state.traits.length}` : "0";
      if (v !== this.stateStamp) {
        this.stateStamp = v;
        this.worldVersion++;
      }
    }

    select(key) {
      this.selected = key;
    }

    focus(key) {
      const idx = KEYS.indexOf(key);
      if (idx < 0) return;
      const a = regionAnchor[idx];
      this.scale = Math.max(this.scale, 7);
      this.centerOn(a.col, a.row);
    }

    // A tile of one ocean dot, repeated across the view.
    oceanPattern() {
      const s = this.scale;
      if (this.oceanTile && Math.abs(this.oceanTileScale - s) < 0.01) return this.oceanTile;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const size = Math.max(1, Math.round(s * dpr));
      const tile = document.createElement("canvas");
      tile.width = size;
      tile.height = size;
      const tc = tile.getContext("2d");
      tc.fillStyle = "#091117";
      tc.fillRect(0, 0, size, size);
      const d = Math.max(1, Math.round(s * 0.3 * dpr));
      tc.fillStyle = rgb(C_OCEAN_DOT);
      tc.fillRect(Math.round((size - d) / 2), Math.round((size - d) / 2), d, d);
      this.oceanTile = this.layerCtx.createPattern(tile, "repeat");
      this.oceanTileScale = s;
      return this.oceanTile;
    }

    regionColor(key) {
      const reg = this.state?.regions[key];
      if (!reg) return C_LAND;
      const live = Math.max(1, reg.pop - reg.dead);
      const infFrac = reg.inf / live;
      const deadFrac = reg.dead / reg.pop;
      let col = reg.seen ? C_LAND_SEEN : C_LAND;
      if (infFrac > 0) col = mix(col, C_INF, 0.3 + Math.sqrt(infFrac) * 0.7);
      if (deadFrac > 0.02) col = mix(col, C_DEAD, Math.min(0.9, deadFrac));
      return col;
    }

    // Ocean and land dots, drawn into the offscreen layer.
    drawWorld(w, h) {
      const ctx = this.layerCtx;
      const s = this.scale;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (this.layer.width !== Math.round(w * dpr) || this.layer.height !== Math.round(h * dpr)) {
        this.layer.width = Math.round(w * dpr);
        this.layer.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Ocean.
      ctx.save();
      ctx.fillStyle = "#091117";
      ctx.fillRect(0, 0, w, h);
      const offX = -((this.x % 1) + 1) % 1;
      const offY = -((this.y % 1) + 1) % 1;
      ctx.translate(offX * s, offY * s);
      ctx.fillStyle = this.oceanPattern();
      ctx.fillRect(-s, -s, w + s * 2, h + s * 2);
      ctx.restore();

      // Land, batched one path per colour.
      const c0 = Math.max(0, Math.floor(this.x) - 1);
      const c1 = Math.min(COLS - 1, Math.ceil(this.x + w / s) + 1);
      const r0 = Math.max(0, Math.floor(this.y) - 1);
      const r1 = Math.min(ROWS - 1, Math.ceil(this.y + h / s) + 1);
      const d = Math.max(1, s * 0.62);
      const pad = (s - d) / 2;

      for (let k = 0; k < KEYS.length; k++) {
        const box = regionBox[k];
        if (box.c1 < c0 || box.c0 > c1 || box.r1 < r0 || box.r0 > r1) continue;
        ctx.fillStyle = rgb(this.regionColor(KEYS[k]));
        for (const i of regionCells[k]) {
          const c = i % COLS;
          const r = (i - c) / COLS;
          if (c < c0 || c > c1 || r < r0 || r > r1) continue;
          ctx.fillRect((c - this.x) * s + pad, (r - this.y) * s + pad, d, d);
        }
      }
    }

    // Everything that animates every frame: the selection pulse and bubbles.
    drawOverlay(now, w, h) {
      const ctx = this.ctx;
      const s = this.scale;
      const c0 = Math.max(0, Math.floor(this.x) - 1);
      const c1 = Math.min(COLS - 1, Math.ceil(this.x + w / s) + 1);
      const r0 = Math.max(0, Math.floor(this.y) - 1);
      const r1 = Math.min(ROWS - 1, Math.ceil(this.y + h / s) + 1);
      const d = Math.max(1, s * 0.62);

      // Selected region: a pulsing halo of dots around it, never over it.
      if (this.selected) {
        const k = KEYS.indexOf(this.selected);
        if (k >= 0) {
          const t = 0.5 + 0.5 * Math.sin(now / 320);
          ctx.fillStyle = `rgba(${C_SEL[0]},${C_SEL[1]},${C_SEL[2]},${0.3 + t * 0.5})`;
          const dot = Math.max(1.5, d * 0.8);
          const off = (s - dot) / 2;
          for (const i of regionHalo[k]) {
            const c = i % COLS;
            const rr = (i - c) / COLS;
            if (c < c0 || c > c1 || rr < r0 || rr > r1) continue;
            ctx.fillRect((c - this.x) * s + off, (rr - this.y) * s + off, dot, dot);
          }
        }
      }

      // Research bubbles, from sprites so no text is laid out per frame.
      if (this.state) {
        for (const b of this.state.bubbles) {
          const p = this.bubblePos(b);
          if (!p || p.x < -40 || p.y < -40 || p.x > w + 40 || p.y > h + 40) continue;
          const rad = Math.max(13, Math.min(22, s * 1.4));
          const sprite = this.bubbleSprite(b.value, rad);
          const grow = 1 + Math.sin(now / 600 + b.value) * 0.07;
          const size = sprite.size * grow;
          ctx.drawImage(sprite.canvas, p.x - size / 2, p.y - size / 2, size, size);
        }
      }
    }

    // One canvas per (value, radius), reused until the zoom changes.
    bubbleSprite(value, rad) {
      const r = Math.round(rad);
      const key = `${value}@${r}`;
      if (!this.sprites) this.sprites = new Map();
      const hit = this.sprites.get(key);
      if (hit) return hit;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const size = (r + 3) * 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      const c = canvas.getContext("2d");
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.beginPath();
      c.arc(size / 2, size / 2, r, 0, Math.PI * 2);
      c.fillStyle = "rgba(244,166,59,0.18)";
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = "rgba(244,166,59,0.95)";
      c.stroke();
      c.fillStyle = "#f4a63b";
      c.font = `600 ${Math.round(r * 0.95)}px "IBM Plex Mono", monospace`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(String(value), size / 2, size / 2 + 1);
      const sprite = { canvas, size };
      if (this.sprites.size > 40) this.sprites.clear();
      this.sprites.set(key, sprite);
      return sprite;
    }

    draw(now) {
      const w = this.viewW;
      const h = this.viewH;
      if (!w || !h) return;
      // Camera changes redraw at once; the world itself at most every 180ms,
      // so running at top speed does not rebuild the layer every tick.
      const cam = `${this.x.toFixed(3)}|${this.y.toFixed(3)}|${this.scale.toFixed(3)}|${w}x${h}`;
      const stale = now - (this.layerAt || 0) > 180;
      const key = cam === this.camKey && !stale ? this.layerKey : `${cam}|${this.worldVersion}`;
      this.camKey = cam;
      if (key !== this.layerKey) {
        this.layerAt = now;
        this.layerKey = key;
        this.drawWorld(w, h);
      }
      this.ctx.drawImage(this.layer, 0, 0, w, h);
      this.drawOverlay(now, w, h);
    }

    tick(now) {
      this.draw(now);
      this.dirty = false;
    }
  }

  window.MapView = MapView;
  window.MAP_META = { COLS, ROWS, KEYS, regionAnchor, cellRegion };
})();
