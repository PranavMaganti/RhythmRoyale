// Sheets that open over the map: the evolution tree, the world report, and the
// end-of-game screen. Each returns a detached element the shell appends.
(() => {
  const { TRAIT_LIST, TABS, FX_LABELS, REGIONS } = window.GAME;
  const SIM = window.SIM;

  // --- shared helpers --------------------------------------------------------
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined && v !== false)
          node.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const c of [].concat(children || [])) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  // 1.24bn / 840m / 12.4k / 320
  function num(n) {
    const v = Math.max(0, Math.round(n));
    if (v >= 1e9) return `${(v / 1e9).toFixed(v < 1e10 ? 2 : 1)}bn`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(v < 1e7 ? 1 : 0)}m`;
    if (v >= 1e4) return `${Math.round(v / 1e3)}k`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
    return String(v);
  }

  function pct(f, dp) {
    const p = f * 100;
    if (p > 0 && p < 0.1) return "<0.1%";
    return `${p.toFixed(dp === undefined ? (p < 10 ? 1 : 0) : dp)}%`;
  }

  const ICONS = {
    plane:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.2 3.6 12 3l1.8.6.5 6.4 6.2 2.3v1.9l-6.2-1.1-.6 4.3 2.3 1.7v1.4L12 19.6l-4-1.1v-1.4l2.3-1.7-.6-4.3-6.2 1.1v-1.9l6.2-2.3z"/></svg>',
    boat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17.5c1.5 0 1.5 1.5 3 1.5s1.5-1.5 3-1.5 1.5 1.5 3 1.5 1.5-1.5 3-1.5 1.5 1.5 3 1.5 1.5-1.5 3-1.5"/><path d="M5 14.5h14l-2 -4H7z"/><path d="M12 10.5V4l5 2.2-5 1.6"/></svg>',
    shut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>',
  };

  function icon(name, cls) {
    const span = el("span", { class: cls || "" });
    span.innerHTML = ICONS[name] || "";
    return span;
  }

  function sheet(title, bodyParts, onClose) {
    const close = el("button", { class: "icon-btn", "aria-label": "Close", onclick: onClose });
    close.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    const panel = el(
      "div",
      { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
      [el("div", { class: "sheet-head" }, [el("h2", { text: title }), close]), ...bodyParts],
    );
    const overlay = el("div", { class: "overlay" }, [panel]);
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) onClose();
    });
    return overlay;
  }

  // --- evolution sheet -------------------------------------------------------
  // Hex geometry: columns step by 78% of a hex width and odd columns drop half
  // a row, which is what makes the comb interlock.
  const HEX_W = 86;
  const HEX_H = 76;
  const STEP_X = HEX_W * 0.78;

  function hexPos(t) {
    return { x: t.col * STEP_X, y: t.row * HEX_H + (t.col % 2 ? HEX_H / 2 : 0) };
  }

  function evolutionSheet(app) {
    let tab = app.tab || "spread";
    let picked = null;

    const grid = el("div", { class: "hexgrid" });
    const detail = el("div", { class: "trait-detail" });
    const meters = el("div", { class: "meters" });
    const tabRow = el("div", { class: "tabs", role: "tablist" });

    function stat(label, value, cls) {
      return el("div", { class: `meter ${cls || ""}` }, [
        el("div", { class: "label", text: label }),
        el("div", { class: "track" }, [el("div", { class: "fill", style: `width:${value}%` })]),
      ]);
    }

    function drawMeters() {
      const st = SIM.stats(app.state);
      meters.replaceChildren(
        stat("Infectivity", Math.min(100, (1 + st.spread) * 26), ""),
        stat("Alarm", Math.min(100, st.severity * 9), "sev"),
        stat("Lethality", Math.min(100, st.lethal * 700), "let"),
      );
    }

    function effectChips(trait) {
      const chips = [];
      for (const [k, v] of Object.entries(trait.fx)) {
        const label = FX_LABELS[k];
        if (!label) continue;
        let text;
        if (k === "lethal") text = `${label[0]} +${(v * 100).toFixed(2)}%/day`;
        else if (k === "notice") text = `${label[0]} ${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;
        else if (k === "severity") text = `${label[0]} +${v}`;
        else text = `${label[0]} ${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;
        const bad = (k === "notice" || k === "severity" || k === "lethal") && v > 0;
        chips.push(el("span", { class: `tag ${bad ? "closed" : "open"}`, text }));
      }
      return chips;
    }

    function drawDetail() {
      if (!picked) {
        detail.replaceChildren(
          el("p", {
            text: "Pick a hex to see what it changes. Research points come from new regions and from how much alarm the outbreak causes.",
          }),
        );
        return;
      }
      const t = picked;
      const status = SIM.canEvolve(app.state, t);
      const cost = SIM.traitCost(app.state, t);
      const buttons = [];
      if (status === "owned") {
        const can = SIM.refundable(app.state, t.id);
        const rc = SIM.refundCost(app.state, t.id);
        buttons.push(
          el("button", {
            class: "btn",
            text: can ? `Undo for ${rc}` : "Something depends on this",
            disabled: !can || app.state.points < rc,
            onclick: () => {
              if (SIM.refund(app.state, t.id)) {
                app.save();
                redraw();
              }
            },
          }),
        );
      } else {
        buttons.push(
          el("button", {
            class: "btn dna",
            text: status === "locked" ? "Needs the hex before it" : `Evolve for ${cost}`,
            disabled: status !== "ok",
            onclick: () => {
              if (SIM.evolve(app.state, t.id)) {
                app.bumpDna();
                app.save();
                redraw();
              }
            },
          }),
        );
      }
      detail.replaceChildren(
        el("h3", { text: t.name }),
        el("div", { class: "trait-effects" }, effectChips(t)),
        el("div", { class: "trait-actions" }, buttons),
      );
    }

    function drawGrid() {
      const traits = TRAIT_LIST.filter((t) => t.tab === tab);
      const maxCol = Math.max(...traits.map((t) => t.col));
      const maxRow = Math.max(...traits.map((t) => t.row));
      grid.style.setProperty("--hw", `${HEX_W}px`);
      grid.style.setProperty("--hh", `${HEX_H}px`);
      grid.style.width = `${maxCol * STEP_X + HEX_W}px`;
      grid.style.height = `${(maxRow + 1) * HEX_H + HEX_H / 2 + 4}px`;

      const links = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      links.setAttribute("class", "links");
      const kids = [links];
      for (const t of traits) {
        const p = hexPos(t);
        for (const need of t.needs) {
          const parent = traits.find((x) => x.id === need);
          if (!parent) continue;
          const q = hexPos(parent);
          const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line.setAttribute("x1", q.x + HEX_W / 2);
          line.setAttribute("y1", q.y + HEX_H / 2);
          line.setAttribute("x2", p.x + HEX_W / 2);
          line.setAttribute("y2", p.y + HEX_H / 2);
          line.setAttribute("stroke", app.state.traits.includes(t.id) ? "#e5402c" : "#22343d");
          line.setAttribute("stroke-width", "3");
          links.appendChild(line);
        }
      }
      for (const t of traits) {
        const p = hexPos(t);
        const status = SIM.canEvolve(app.state, t);
        const cls =
          status === "owned"
            ? "evolved"
            : status === "ok"
              ? "available"
              : status === "poor"
                ? ""
                : "locked";
        const node = el(
          "button",
          {
            class: `hex ${cls} ${picked && picked.id === t.id ? "selected" : ""}`,
            style: `left:${p.x}px;top:${p.y}px`,
            "aria-pressed": picked && picked.id === t.id,
            onclick: () => {
              picked = t;
              redraw();
            },
          },
          [
            el("span", {}, [
              t.name,
              status === "owned"
                ? null
                : el("span", { class: "cost", text: String(SIM.traitCost(app.state, t)) }),
            ]),
          ],
        );
        kids.push(node);
      }
      grid.replaceChildren(...kids);
    }

    function drawTabs() {
      tabRow.replaceChildren(
        ...TABS.map((t) =>
          el("button", {
            role: "tab",
            "aria-selected": t.id === tab,
            text: t.name,
            onclick: () => {
              tab = t.id;
              app.tab = t.id;
              picked = null;
              redraw();
            },
          }),
        ),
      );
    }

    function redraw() {
      drawTabs();
      drawMeters();
      drawGrid();
      drawDetail();
      app.refreshHud();
    }

    const body = el("div", { class: "sheet-body" }, [grid]);
    redraw();
    return sheet("Evolve", [tabRow, meters, body, detail], () => app.closeSheet());
  }

  // --- world report ----------------------------------------------------------
  // The curve is scaled to its own peak, not to world population, so the first
  // weeks are visible at all. The cure rides the same box on its own 0..100 scale.
  function chart(canvas, state) {
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const hist = state.history.length ? state.history : [[0, 0, 0, 0]];
    let peak = 1;
    for (const row of hist) peak = Math.max(peak, row[1] + row[2]);
    const days = Math.max(10, hist[hist.length - 1][0]);
    const x = (d) => (d / days) * (w - 2) + 1;
    const y = (v) => h - 2 - (v / peak) * (h - 10);

    ctx.strokeStyle = "#ffffff12";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const gy = Math.round(y((peak * i) / 4)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(1, gy);
      ctx.lineTo(w - 1, gy);
      ctx.stroke();
    }

    const area = (pick, fill) => {
      ctx.beginPath();
      ctx.moveTo(x(hist[0][0]), y(0));
      for (const row of hist) ctx.lineTo(x(row[0]), y(pick(row)));
      ctx.lineTo(x(hist[hist.length - 1][0]), y(0));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    area((r) => r[1] + r[2], "#e5402c44");
    area((r) => r[2], "#6b1f1aaa");

    ctx.beginPath();
    hist.forEach((row, i) => {
      const vy = h - 2 - row[3] * (h - 10);
      if (i === 0) ctx.moveTo(x(row[0]), vy);
      else ctx.lineTo(x(row[0]), vy);
    });
    ctx.strokeStyle = "#3ea8f2";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#89a09c";
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(num(peak), 4, 3);
    ctx.textAlign = "right";
    ctx.fillText(`day ${days}`, w - 4, h - 13);
  }

  function worldSheet(app) {
    let sort = app.sort || "inf";
    const body = el("div", { class: "sheet-body" });

    function rows() {
      const keys = SIM.KEYS.slice();
      const reg = (k) => app.state.regions[k];
      const cmp = {
        inf: (a, b) => reg(b).inf - reg(a).inf,
        dead: (a, b) => reg(b).dead - reg(a).dead,
        pop: (a, b) => reg(b).pop - reg(a).pop,
        name: (a, b) => REGIONS[a].name.localeCompare(REGIONS[b].name),
      };
      keys.sort(cmp[sort] || cmp.inf);
      return keys.map((k) => {
        const r = reg(k);
        const infW = (r.inf / r.pop) * 100;
        const deadW = (r.dead / r.pop) * 100;
        return el(
          "button",
          {
            class: "region-row",
            onclick: () => {
              app.closeSheet();
              app.selectRegion(k, true);
            },
          },
          [
            el("span", { class: "nm", text: REGIONS[k].name }),
            el("span", { class: "bar" }, [
              el("span", { class: "b-dead", style: `width:${deadW}%` }),
              el("span", { class: "b-inf", style: `width:${infW}%` }),
            ]),
            el("span", { class: "icons" }, [
              r.shut ? icon("shut", "closed") : null,
              REGIONS[k].air ? icon("plane", r.closedAir ? "closed" : "") : null,
              REGIONS[k].sea ? icon("boat", r.closedSea ? "closed" : "") : null,
              el("span", { class: "num", text: r.inf > 0 ? num(r.inf) : "—" }),
            ]),
          ],
        );
      });
    }

    function statBox(label, value, cls) {
      return el("div", { class: "stat" }, [
        el("div", { class: "label", text: label }),
        el("div", { class: `value num ${cls || ""}`, text: value }),
      ]);
    }

    function redraw() {
      const s = SIM.summary(app.state);
      const canvas = el("canvas", { "aria-label": "Infected, dead and cure progress over time" });
      const sortRow = el(
        "div",
        { class: "sort" },
        [
          ["inf", "Infected"],
          ["dead", "Dead"],
          ["pop", "Population"],
          ["name", "Name"],
        ].map(([id, label]) =>
          el("button", {
            text: label,
            "aria-pressed": sort === id,
            onclick: () => {
              sort = id;
              app.sort = id;
              redraw();
            },
          }),
        ),
      );
      body.replaceChildren(
        el("div", { class: "world-summary" }, [
          statBox("Infected", num(s.inf), "infected"),
          statBox("Dead", num(s.dead), "dead"),
          statBox("Healthy", num(s.healthy), "healthy"),
          statBox("Regions", `${s.countries}/${s.total}`),
          statBox("Cure", pct(s.cure), "cure-c"),
          statBox("Day", String(app.state.day)),
        ]),
        el("div", { class: "chart-box" }, [
          canvas,
          el("div", { class: "legend" }, [
            el("span", { html: '<i style="background:#e5402c"></i>Infected' }),
            el("span", { html: '<i style="background:#6b1f1a"></i>Dead' }),
            el("span", { html: '<i style="background:#3ea8f2"></i>Cure' }),
          ]),
        ]),
        sortRow,
        el("div", { class: "region-list" }, rows()),
      );
      requestAnimationFrame(() => chart(canvas, app.state));
    }

    redraw();
    return sheet("World", [body], () => app.closeSheet());
  }

  // --- end screen ------------------------------------------------------------
  function endScreen(app) {
    const s = SIM.summary(app.state);
    const won = app.state.over === "win";
    const titles = {
      win: "World ended",
      cured: "Cure found",
      dead: "Strain burned out",
    };
    // A cure that lands with almost nobody left deserves its own line.
    const nearMiss = app.state.over === "cured" && s.deadPct > 0.97;
    const lines = {
      win: `Every region fell. ${num(s.dead)} dead in ${app.state.day} days.`,
      cured: nearMiss
        ? `The cure landed on day ${app.state.day} with ${num(s.healthy)} people left alive. That close.`
        : `Labs finished the cure on day ${app.state.day}. ${num(s.dead)} dead, ${num(s.healthy)} still standing.`,
      dead: `The strain died out on day ${app.state.day} with ${num(s.dead)} dead. It never found a way to keep spreading.`,
    };
    return el("div", { class: "screen end" }, [
      el("div", { class: "screen-inner" }, [
        el("h2", { class: won ? "win" : "lose", text: titles[app.state.over] || "Game over" }),
        el("p", { class: "lede", text: lines[app.state.over] || "" }),
        el("div", { class: "world-summary" }, [
          el("div", { class: "stat" }, [
            el("div", { class: "label", text: "Dead" }),
            el("div", { class: "value num dead", text: num(s.dead) }),
          ]),
          el("div", { class: "stat" }, [
            el("div", { class: "label", text: "Survivors" }),
            el("div", { class: "value num healthy", text: num(s.healthy) }),
          ]),
          el("div", { class: "stat" }, [
            el("div", { class: "label", text: "Days" }),
            el("div", { class: "value num", text: String(app.state.day) }),
          ]),
          el("div", { class: "stat" }, [
            el("div", { class: "label", text: "Regions reached" }),
            el("div", { class: "value num", text: `${s.countries}/${s.total}` }),
          ]),
        ]),
        el("div", { class: "menu" }, [
          el("button", { class: "btn primary", text: "New strain", onclick: () => app.goSetup() }),
          el("button", { class: "btn", text: "Main menu", onclick: () => app.goTitle() }),
        ]),
      ]),
    ]);
  }

  window.PANELS = { el, num, pct, icon, sheet, evolutionSheet, worldSheet, endScreen };
})();
