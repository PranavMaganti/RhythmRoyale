// The shell: screens, HUD, the day loop, and saving.
(() => {
  const { el, num, pct, evolutionSheet, worldSheet, endScreen } = window.PANELS;
  const { REGIONS, DIFFICULTIES, STRAINS } = window.GAME;
  const SIM = window.SIM;
  const SAVE_KEY = "contagion-save-v1";

  const SPEED_MS = [0, 900, 340, 130];

  const root = document.getElementById("app");

  const store = {
    read() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    write(state) {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      } catch {
        /* private windows and full quotas are fine, the game just won't resume */
      }
    },
    clear() {
      try {
        localStorage.removeItem(SAVE_KEY);
      } catch {
        /* ignore */
      }
    },
  };

  const SVG = {
    pause:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
    ff: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 5.5v13l9-6.5zM13 5.5v13l9-6.5z"/></svg>',
    ffff: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 5.5v13l7-6.5zM9 5.5v13l7-6.5zM16 5.5v13l7-6.5z"/></svg>',
    dna: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M8 3c0 6 8 6 8 12M16 3c0 6-8 6-8 12M8 21c0-2 8-2 8-6"/><path d="M9.5 7h5M8.6 11h6.8M9.5 15.5h5"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    minus:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
  };

  function iconButton(svg, label, onclick, cls) {
    const b = el("button", { class: cls || "icon-btn", "aria-label": label, onclick });
    b.innerHTML = svg;
    return b;
  }

  // --- headlines -------------------------------------------------------------
  function headlines(state, events) {
    const out = [];
    for (const e of events) {
      const name = e.region ? REGIONS[e.region].name : "";
      if (e.kind === "spread") out.push(`First cases confirmed in ${name}.`);
      else if (e.kind === "seen") out.push(`${name} health service names the outbreak.`);
      else if (e.kind === "closedAir") out.push(`${name} grounds all passenger flights.`);
      else if (e.kind === "closedSea") out.push(`${name} closes its ports to arrivals.`);
      else if (e.kind === "shut") out.push(`${name} orders people to stay at home.`);
      else if (e.kind === "detected")
        out.push("Outbreak declared an international emergency. Cure research begins.");
    }
    if (!out.length && state.day % 30 === 0) {
      const s = SIM.summary(state);
      if (s.inf > 0) out.push(`Day ${state.day}: ${num(s.inf)} infected, ${num(s.dead)} dead.`);
    }
    return out;
  }

  // --- the app ---------------------------------------------------------------
  const app = {
    state: null,
    view: "title",
    speed: 1,
    sheet: null,
    selected: null,
    tab: "spread",
    sort: "inf",
    picking: false,
    mapView: null,
    queue: [],
    acc: 0,
    last: 0,

    // --- screens -----------------------------------------------------------
    goTitle() {
      this.view = "title";
      this.state = null;
      this.sheet = null;
      this.renderTitle();
    },

    renderTitle() {
      const saved = store.read();
      root.replaceChildren(
        el("div", { class: "screen" }, [
          el("div", { class: "screen-inner" }, [
            el("h1", { class: "logo" }, ["Con", el("span", { text: "tagion" })]),
            el("p", {
              class: "lede",
              text: "Start with one carrier. Spend research points on how your strain spreads, what it does, and what it shrugs off. Infect everyone before the labs finish the cure.",
            }),
            el("div", { class: "menu" }, [
              saved && !saved.over
                ? el("button", {
                    class: "btn primary",
                    text: `Resume day ${saved.day}`,
                    onclick: () => this.resume(saved),
                  })
                : null,
              el("button", {
                class: saved && !saved.over ? "btn" : "btn primary",
                text: "New strain",
                onclick: () => this.goSetup(),
              }),
              el("button", { class: "btn", text: "How to play", onclick: () => this.renderHelp() }),
            ]),
            el("p", {
              class: "small-print",
              text: "Regions are drawn from Natural Earth country shapes. Works offline once loaded; your game saves itself in this browser.",
            }),
          ]),
        ]),
      );
    },

    renderHelp() {
      const p = (t) => el("p", { class: "lede", text: t });
      root.replaceChildren(
        el("div", { class: "screen" }, [
          el("div", { class: "screen-inner setup" }, [
            el("h2", { text: "How to play" }),
            p("Tap a region to start. One carrier appears there and the clock begins."),
            p(
              "Research points build up as the outbreak spreads and as it alarms people. Orange bubbles on the map are worth extra — tap them before they fade.",
            ),
            p(
              "Spend points in Evolve. Spread traits move you between regions, Traits raise alarm and deaths, Shielding keeps you going in hostile climates and slows the cure.",
            ),
            p(
              "Being noticed early is the usual way to lose: regions close airports and ports, and wealthy ones fund the cure fastest. Stay quiet until you are everywhere, then turn up the severity.",
            ),
            p("Pinch or scroll to zoom the map, drag to pan. Arrow keys work too."),
            el("div", { class: "menu" }, [
              el("button", {
                class: "btn primary",
                text: "Back",
                onclick: () => this.renderTitle(),
              }),
            ]),
          ]),
        ]),
      );
    },

    goSetup() {
      this.view = "setup";
      let strain = "spore";
      let difficulty = "normal";
      let name = "Strain-7";

      const render = () => {
        const choiceList = (items, current, pick) =>
          el(
            "div",
            { class: "choices" },
            items.map((it) =>
              el(
                "button",
                {
                  class: "choice",
                  role: "radio",
                  "aria-checked": it.id === current,
                  onclick: () => pick(it.id),
                },
                [
                  el("b", { text: it.name }),
                  el("span", { text: it.blurb }),
                  it.note ? el("span", { class: "tag", text: it.note }) : null,
                ],
              ),
            ),
          );

        root.replaceChildren(
          el("div", { class: "screen" }, [
            el("div", { class: "screen-inner setup" }, [
              el("h2", { text: "New strain" }),
              el("h3", { text: "Name" }),
              el("div", { class: "field" }, [
                el("input", {
                  id: "strain-name",
                  value: name,
                  maxlength: "22",
                  "aria-label": "Strain name",
                  oninput: (e) => {
                    name = e.target.value;
                  },
                }),
              ]),
              el("h3", { text: "Strain" }),
              choiceList(STRAINS, strain, (id) => {
                strain = id;
                render();
              }),
              el("h3", { text: "Difficulty" }),
              choiceList(DIFFICULTIES, difficulty, (id) => {
                difficulty = id;
                render();
              }),
              el("div", { class: "menu" }, [
                el("button", {
                  class: "btn primary",
                  text: "Choose a starting region",
                  onclick: () =>
                    this.begin({ name: name.trim() || "Strain-7", strain, difficulty }),
                }),
                el("button", { class: "btn", text: "Back", onclick: () => this.renderTitle() }),
              ]),
            ]),
          ]),
        );
      };
      render();
    },

    begin(opts) {
      this.state = SIM.newState({
        ...opts,
        start: "china",
        seed: (Math.random() * 1e9) | 0,
      });
      // The real start is chosen on the map; clear the placeholder carrier.
      this.state.regions.china.inf = 0;
      this.picking = true;
      this.speed = 0;
      this.selected = null;
      this.queue = [];
      this.view = "game";
      this.renderGame();
    },

    resume(saved) {
      this.state = saved;
      this.picking = false;
      this.speed = 1;
      this.view = "game";
      this.queue = [];
      this.renderGame();
    },

    save() {
      if (this.state && !this.state.over) store.write(this.state);
    },

    // --- game screen -------------------------------------------------------
    renderGame() {
      const canvas = el("canvas", { id: "map", tabindex: "0", "aria-label": "World map" });
      this.els = {};

      this.els.hudSub = el("div", { class: "hud-sub", text: "Day 0" });
      this.els.dnaCount = el("span", { text: "0" });
      this.els.badge = el("span", { class: "count num", text: "0" });
      this.els.speed = el("div", { class: "speed", role: "group", "aria-label": "Speed" });
      const dnaIcon = el("span", { class: "dna-icon" });
      dnaIcon.innerHTML = SVG.dna;
      this.els.dna = el(
        "button",
        {
          class: "dna-chip num",
          "aria-label": "Research points, opens evolution",
          onclick: () => this.openSheet("evolve"),
        },
        [dnaIcon, this.els.dnaCount],
      );

      const hud = el("div", { class: "hud" }, [
        el("div", { class: "hud-title" }, [
          el("div", { class: "hud-name", text: this.state.name }),
          this.els.hudSub,
        ]),
        this.els.dna,
        this.els.speed,
        iconButton(SVG.menu, "Menu", () => this.openMenu()),
      ]);

      const zoom = el("div", { class: "zoom" }, [
        iconButton(SVG.plus, "Zoom in", () => this.mapView.zoomBy(1.3)),
        iconButton(SVG.minus, "Zoom out", () => this.mapView.zoomBy(0.77)),
      ]);

      this.els.hint = el("div", { class: "pick-hint", text: "Tap a region to release it" });
      this.els.card = el("div", { class: "region-card", hidden: true });
      this.els.toasts = el("div", { class: "toast-stack", "aria-live": "polite" });

      const mapWrap = el("div", { class: "map-wrap" }, [
        canvas,
        zoom,
        this.els.hint,
        this.els.card,
        this.els.toasts,
      ]);

      this.els.headline = el("div", { class: "headline", text: "Pick where it starts." });
      const ticker = el("div", { class: "ticker" }, [
        el("span", { class: "badge", text: "LIVE" }),
        this.els.headline,
      ]);

      this.els.status = el("div", { class: "world-status" });
      const cmdbar = el("div", { class: "cmdbar" }, [
        el(
          "button",
          { class: "cmd primary", id: "btn-disease", onclick: () => this.openSheet("evolve") },
          ["Evolve", this.els.badge],
        ),
        this.els.status,
        el("button", {
          class: "cmd",
          id: "btn-world",
          text: "World",
          onclick: () => this.openSheet("world"),
        }),
      ]);

      root.replaceChildren(el("div", { class: "game" }, [hud, mapWrap, ticker, cmdbar]));

      this.mapView = new window.MapView(canvas, {
        onPick: (key) => {
          if (!key) return;
          if (this.picking) this.releaseAt(key);
          else this.selectRegion(key);
        },
        onBubble: (b) => this.popBubble(b),
      });
      this.mapView.setState(this.state);
      if (!this.picking) {
        this.mapView.focus(this.state.startKey);
      }
      this.els.hint.hidden = !this.picking;

      if (!this.resizeBound) {
        window.addEventListener("resize", () => this.mapView?.resize(false));
        window.addEventListener("orientationchange", () => {
          setTimeout(() => this.mapView?.resize(false), 250);
        });
        this.resizeBound = true;
      }

      this.buildSpeeds();
      this.buildStatus();
      this.refreshHud();
      canvas.focus({ preventScroll: true });
    },

    releaseAt(key) {
      this.picking = false;
      this.state.startKey = key;
      this.state.regions[key].inf = 1;
      this.els.hint.hidden = true;
      this.speed = 1;
      this.mapView.focus(key);
      this.toast(`Carrier released in ${REGIONS[key].name}.`, "red");
      this.selectRegion(key);
      this.save();
      this.refreshHud();
    },

    selectRegion(key, focus) {
      this.selected = key;
      this.mapView.select(key);
      if (focus) this.mapView.focus(key);
      this.cardTagStamp = null;
      this.buildCard();
    },

    clearSelection() {
      this.selected = null;
      this.mapView.select(null);
      this.els.card.hidden = true;
      this.cardEls = null;
    },

    // Built once when a region is picked; refreshHud only rewrites the numbers.
    buildCard() {
      const k = this.selected;
      const card = this.els.card;
      if (!k) {
        card.hidden = true;
        return;
      }
      const info = REGIONS[k];
      const c = {};
      c.tags = el("div", { class: "tags" });
      c.healthy = el("div", { class: "value num healthy", text: "0" });
      c.inf = el("div", { class: "value num infected", text: "0" });
      c.dead = el("div", { class: "value num dead", text: "0" });
      c.barDead = el("span", { class: "b-dead", style: "width:0%" });
      c.barInf = el("span", { class: "b-inf", style: "width:0%" });
      card.replaceChildren(
        el("header", {}, [
          el("h2", { text: info.name }),
          el("button", {
            class: "close",
            "aria-label": "Close region",
            text: "✕",
            onclick: () => this.clearSelection(),
          }),
        ]),
        c.tags,
        el("div", { class: "pop-row" }, [
          el("div", { class: "stat" }, [el("div", { class: "label", text: "Healthy" }), c.healthy]),
          el("div", { class: "stat" }, [el("div", { class: "label", text: "Infected" }), c.inf]),
          el("div", { class: "stat" }, [el("div", { class: "label", text: "Dead" }), c.dead]),
        ]),
        el("div", { class: "bar" }, [c.barDead, c.barInf]),
      );
      this.cardEls = c;
      card.hidden = false;
      this.updateCard();
    },

    updateCard() {
      const k = this.selected;
      const c = this.cardEls;
      if (!k || !c) return;
      const info = REGIONS[k];
      const reg = this.state.regions[k];
      const live = Math.max(0, reg.pop - reg.dead);
      c.healthy.textContent = num(live - reg.inf);
      c.inf.textContent = num(reg.inf);
      c.dead.textContent = num(reg.dead);
      c.barDead.style.width = `${(reg.dead / reg.pop) * 100}%`;
      c.barInf.style.width = `${(reg.inf / reg.pop) * 100}%`;

      // Tags only change on an event, so rewrite them when the wording would.
      const tags = [];
      if (reg.shut) tags.push(["closed", "Lockdown"]);
      if (info.air)
        tags.push([
          reg.closedAir ? "closed" : "open",
          reg.closedAir ? "Airports shut" : "Airports open",
        ]);
      if (info.sea)
        tags.push([reg.closedSea ? "closed" : "open", reg.closedSea ? "Ports shut" : "Ports open"]);
      if (!reg.seen && reg.inf > 0) tags.push(["", "Undetected"]);
      const stamp = tags.map((t) => t[1]).join("|");
      if (stamp !== this.cardTagStamp) {
        this.cardTagStamp = stamp;
        c.tags.replaceChildren(
          ...tags.map(([cls, text]) => el("span", { class: `tag ${cls}`, text })),
        );
      }
    },

    // --- HUD ---------------------------------------------------------------
    // The speed buttons are built once and only have their pressed state
    // updated: rebuilding them each day would swallow taps mid-press.
    buildSpeeds() {
      // A phone has no room for four speeds, so it gets pause, play, fast.
      const narrow = window.innerWidth < 430;
      if (this.speedsNarrow === narrow && this.els.speedButtons) return;
      this.speedsNarrow = narrow;
      const speeds = narrow
        ? [
            [0, SVG.pause, "Pause"],
            [1, SVG.play, "Normal speed"],
            [3, SVG.ffff, "Fast"],
          ]
        : [
            [0, SVG.pause, "Pause"],
            [1, SVG.play, "Normal speed"],
            [2, SVG.ff, "Fast"],
            [3, SVG.ffff, "Fastest"],
          ];
      this.els.speedButtons = speeds.map(([v, svg, label]) => {
        const b = iconButton(
          svg,
          label,
          () => {
            this.speed = v;
            this.syncSpeeds();
          },
          "",
        );
        b.dataset.speed = String(v);
        return b;
      });
      this.els.speed.replaceChildren(...this.els.speedButtons);
      this.syncSpeeds();
    },

    syncSpeeds() {
      for (const b of this.els.speedButtons || []) {
        b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === this.speed));
      }
    },

    buildStatus() {
      this.els.infCount = el("b", { class: "num infected", text: "0" });
      this.els.deadCount = el("b", { class: "num dead", text: "0" });
      this.els.cureFill = el("span", { class: "b-cure", style: "width:0%" });
      this.els.curePct = el("span", { class: "num", text: "0%" });
      this.els.status.replaceChildren(
        el("div", { class: "status-line" }, [
          el("span", {}, [this.els.infCount, " infected"]),
          el("span", {}, [this.els.deadCount, " dead"]),
        ]),
        el("div", { class: "cure-line" }, [
          el("span", { text: "Cure" }),
          el("span", { class: "bar" }, [this.els.cureFill]),
          this.els.curePct,
        ]),
      );
    },

    refreshHud() {
      if (this.view !== "game" || !this.els) return;
      const s = SIM.summary(this.state);
      // "regions" does not fit beside the speed controls on a phone.
      this.els.hudSub.textContent = this.picking
        ? "Choose a starting region"
        : `Day ${this.state.day} · ${s.countries}/${s.total}${this.speedsNarrow ? "" : " regions"}`;
      this.els.dnaCount.textContent = String(Math.floor(this.state.points));

      const affordable = window.GAME.TRAIT_LIST.filter(
        (t) => SIM.canEvolve(this.state, t) === "ok",
      ).length;
      this.els.badge.textContent = String(affordable);
      this.els.badge.hidden = affordable === 0;

      this.buildSpeeds();
      this.syncSpeeds();

      this.els.infCount.textContent = num(s.inf);
      this.els.deadCount.textContent = num(s.dead);
      this.els.cureFill.style.width = `${s.cure * 100}%`;
      this.els.curePct.textContent = pct(s.cure, 0);

      if (this.selected) this.updateCard();
    },

    bumpDna() {
      if (!this.els?.dna) return;
      this.els.dna.classList.remove("bump");
      void this.els.dna.offsetWidth;
      this.els.dna.classList.add("bump");
    },

    toast(text, kind) {
      if (!this.els?.toasts) return;
      const t = el("div", { class: `toast ${kind || ""}`, text });
      this.els.toasts.appendChild(t);
      const cap = window.innerWidth < 430 ? 2 : 3;
      while (this.els.toasts.children.length > cap) this.els.toasts.firstChild.remove();
      setTimeout(() => t.remove(), 4200);
    },

    popBubble(b) {
      const i = this.state.bubbles.indexOf(b);
      if (i < 0) return;
      this.state.bubbles.splice(i, 1);
      this.state.points += b.value;
      this.bumpDna();
      this.refreshHud();
      this.save();
    },

    // --- sheets ------------------------------------------------------------
    openSheet(which) {
      this.closeSheet();
      this.resumeSpeed = this.speed;
      this.speed = 0;
      const node = which === "evolve" ? evolutionSheet(this) : worldSheet(this);
      this.sheet = node;
      document.body.appendChild(node);
      this.refreshHud();
      this.escHandler = (e) => {
        if (e.key === "Escape") this.closeSheet();
      };
      window.addEventListener("keydown", this.escHandler);
    },

    closeSheet() {
      if (this.sheet) {
        this.sheet.remove();
        this.sheet = null;
        if (this.resumeSpeed !== undefined) this.speed = this.resumeSpeed;
        this.resumeSpeed = undefined;
      }
      if (this.escHandler) {
        window.removeEventListener("keydown", this.escHandler);
        this.escHandler = null;
      }
      this.refreshHud();
    },

    openMenu() {
      this.closeSheet();
      const body = el("div", { class: "sheet-body" }, [
        el("div", { class: "menu" }, [
          el("button", {
            class: "btn",
            text: "How to play",
            onclick: () => {
              this.closeSheet();
              this.renderHelp();
            },
          }),
          el("button", {
            class: "btn",
            text: "Abandon and start over",
            onclick: () => {
              store.clear();
              this.closeSheet();
              this.goSetup();
            },
          }),
          el("button", {
            class: "btn",
            text: "Main menu",
            onclick: () => {
              this.save();
              this.closeSheet();
              this.goTitle();
            },
          }),
        ]),
      ]);
      const node = window.PANELS.sheet("Menu", [body], () => this.closeSheet());
      this.sheet = node;
      this.resumeSpeed = this.speed;
      this.speed = 0;
      document.body.appendChild(node);
    },

    // --- loop --------------------------------------------------------------
    advance() {
      const state = this.state;
      SIM.step(state);
      for (const line of headlines(state, state.news)) this.queue.push(line);
      for (const e of state.news) {
        if (e.kind === "detected")
          this.toast("The outbreak has been detected. Cure research begins.", "blue");
        else if (e.kind === "closedAir")
          this.toast(`${REGIONS[e.region].name} shuts its airports.`, "red");
        else if (e.kind === "shut")
          this.toast(`${REGIONS[e.region].name} goes into lockdown.`, "red");
      }
      if (state.day % 10 === 0) this.save();
      if (state.over) {
        store.clear();
        this.view = "end";
        this.speed = 0;
        root.appendChild(endScreen(this));
      }
      this.refreshHud();
    },

    pumpTicker(now) {
      if (!this.els?.headline) return;
      if (now - (this.lastHeadline || 0) < 2600) return;
      const next = this.queue.shift();
      if (!next) return;
      this.lastHeadline = now;
      this.els.headline.textContent = next;
      this.els.headline.classList.remove("fresh");
      void this.els.headline.offsetWidth;
      this.els.headline.classList.add("fresh");
      if (this.queue.length > 30) this.queue = this.queue.slice(-15);
    },

    frame(now) {
      requestAnimationFrame((t) => this.frame(t));
      if (this.view !== "game" && this.view !== "end") return;
      if (!this.mapView) return;

      const dt = Math.min(250, now - (this.last || now));
      this.last = now;
      if (this.speed > 0 && !this.picking && this.state && !this.state.over) {
        this.acc += dt;
        const per = SPEED_MS[this.speed];
        let guard = 0;
        while (this.acc >= per && guard++ < 6) {
          this.acc -= per;
          this.advance();
        }
      }
      this.pumpTicker(now);
      this.mapView.setState(this.state);
      this.mapView.tick(now);
    },
  };

  window.APP = app;
  app.goTitle();
  requestAnimationFrame((t) => {
    app.last = t;
    app.frame(t);
  });
})();
