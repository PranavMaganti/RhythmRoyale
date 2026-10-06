// The simulation: one step per day. Pure state in, new state out, no DOM.
(() => {
  const { REGIONS, TRAIT_BY_ID, DIFFICULTIES, STRAINS } = window.GAME;
  const KEYS = Object.keys(REGIONS);
  const MAP = window.PLAGUE_MAP;

  // Land borders, as a lookup from region key to neighbour keys.
  const BORDERS = {};
  for (const k of KEYS) BORDERS[k] = [];
  for (const pair of MAP.borders) {
    const [a, b] = pair.split("-");
    if (BORDERS[a] && BORDERS[b]) {
      BORDERS[a].push(b);
      BORDERS[b].push(a);
    }
  }

  const STAT_KEYS = [
    "spread",
    "heat",
    "cold",
    "damp",
    "dry",
    "poor",
    "rich",
    "plane",
    "boat",
    "notice",
    "severity",
    "lethal",
    "resist",
  ];

  // A tiny seeded generator, so a seed replays the same game.
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      return s / 4294967296;
    };
  }

  function newState(opts) {
    const diff = DIFFICULTIES.find((d) => d.id === opts.difficulty) || DIFFICULTIES[1];
    const strain = STRAINS.find((s) => s.id === opts.strain) || STRAINS[0];
    const regions = {};
    for (const k of KEYS) {
      const r = REGIONS[k];
      regions[k] = {
        key: k,
        pop: r.pop * 1e6,
        inf: 0,
        dead: 0,
        seen: false, // the region knows it is here
        closedAir: false,
        closedSea: false,
        shut: false, // internal lockdown, slows local spread
      };
    }
    const start = regions[opts.start];
    start.inf = 200;

    return {
      seed: opts.seed >>> 0 || 1,
      rollCount: 0,
      name: opts.name || "Unnamed",
      difficulty: diff.id,
      strain: strain.id,
      startKey: opts.start,
      day: 0,
      points: 10,
      spent: 0,
      traits: [],
      regions,
      detected: false,
      detectDay: null,
      cure: 0, // 0..1
      cureSpeed: 0,
      over: null, // "win" | "lost" | null
      bubbles: [],
      news: [],
      history: [], // [day, infected, dead, cure] samples for the graph
      eradicatedWarned: false,
    };
  }

  // Stats ---------------------------------------------------------------------
  function stats(state) {
    const strain = STRAINS.find((s) => s.id === state.strain) || STRAINS[0];
    const out = {};
    for (const k of STAT_KEYS) out[k] = 0;
    for (const [k, v] of Object.entries(strain.fx)) out[k] += v;
    for (const id of state.traits) {
      const t = TRAIT_BY_ID[id];
      if (!t) continue;
      for (const [k, v] of Object.entries(t.fx)) out[k] += v;
    }
    return out;
  }

  function traitCost(state, trait) {
    const strain = STRAINS.find((s) => s.id === state.strain) || STRAINS[0];
    let cost = trait.cost;
    if (trait.tab === "shield" && strain.shieldDiscount) {
      cost = Math.round(cost * (1 - strain.shieldDiscount));
    }
    return cost;
  }

  function canEvolve(state, trait) {
    if (state.traits.includes(trait.id)) return "owned";
    if (!trait.needs.every((n) => state.traits.includes(n))) return "locked";
    if (state.points < traitCost(state, trait)) return "poor";
    return "ok";
  }

  function evolve(state, id) {
    const t = TRAIT_BY_ID[id];
    if (!t || canEvolve(state, t) !== "ok") return false;
    const cost = traitCost(state, t);
    state.points -= cost;
    state.spent += cost;
    state.traits.push(id);
    return true;
  }

  // Refunding a trait costs a surcharge, and only if nothing depends on it.
  function refundable(state, id) {
    if (!state.traits.includes(id)) return false;
    return !state.traits.some((other) => {
      const t = TRAIT_BY_ID[other];
      return !!t?.needs.includes(id);
    });
  }

  function refundCost(state, id) {
    return Math.max(2, Math.round(traitCost(state, TRAIT_BY_ID[id]) * 0.3));
  }

  function refund(state, id) {
    if (!refundable(state, id) || state.points < refundCost(state, id)) return false;
    state.points -= refundCost(state, id);
    state.traits = state.traits.filter((t) => t !== id);
    return true;
  }

  // Per-region spread multiplier. Climate, wealth and crowding each hold the
  // pathogen back; a shielding trait buys that penalty off.
  const left = (x) => Math.max(0, 1 - Math.max(0, x));

  function regionFactor(st, r, reg) {
    let m = 1 + st.spread;
    m *= Math.max(0.18, 1 - 0.42 * r.heat * left(st.heat) - 0.42 * r.cold * left(st.cold));
    m *= Math.max(0.25, 1 - 0.3 * r.damp * left(st.damp) - 0.3 * r.dry * left(st.dry));
    m *= Math.max(0.2, 1 - 0.5 * r.wealth * left(st.rich) + 0.3 * (1 - r.wealth) * st.poor);
    m *= 0.6 + 0.8 * r.urban;
    if (reg.shut) m *= 0.4;
    return Math.max(0, m);
  }

  const alive = (reg) => Math.max(0, reg.pop - reg.dead);
  const healthy = (reg) => Math.max(0, reg.pop - reg.dead - reg.inf);
  const infectedCount = (s) => KEYS.reduce((a, k) => a + s.regions[k].inf, 0);
  const deadCount = (s) => KEYS.reduce((a, k) => a + s.regions[k].dead, 0);
  const worldPop = (s) => KEYS.reduce((a, k) => a + s.regions[k].pop, 0);

  function step(state) {
    if (state.over) return state;
    const diff = DIFFICULTIES.find((d) => d.id === state.difficulty) || DIFFICULTIES[1];
    const strain = STRAINS.find((s) => s.id === state.strain) || STRAINS[0];
    const st = stats(state);
    const rand = rng(state.seed + state.day * 2654435761);
    state.day += 1;

    const events = [];
    const hygiene = diff.hygiene;
    const resist = 1 / (1 + Math.max(0, st.resist));

    // 1. Local growth and deaths.
    for (const k of KEYS) {
      const reg = state.regions[k];
      const r = REGIONS[k];
      if (reg.inf <= 0) continue;
      const h = healthy(reg);
      const a = alive(reg);
      if (a <= 0) continue;

      const base = (0.55 * regionFactor(st, r, reg)) / hygiene;
      // Awareness of the pathogen locally dampens spread over time.
      const aware = reg.seen ? 0.7 : 1;
      let add = reg.inf * base * (h / a) * aware;
      // A single carrier still has to get going.
      if (reg.inf < 2) add = Math.min(add, 0.6);
      reg.inf = Math.min(a, reg.inf + add);

      const deaths = reg.inf * Math.max(0, st.lethal);
      if (deaths > 0) {
        const d = Math.min(reg.inf, deaths);
        reg.inf -= d;
        reg.dead += d;
      }
      if (reg.inf < 0.5 && add < 0.01) {
        if (healthy(reg) <= 1) reg.dead = reg.pop;
        reg.inf = 0;
      }
    }

    // 2. Travel between regions.
    for (const k of KEYS) {
      const from = state.regions[k];
      if (from.inf < 1) continue;
      const fromR = REGIONS[k];
      // How much this region exports: partly the share of people carrying it,
      // partly the sheer number of them, so a huge country still travels.
      const share = from.inf / Math.max(1, alive(from));
      const pressure = Math.min(1, share * 2 + from.inf / 4e7);

      // Smuggling and exemptions: nothing is ever sealed, and a strain built for
      // a route slips through a closed one more often.
      const airLeak = 0.06 + 0.14 * Math.max(0, st.plane);
      const seaLeak = 0.06 + 0.14 * Math.max(0, st.boat);
      const tryCarry = (toKey, chance) => {
        const to = state.regions[toKey];
        if (to.inf > 0 || healthy(to) <= 0) return;
        if (rand() < chance) {
          to.inf = 1;
          events.push({ kind: "spread", region: toKey });
        }
      };

      for (const n of BORDERS[k]) {
        const to = state.regions[n];
        const blocked = from.shut || to.shut;
        tryCarry(n, pressure * 0.5 * (blocked ? 0.2 : 1));
      }
      if (fromR.air) {
        for (const n of KEYS) {
          if (n === k || !REGIONS[n].air) continue;
          const shut = from.closedAir || state.regions[n].closedAir;
          tryCarry(n, pressure * 0.03 * (1 + st.plane) * (shut ? airLeak : 1));
        }
      }
      if (fromR.sea) {
        for (const n of KEYS) {
          if (n === k || !REGIONS[n].sea) continue;
          const shut = from.closedSea || state.regions[n].closedSea;
          tryCarry(n, pressure * 0.022 * (1 + st.boat) * (shut ? seaLeak : 1));
        }
      }
    }

    // 3. Being noticed, locally and then globally.
    const totalInf = infectedCount(state);
    for (const k of KEYS) {
      const reg = state.regions[k];
      if (reg.seen || reg.inf <= 0) continue;
      const frac = reg.inf / Math.max(1, alive(reg));
      const threshold = 0.0012 / (1 + Math.max(0, st.notice) * 4 + (REGIONS[k].jumpy ? 1 : 0));
      if (frac > threshold || reg.inf > 5e4) {
        reg.seen = true;
        events.push({ kind: "seen", region: k });
      }
    }
    if (!state.detected) {
      const seenCount = KEYS.filter((k) => state.regions[k].seen).length;
      if (seenCount >= 1 && totalInf > 2e5 * (1 + Math.max(0, -st.notice) * 6)) {
        state.detected = true;
        state.detectDay = state.day;
        events.push({ kind: "detected" });
      }
    }

    // 4. Government responses: closing borders, then shutting down inside.
    for (const k of KEYS) {
      const reg = state.regions[k];
      const r = REGIONS[k];
      if (!reg.seen && !state.detected) continue;
      const frac = reg.inf / Math.max(1, alive(reg));
      const eager = (0.35 + r.wealth) * (r.jumpy ? 2.2 : 1) * hygiene;
      if (
        r.air &&
        !reg.closedAir &&
        (reg.seen ? frac > 0.05 / eager : state.detected && rand() < 0.004 * eager)
      ) {
        reg.closedAir = true;
        events.push({ kind: "closedAir", region: k });
      }
      if (
        r.sea &&
        !reg.closedSea &&
        (reg.seen ? frac > 0.08 / eager : state.detected && rand() < 0.003 * eager)
      ) {
        reg.closedSea = true;
        events.push({ kind: "closedSea", region: k });
      }
      if (!reg.shut && reg.seen && frac > 0.18 / eager) {
        reg.shut = true;
        events.push({ kind: "shut", region: k });
      }
    }

    // 5. Cure research, funded by the healthy and wealthy.
    if (state.detected) {
      const delay = strain.cureDelay ? Math.round(60 * strain.cureDelay) : 0;
      if (state.day - state.detectDay >= delay) {
        let effort = 0;
        for (const k of KEYS) {
          const reg = state.regions[k];
          const r = REGIONS[k];
          const share = 0.3 + 0.7 * (healthy(reg) / Math.max(1, reg.pop));
          effort += r.wealth * r.wealth * (r.pop / 1000) * share;
        }
        // Alarm pulls funding in.
        const urgency = 1 + Math.min(3, Math.max(0, st.severity) * 0.12);
        state.cureSpeed = effort * 0.0014 * diff.cureRate * urgency * resist;
        state.cure = Math.min(1, state.cure + state.cureSpeed);
      }
    }

    // 6. Research points: alarm and new cases pay out, plus bubbles to tap.
    const sevGain = Math.min(4, 0.3 + Math.max(0, st.severity) * 0.09);
    state.points += sevGain * 0.32 * diff.pointBonus;
    for (const e of events) {
      if (e.kind === "spread" && state.bubbles.length < 14) {
        state.bubbles.push({
          id: `${state.day}-${e.region}`,
          region: e.region,
          value: Math.round((3 + rand() * 3) * diff.pointBonus),
          born: state.day,
        });
      }
    }
    state.bubbles = state.bubbles.filter((b) => state.day - b.born < 45);

    // 7. Record and check for an ending.
    if (state.day % 2 === 0 || state.day < 10) {
      state.history.push([state.day, infectedCount(state), deadCount(state), state.cure]);
      if (state.history.length > 600) state.history = state.history.filter((_, i) => i % 2 === 0);
    }
    const dead = deadCount(state);
    const inf = infectedCount(state);
    const pop = worldPop(state);
    const stillHealthy = pop - inf - dead;
    if (state.cure >= 1) state.over = "cured";
    else if (stillHealthy <= pop * 1e-7 && inf <= 0) state.over = "win";
    else if (inf <= 0) state.over = "dead";

    state.news = events;
    return state;
  }

  function summary(state) {
    const pop = worldPop(state);
    const inf = infectedCount(state);
    const dead = deadCount(state);
    return {
      pop,
      inf,
      dead,
      healthy: pop - inf - dead,
      infPct: inf / pop,
      deadPct: dead / pop,
      cure: state.cure,
      countries: KEYS.filter((k) => state.regions[k].inf > 0).length,
      total: KEYS.length,
    };
  }

  window.SIM = {
    KEYS,
    BORDERS,
    newState,
    step,
    stats,
    statKeys: STAT_KEYS,
    canEvolve,
    evolve,
    traitCost,
    refundable,
    refundCost,
    refund,
    summary,
    healthy,
    alive,
    rng,
  };
})();
