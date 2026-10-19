"use strict";

/* Homepage behaviour. Every inspector and terminal value comes from
   assets/demo-data.js, generated from real package runs; nothing here
   computes, verifies or invents an outcome. */
(() => {
  const root = document.documentElement;
  const data = window.CONSEQUA_DEMO;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const SVG = "http://www.w3.org/2000/svg";

  const svg = (name, attributes = {}, parent) => {
    const element = document.createElementNS(SVG, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    if (parent) parent.appendChild(element);
    return element;
  };
  const html = (name, className, text, parent) => {
    const element = document.createElement(name);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    if (parent) parent.appendChild(element);
    return element;
  };
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");

  /* Header, menu and scroll reveals */
  const header = document.querySelector("[data-header]");
  if (header) {
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }
  const menuButton = document.querySelector(".menu-toggle");
  const navigation = document.querySelector("#primary-nav");
  if (menuButton && navigation) {
    const setOpen = (open) => {
      menuButton.setAttribute("aria-expanded", String(open));
      navigation.classList.toggle("is-open", open);
    };
    menuButton.addEventListener("click", () => setOpen(menuButton.getAttribute("aria-expanded") !== "true"));
    navigation.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setOpen(false)));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
        setOpen(false);
        menuButton.focus();
      }
    });
    document.addEventListener("click", (event) => {
      if (!navigation.contains(event.target) && !menuButton.contains(event.target)) setOpen(false);
    });
  }

  if (!reducedMotion.matches && "IntersectionObserver" in window) {
    const reveals = [...document.querySelectorAll(".reveal")];
    // Elements already on screen stay visible, so nothing flashes on load.
    reveals.forEach((element) => {
      if (element.getBoundingClientRect().top < window.innerHeight) element.classList.add("is-visible");
    });
    root.classList.add("motion-ok");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    reveals.filter((element) => !element.classList.contains("is-visible"))
      .forEach((element) => observer.observe(element));
  }

  if (data) {
    document.querySelectorAll("[data-version]").forEach((element) => { element.textContent = data.package_version; });
    document.querySelectorAll("[data-report-hash]").forEach((element) => { element.textContent = data.report.sha256.slice(0, 12) + "…"; });
  }

  /* Evidence inspector: replays recorded times from real traces. */
  const inspector = document.querySelector("[data-inspector]");
  if (inspector && data && data.scenarios) {
    const tabs = [...inspector.querySelectorAll('[role="tab"]')];
    const panel = inspector.querySelector('[role="tabpanel"]');
    const historyList = inspector.querySelector("[data-history]");
    const historyCount = inspector.querySelector("[data-history-count]");
    const ribbonHost = inspector.querySelector("[data-ribbon]");
    const graph = inspector.querySelector("[data-graph]");
    const graphCount = inspector.querySelector("[data-graph-count]");
    const verdict = inspector.querySelector("[data-verdict]");
    const fileLabel = inspector.querySelector("[data-file]");
    const playButton = inspector.querySelector("[data-play]");
    const playIcon = inspector.querySelector("[data-play-icon]");
    const replayButton = inspector.querySelector("[data-replay]");
    const scrub = inspector.querySelector("[data-scrub]");
    const clock = inspector.querySelector("[data-clock]");
    const HOLD = 320;
    let state = null;
    let playing = false;
    let frame = 0;
    let last = 0;
    let started = false;

    const tone = (verification) => {
      if (!verification) return "pending";
      if (verification.status === "satisfied" && verification.origin === "other_actor") return "other_actor";
      return verification.status;
    };

    const buildKeyframes = (stops) => {
      const frames = [{ p: 0, t: stops[0] }, { p: HOLD, t: stops[0] }];
      let p = HOLD;
      for (let index = 1; index < stops.length; index += 1) {
        const gap = stops[index] - stops[index - 1];
        p += Math.min(1300, Math.max(420, 380 + gap * 7));
        frames.push({ p, t: stops[index], move: true });
        p += index === stops.length - 1 ? 0 : HOLD;
        frames.push({ p, t: stops[index] });
      }
      return frames;
    };
    const timeAt = (frames, p) => {
      for (let index = 1; index < frames.length; index += 1) {
        const a = frames[index - 1];
        const b = frames[index];
        if (p <= b.p) {
          if (b.p === a.p) return b.t;
          const x = (p - a.p) / (b.p - a.p);
          return a.t + (b.t - a.t) * (b.move ? easeInOut(x) : x);
        }
      }
      return frames[frames.length - 1].t;
    };

    const renderHistory = (scenario) => {
      historyList.replaceChildren();
      scenario.timeline.forEach((entry) => {
        const item = html("li", "", undefined, historyList);
        item.dataset.t = entry.t;
        item.dataset.kind = entry.kind;
        if (entry.tone) item.dataset.tone = entry.tone;
        const time = entry.t_end !== undefined && entry.t_end !== entry.t ? `${entry.t}–${entry.t_end} ms` : `${entry.t} ms`;
        html("span", "h-time", time, item);
        html("strong", "", entry.label, item);
        html("p", "", entry.detail, item);
      });
      historyCount.textContent = `${scenario.timeline.length} entries`;
    };

    const renderRibbon = (scenario) => {
      const r = scenario.ribbon;
      const last = r.observations.length ? r.observations[r.observations.length - 1].observed_ms : r.horizon_ms;
      const raw = Math.max(r.horizon_ms, last) * 1.1;
      const step = raw > 120 ? 50 : 25;
      const axisMax = Math.ceil(raw / step) * step;
      // Draw at the container's own pixel width so labels keep a constant size.
      const width = Math.max(320, Math.round(ribbonHost.clientWidth || 600));
      const left = width < 420 ? 78 : 92;
      const right = 16;
      const x = (t) => left + ((width - left - right) * t) / axisMax;
      const rowY = { contract: 28, effects: 62 };
      r.observations.forEach((_, index) => { rowY[`read${index}`] = 96 + index * 34; });
      const bottom = 96 + r.observations.length * 34 + 6;
      const height = bottom + 26;
      ribbonHost.replaceChildren();
      const canvas = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `Contract window from ${r.registered_ms} to ${r.horizon_ms} ms with ${r.observations.length} readback watermark${r.observations.length === 1 ? "" : "s"}` }, ribbonHost);
      const label = (text, y) => svg("text", { x: 0, y: y + 4, class: "rb-row-label" }, canvas).textContent = text;
      label("CONTRACT", rowY.contract);
      label("EFFECTS", rowY.effects);
      r.observations.forEach((observation, index) => label(observation.label || `READBACK ${index + 1}`, rowY[`read${index}`]));
      svg("rect", { x: x(r.registered_ms), y: rowY.contract - 9, width: Math.max(2, x(r.deadline_ms) - x(r.registered_ms)), height: 18, rx: 5, class: "rb-window" }, canvas);
      if (r.stability_ms) svg("rect", { x: x(r.deadline_ms), y: rowY.contract - 9, width: x(r.horizon_ms) - x(r.deadline_ms), height: 18, rx: 5, class: "rb-window", opacity: 0.5 }, canvas);
      const count = r.composition || (r.exact_count === null ? "at least one refund" : `exactly ${r.exact_count} refund${r.exact_count === 1 ? "" : "s"}`);
      // Centre the window label when it fits; otherwise start it at the window so it never
      // runs into the row label.
      const windowText = `${count} · ${r.registered_ms}–${r.deadline_ms} ms`;
      const windowFits = windowText.length * 6.5 + 8 <= x(r.deadline_ms) - x(r.registered_ms);
      svg("text", { x: windowFits ? (x(r.registered_ms) + x(r.deadline_ms)) / 2 : Math.min(x(r.registered_ms) + 6, width - windowText.length * 6.5), y: rowY.contract + 4, "text-anchor": windowFits ? "middle" : "start", class: "rb-label" }, canvas).textContent = windowText;
      // Keep every label inside the drawing: flip it left of its anchor when it would overflow.
      const place = (anchor, text, attributes, parent) => {
        const fits = anchor + 8 + text.length * 6.5 <= width;
        const node = svg("text", { ...attributes, x: fits ? anchor + 8 : anchor - 8, "text-anchor": fits ? "start" : "end" }, parent);
        node.textContent = text;
        return node;
      };
      svg("line", { x1: x(r.horizon_ms), x2: x(r.horizon_ms), y1: 10, y2: bottom, class: "rb-horizon" }, canvas);
      place(x(r.horizon_ms), `horizon ${r.horizon_ms} ms`, { y: 12, class: "rb-horizon-label" }, canvas);
      const drawn = new Set();
      r.observations.forEach((observation, index) => {
        const group = svg("g", { class: "rb-group", "data-at": observation.observed_ms }, canvas);
        observation.effects.forEach((effect) => {
          const key = `${effect.committed_ms}:${effect.actor}`;
          const cx = x(effect.committed_ms);
          svg("path", { d: `M${cx} ${rowY.effects - 7}L${cx + 7} ${rowY.effects}L${cx} ${rowY.effects + 7}L${cx - 7} ${rowY.effects}Z`, class: `rb-effect ${effect.actor}` }, group);
          if (!drawn.has(key)) {
            drawn.add(key);
            const who = effect.actor === "agent" ? "this agent" : effect.actor === "other" ? "another actor" : "actor not recorded";
            place(cx + 5, `committed ${effect.committed_ms} ms · ${who}`, { y: rowY.effects + 4, class: "rb-label" }, group);
          }
        });
        const y = rowY[`read${index}`];
        const kind = observation.covers_horizon ? "covers" : "short";
        svg("rect", { x: x(0), y: y - 6, width: Math.max(2, x(observation.watermark_ms) - x(0)), height: 12, rx: 4, class: `rb-bar ${kind}` }, group);
        const verdictText = observation.covers_horizon ? "covers horizon" : "before horizon";
        const text = `watermark ${observation.watermark_ms} ms · ${verdictText}`;
        // Beside the bar when there is room and the label crosses neither the horizon line nor
        // this readback's own dot; otherwise above the bar's start.
        const start = x(observation.watermark_ms);
        const end = start + 8 + text.length * 6.5;
        const crosses = (at) => at > start && at < end + 4;
        const fitsRight = end <= width && !crosses(x(r.horizon_ms)) && !crosses(x(observation.observed_ms));
        place(fitsRight ? x(observation.watermark_ms) : x(0) - 8, text,
              { y: fitsRight ? y + 4 : y - 10, class: `rb-bar-label ${kind}` }, group);
        svg("circle", { cx: x(observation.observed_ms), cy: y, r: 3, class: "rb-read" }, group);
      });
      svg("line", { x1: x(0), x2: x(axisMax), y1: bottom, y2: bottom, class: "rb-axis" }, canvas);
      for (let t = 0; t <= axisMax; t += step) {
        svg("line", { x1: x(t), x2: x(t), y1: bottom, y2: bottom + 5, class: "rb-tick" }, canvas);
        svg("text", { x: x(t), y: bottom + 18, "text-anchor": "middle", class: "rb-label" }, canvas).textContent = t === 0 ? "0 ms" : String(t);
      }
      const playhead = svg("g", { class: "rb-playhead-group" }, canvas);
      svg("line", { x1: 0, x2: 0, y1: 4, y2: bottom, class: "rb-playhead" }, playhead);
      svg("path", { d: "M-5 0H5L0 6Z", class: "rb-playhead-head" }, playhead);
      return { x, playhead, groups: [...canvas.querySelectorAll(".rb-group")] };
    };

    const graphHost = graph.parentElement;
    let NODE_W = 136;
    const NODE_H = 46;
    let LANES = [12, 180, 348, 516];
    const LANE_TITLES = ["CAPTURED EVENTS", "EFFECT WITNESSES", "READBACK", "CONTRACT · RESULT"];
    const EDGE_PRIORITY = ["EFFECT", "RESPONSE", "OBSERVATION", "VERIFICATION", "CONTRACT", "IDENTITY", "DEPENDENCY"];
    const subtitle = (node) => {
      switch (node.kind) {
        case "action_dispatch": return "dispatch";
        case "tool_response": return `response: ${node.status}`;
        case "agent_assessment": return `reported ${node.status}`;
        case "observed_external_effect": return node.actor === "agent" ? "actor: this agent" : node.actor === "other" ? "actor: another" : "actor: not recorded";
        case "external_effect_identity": return "shared effect ID";
        case "external_observation": return `read at ${node.time_ms} ms`;
        case "postcondition": return "outcome contract";
        case "verification": return `state: ${node.status}`;
        default: return node.kind;
      }
    };

    const renderGraph = (scenario) => {
      graph.replaceChildren();
      const lanes = [[], [], [], []];
      scenario.graph.nodes.forEach((node) => lanes[node.lane].push(node));
      const rows = Math.max(...lanes.map((lane) => lane.length));
      const height = 44 + rows * 64;
      // Lay out at the container's pixel width (scrolling below 620px) so text stays legible.
      const width = Math.max(620, Math.round(graphHost.clientWidth || 680));
      NODE_W = Math.min(150, Math.max(128, (width - 24) / 4 - 22));
      const spacing = (width - 24 - NODE_W) / 3;
      LANES = [0, 1, 2, 3].map((index) => 12 + index * spacing);
      graph.setAttribute("viewBox", `0 0 ${width} ${height}`);
      graph.style.width = `${width}px`;
      graph.setAttribute("aria-label", `Evidence graph: ${scenario.graph.nodes.length} nodes and ${scenario.graph.edges.length} links from the package's build_graph for this trace`);
      const defs = svg("defs", {}, graph);
      const marker = svg("marker", { id: "g-arrow", markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: "auto", markerUnits: "userSpaceOnUse" }, defs);
      svg("path", { d: "M0 0L8 4L0 8Z", fill: "#7d8896" }, marker);
      LANE_TITLES.forEach((title, index) => { svg("text", { x: LANES[index], y: 22, class: "g-lane" }, graph).textContent = title; });
      const positions = new Map();
      lanes.forEach((lane, laneIndex) => {
        const offset = ((rows - lane.length) * 64) / 2;
        lane.forEach((node, row) => positions.set(node.id, { x: LANES[laneIndex], y: 38 + offset + row * 64, lane: laneIndex, row }));
      });
      const edgeLayer = svg("g", {}, graph);
      const nodeLayer = svg("g", {}, graph);
      const pairs = new Map();
      scenario.graph.edges.forEach((edge) => {
        const key = `${edge.source}>${edge.target}`;
        const existing = pairs.get(key);
        if (!existing || EDGE_PRIORITY.indexOf(edge.kind) < EDGE_PRIORITY.indexOf(existing.kind)) pairs.set(key, edge);
      });
      const edges = [...pairs.values()].map((edge) => {
        const a = positions.get(edge.source);
        const b = positions.get(edge.target);
        let d;
        if (a.lane === b.lane) {
          const cx = a.x + NODE_W / 2;
          if (Math.abs(a.row - b.row) === 1) {
            d = b.y > a.y ? `M${cx} ${a.y + NODE_H}L${cx} ${b.y - 2}` : `M${cx} ${a.y}L${cx} ${b.y + NODE_H + 2}`;
          } else {
            // Loop around skipped rows; the last lane loops left so it stays inside the drawing.
            const side = a.lane === 3 ? -1 : 1;
            const xr = side > 0 ? a.x + NODE_W : a.x;
            const bend = xr + side * 22;
            d = `M${xr} ${a.y + NODE_H / 2}C${bend} ${a.y + NODE_H / 2} ${bend} ${b.y + NODE_H / 2} ${xr + side * 2} ${b.y + NODE_H / 2}`;
          }
        } else {
          const forward = b.lane > a.lane;
          const x1 = forward ? a.x + NODE_W : a.x;
          const x2 = forward ? b.x - 2 : b.x + NODE_W + 2;
          const mid = (x1 + x2) / 2;
          d = `M${x1} ${a.y + NODE_H / 2}C${mid} ${a.y + NODE_H / 2} ${mid} ${b.y + NODE_H / 2} ${x2} ${b.y + NODE_H / 2}`;
        }
        const path = svg("path", { d, class: `g-edge e-${edge.kind}` }, edgeLayer);
        const title = svg("title", {}, path);
        title.textContent = `${edge.source} to ${edge.target}: ${edge.label}`;
        return { edge, path, done: 0 };
      });
      const nodes = scenario.graph.nodes.map((node) => {
        const p = positions.get(node.id);
        const classes = ["g-node", `k-${node.kind}`];
        if (node.actor) classes.push(`a-${node.actor}`);
        if (node.kind === "verification") classes.push(`s-${node.status}`);
        const group = svg("g", { class: classes.join(" ") }, nodeLayer);
        svg("rect", { x: p.x, y: p.y, width: NODE_W, height: NODE_H, rx: 9 }, group);
        svg("text", { x: p.x + 10, y: p.y + 19, class: "g-title" }, group).textContent = node.id;
        svg("text", { x: p.x + 10, y: p.y + 35, class: "g-sub" }, group).textContent = subtitle(node);
        return { node, group };
      });
      edges.forEach((item) => {
        const length = item.path.getTotalLength();
        item.path.style.strokeDasharray = `${length} ${length}`;
        item.path.style.strokeDashoffset = String(length);
        item.length = length;
      });
      graphCount.textContent = `${scenario.graph.nodes.length} of ${scenario.graph.full_counts.nodes} nodes`;
      return { nodes, edges };
    };

    const fact = (list, term, value, className) => {
      const row = html("div", "", undefined, list);
      html("dt", "", term, row);
      html("dd", className ? `t-${className}` : "", value, row);
    };
    const ALIGNMENT_HINTS = {
      contradicted: "The agent’s report conflicts with verified, action-linked evidence.",
      consistent: "The agent’s report agrees with verified, action-linked evidence.",
      unassessable: "This evidence cannot judge the agent’s report either way.",
    };
    const ICONS = { satisfied: "✓", unknown: "?", other_actor: "↗", violated: "✕", pending: "…" };

    const renderVerdict = (scenario, t) => {
      const responseVisible = scenario.timeline.find((entry) => entry.kind === "response" && entry.t <= t);
      const assessmentVisible = scenario.timeline.find((entry) => entry.kind === "assessment" && entry.t <= t);
      const verifications = scenario.graph.nodes.filter((node) => node.kind === "verification");
      const visible = verifications.filter((node) => node.reveal_ms <= t);
      const latest = visible[visible.length - 1];
      const final = visible.length === verifications.length && verifications.length > 0;
      const key = `${scenario.id}|${visible.length}|${Boolean(responseVisible)}|${Boolean(assessmentVisible)}`;
      inspector.dataset.tone = tone(latest);
      if (verdict.dataset.key === key) return;
      verdict.dataset.key = key;
      verdict.replaceChildren();
      const wrap = html("div", motionAllowed() && playing ? "verdict-anim" : "", undefined, verdict);
      const labelRow = html("div", "panel-label", undefined, wrap);
      html("span", "", final ? "Evidence supports" : "So far", labelRow);
      const head = html("div", "verdict-state", undefined, wrap);
      html("span", "verdict-icon", ICONS[tone(latest)], head).setAttribute("aria-hidden", "true");
      html("h3", "", latest ? capitalize(latest.status) : "Pending", head);
      html("p", "verdict-sub", latest
        ? `${latest.id}${verifications.length > 1 ? ` of ${verifications.length}` : ""} · origin ${latest.origin.replace(/_/g, " ")}`
        : "No independent readback captured yet.", wrap);
      const list = html("dl", "verdict-facts", undefined, wrap);
      if (responseVisible) fact(list, "Tool response", scenario.response.join(", "), scenario.response[0]);
      if (assessmentVisible) fact(list, "Agent reported", scenario.assessment);
      if (latest) {
        fact(list, "Verified state", latest.status, latest.status);
        fact(list, "Effect origin", latest.origin, latest.origin);
      }
      if (final) {
        const e = scenario.explanation;
        fact(list, "Alignment", e.alignment, e.alignment);
        const chips = html("div", "diagnoses", undefined, wrap);
        e.diagnoses.forEach((code) => html("code", "", code, chips));
        html("p", "verdict-summary", `${e.summary} ${ALIGNMENT_HINTS[e.alignment] || ""}`, wrap);
        html("p", "verdict-reason", `Verifier: ${e.reason}.${visible.length > 1 ? ` Earlier verification retained: ${visible.slice(0, -1).map((node) => `${node.id} ${node.status}`).join(", ")}.` : ""}`, wrap);
      } else if (latest) {
        html("p", "verdict-pending", "A later readback is still in this trace. Alignment and diagnoses use every captured verification.", wrap);
      } else {
        html("p", "verdict-pending", responseVisible
          ? "The tool response and the agent’s report are captured. Neither one establishes the outcome."
          : "Waiting for the captured history to reach the action.", wrap);
      }
    };

    const motionAllowed = () => !reducedMotion.matches;

    const select = (index, { autoplay }) => {
      const scenario = data.scenarios[index];
      tabs.forEach((tab, tabIndex) => {
        const selected = tabIndex === index;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      });
      panel.setAttribute("aria-labelledby", tabs[index].id);
      if (fileLabel) fileLabel.textContent = scenario.file;
      const stops = [...new Set([
        ...scenario.timeline.map((entry) => entry.t),
        ...scenario.graph.nodes.map((node) => node.reveal_ms),
      ])].sort((a, b) => a - b);
      const frames = buildKeyframes(stops);
      renderHistory(scenario);
      verdict.dataset.key = "";
      state = {
        scenario, frames, total: frames[frames.length - 1].p, progress: 0,
        ribbon: renderRibbon(scenario), graph: renderGraph(scenario),
        items: [...historyList.children],
      };
      if (autoplay && motionAllowed()) {
        play(true);
      } else {
        pause();
        state.progress = state.total;
        renderAt();
      }
    };

    const renderAt = () => {
      const { scenario, frames, total, progress, ribbon } = state;
      const t = timeAt(frames, progress);
      const reached = Math.max(...state.items.map((item) => Number(item.dataset.t)).filter((value) => value <= t + 1e-6), -1);
      state.items.forEach((item) => {
        const at = Number(item.dataset.t);
        item.classList.toggle("is-on", at <= t + 1e-6);
        item.classList.toggle("is-current", at === reached && progress < total);
      });
      ribbon.playhead.setAttribute("transform", `translate(${ribbon.x(Math.max(0, t))},0)`);
      ribbon.groups.forEach((group) => group.classList.toggle("is-on", Number(group.dataset.at) <= t + 1e-6));
      const visible = new Set();
      state.graph.nodes.forEach(({ node, group }) => {
        const on = node.reveal_ms <= t + 1e-6;
        group.classList.toggle("is-on", on);
        if (on) visible.add(node.id);
      });
      state.graph.edges.forEach((item) => {
        const on = visible.has(item.edge.source) && visible.has(item.edge.target);
        item.path.style.strokeDashoffset = on ? "0" : String(item.length);
        if (!on) {
          window.clearTimeout(item.done);
          item.path.removeAttribute("marker-end");
          item.done = 0;
        } else if (!item.done) {
          item.done = window.setTimeout(() => item.path.setAttribute("marker-end", "url(#g-arrow)"), motionAllowed() ? 700 : 0);
        }
      });
      renderVerdict(scenario, t);
      clock.value = `t = ${Math.round(t)} ms`;
      clock.textContent = clock.value;
      const value = Math.round((progress / total) * 1000);
      scrub.value = String(value);
      scrub.style.setProperty("--p", `${value / 10}%`);
      scrub.setAttribute("aria-valuetext", `${Math.round(t)} milliseconds of recorded time`);
    };

    const setPlayingUi = (value) => {
      playing = value;
      playIcon.textContent = value ? "❚❚" : "▶";
      playButton.setAttribute("aria-label", value ? "Pause playback" : "Play recorded history");
    };
    const tick = (now) => {
      if (!playing) return;
      state.progress = Math.min(state.total, state.progress + (now - last));
      last = now;
      renderAt();
      if (state.progress >= state.total) {
        setPlayingUi(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    function play(fromStart) {
      if (fromStart || state.progress >= state.total) state.progress = 0;
      renderAt();
      setPlayingUi(true);
      last = performance.now();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    }
    function pause() {
      cancelAnimationFrame(frame);
      setPlayingUi(false);
    }

    playButton.addEventListener("click", () => (playing ? pause() : play(false)));
    replayButton.addEventListener("click", () => play(true));
    scrub.addEventListener("input", () => {
      pause();
      state.progress = (Number(scrub.value) / 1000) * state.total;
      renderAt();
    });
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => { started = true; select(index, { autoplay: true }); });
      tab.addEventListener("keydown", (event) => {
        const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        let next = null;
        if (event.key in keys) next = (index + keys[event.key] + tabs.length) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        if (next === null) return;
        event.preventDefault();
        tabs[next].focus();
        tabs[next].click();
      });
    });

    select(0, { autoplay: false });
    if ("ResizeObserver" in window) {
      let ribbonWidth = ribbonHost.clientWidth;
      let graphWidth = graphHost.clientWidth;
      new ResizeObserver(() => {
        const nextRibbon = ribbonHost.clientWidth;
        const nextGraph = graphHost.clientWidth;
        if (Math.abs(nextRibbon - ribbonWidth) < 4 && Math.abs(nextGraph - graphWidth) < 4) return;
        ribbonWidth = nextRibbon;
        graphWidth = nextGraph;
        state.graph.edges.forEach((item) => window.clearTimeout(item.done));
        state.ribbon = renderRibbon(state.scenario);
        state.graph = renderGraph(state.scenario);
        renderAt();
      }).observe(ribbonHost);
    }
    if (motionAllowed() && "IntersectionObserver" in window) {
      state.progress = 0;
      renderAt();
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || started) return;
        started = true;
        observer.disconnect();
        play(true);
      }, { threshold: 0, rootMargin: "0px 0px -40% 0px" });
      observer.observe(inspector);
    }
    reducedMotion.addEventListener("change", (event) => {
      if (event.matches) {
        pause();
        state.progress = state.total;
        renderAt();
      }
    });
  }

  /* Live demo: types the recorded commands, then opens the exact report they wrote. */
  const stage = document.querySelector("[data-demo]");
  if (stage && data && data.terminal) {
    const screen = stage.querySelector("[data-term]");
    const transcript = stage.querySelector("[data-term-transcript]");
    const browser = stage.querySelector("[data-browser]");
    const frameElement = stage.querySelector("[data-report]");
    const tourButtons = [...stage.querySelectorAll("[data-section]")];
    const playButton = stage.querySelector("[data-demo-play]");
    const playIcon = stage.querySelector("[data-demo-play-icon]");
    const replayButton = stage.querySelector("[data-demo-replay]");
    const status = stage.querySelector("[data-demo-status]");
    const frameBox = frameElement.parentElement;
    const fitReport = () => {
      const available = frameBox.clientWidth;
      const scale = available >= 600 ? Math.min(1, available / 960) : 1;
      frameBox.style.setProperty("--s", scale.toFixed(4));
    };
    fitReport();
    if ("ResizeObserver" in window) new ResizeObserver(fitReport).observe(frameBox);
    const comment = `# consequa-x ${data.package_version} installed with: ${data.install}`;
    const reported = data.scenarios.find((item) => data.report.trace.endsWith(item.file));
    const outputClass = (output) => (output.startsWith("Saved offline report") ? "t-done"
      : reported && output.trim().startsWith(`${reported.scenario}:`) ? "t-hit" : "t-out");
    const lines = [comment];
    data.terminal.forEach((step) => lines.push(`$ ${step.command}`, ...step.output));
    transcript.textContent = lines.join("\n");

    let run = 0;
    let paused = false;
    let running = false;
    let touring = false;
    let expectedScroll = null;
    const cancelled = Symbol("cancelled");

    const wait = (ms, id) => new Promise((resolve, reject) => {
      let remaining = ms;
      let previous = performance.now();
      const step = (now) => {
        if (id !== run) { reject(cancelled); return; }
        if (!paused) remaining -= now - previous;
        previous = now;
        if (remaining <= 0) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const setStatus = (text) => { status.textContent = text; };
    const setPaused = (value) => {
      paused = value;
      playIcon.textContent = value ? "▶" : "❚❚";
      playButton.setAttribute("aria-label", value ? "Resume demo" : "Pause demo");
    };
    const caret = html("span", "caret");
    caret.setAttribute("aria-hidden", "true");
    const addLine = (className, text = "") => {
      const line = html("span", `line ${className}`, text, screen);
      line.style.display = "block";
      screen.scrollTop = screen.scrollHeight;
      return line;
    };
    const frameDocument = () => {
      try {
        const doc = frameElement.contentDocument;
        return doc && doc.getElementById("summary") ? doc : null;
      } catch {
        return null;
      }
    };
    const frameReady = () => new Promise((resolve) => {
      if (frameDocument()) { resolve(true); return; }
      frameElement.addEventListener("load", () => resolve(Boolean(frameDocument())), { once: true });
      window.setTimeout(() => resolve(Boolean(frameDocument())), 6000);
    });
    const setActive = (section) => tourButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.section === section));
    const sectionTop = (doc, section) => {
      const target = doc.getElementById(section);
      return target ? Math.max(0, target.getBoundingClientRect().top + doc.defaultView.scrollY - 14) : 0;
    };
    const scrollFrame = (section, id, duration = 900) => new Promise((resolve, reject) => {
      const doc = frameDocument();
      if (!doc) {
        frameElement.src = `assets/sample-report.html#${section}`;
        resolve();
        return;
      }
      const view = doc.defaultView;
      const from = view.scrollY;
      const to = Math.min(sectionTop(doc, section), doc.documentElement.scrollHeight - view.innerHeight);
      if (!motionAllowedDemo() || duration === 0) {
        view.scrollTo(0, to);
        expectedScroll = to;
        resolve();
        return;
      }
      let elapsed = 0;
      let previous = performance.now();
      const step = (now) => {
        if (id !== undefined && id !== run) { reject(cancelled); return; }
        if (!paused) elapsed += now - previous;
        previous = now;
        const x = Math.min(1, elapsed / duration);
        const y = from + (to - from) * easeInOut(x);
        view.scrollTo(0, y);
        expectedScroll = view.scrollY;
        if (x >= 1) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const motionAllowedDemo = () => !reducedMotion.matches;
    const userTookOver = () => {
      const doc = frameDocument();
      return Boolean(doc && expectedScroll !== null && Math.abs(doc.defaultView.scrollY - expectedScroll) > 6);
    };

    const openReport = async (id) => {
      browser.classList.remove("is-waiting");
      browser.classList.add("is-opening");
      await wait(650, id);
      browser.classList.remove("is-opening");
    };

    const tour = async (id) => {
      if (!(await frameReady())) { setStatus("Done. The report is open; use the section buttons to move around."); return; }
      touring = true;
      setStatus("Report written. Touring its sections. Scroll it yourself to take over.");
      const sections = ["summary", "timeline", "evidence", "graph"];
      for (const section of sections) {
        if (!touring) return;
        setActive(section);
        await scrollFrame(section, id);
        await wait(section === "summary" ? 1800 : 2600, id);
        if (userTookOver()) {
          touring = false;
          setActive("");
          setStatus("You have the report. Scroll freely, or jump with the section buttons.");
          return;
        }
      }
      touring = false;
      setStatus("Done. Replay, or explore the report yourself.");
    };

    const typeCommand = async (command, id) => {
      const line = addLine("");
      html("span", "t-prompt", "$ ", line);
      const text = html("span", "t-cmd", "", line);
      line.appendChild(caret);
      for (let index = 0; index < command.length; index += 1) {
        text.textContent += command[index];
        screen.scrollTop = screen.scrollHeight;
        await wait(22 + ((index * 37) % 19), id);
      }
      await wait(260, id);
      caret.remove();
    };

    const perform = async (id) => {
      running = true;
      screen.replaceChildren();
      browser.classList.add("is-waiting");
      setActive("");
      setStatus("Running the recorded commands…");
      const doc = frameDocument();
      if (doc) { doc.defaultView.scrollTo(0, 0); expectedScroll = 0; }
      addLine("t-comment", comment);
      await wait(380, id);
      for (const step of data.terminal) {
        await typeCommand(step.command, id);
        for (const output of step.output) {
          addLine(outputClass(output), output);
          await wait(step.output.length > 3 ? 55 : 160, id);
        }
        await wait(420, id);
      }
      const line = addLine("");
      html("span", "t-prompt", "$ ", line);
      line.appendChild(caret);
      await openReport(id);
      await tour(id);
      running = false;
    };

    const showFinal = () => {
      run += 1;
      screen.replaceChildren();
      addLine("t-comment", comment);
      data.terminal.forEach((step) => {
        const line = addLine("");
        html("span", "t-prompt", "$ ", line);
        html("span", "t-cmd", step.command, line);
        step.output.forEach((output) => addLine(outputClass(output), output));
      });
      screen.scrollTop = 0;
      browser.classList.remove("is-waiting", "is-opening");
      setStatus("Showing the complete recorded session. Use the section buttons to move around the report.");
    };

    const start = () => {
      run += 1;
      const id = run;
      touring = false;
      setPaused(false);
      perform(id).catch((error) => { if (error !== cancelled) throw error; });
    };

    tourButtons.forEach((button) => button.addEventListener("click", () => {
      touring = false;
      setActive(button.dataset.section);
      scrollFrame(button.dataset.section, undefined, 700).catch(() => {});
      if (!running) setStatus("Jumped to a report section.");
    }));
    playButton.addEventListener("click", () => {
      if (!running && !touring) { start(); return; }
      setPaused(!paused);
      if (paused) setStatus("Paused.");
    });
    replayButton.addEventListener("click", start);

    if (!motionAllowedDemo() || !("IntersectionObserver" in window)) {
      showFinal();
      setPaused(true);
    } else {
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        start();
      }, { threshold: 0, rootMargin: "0px 0px -45% 0px" });
      observer.observe(stage);
    }
    reducedMotion.addEventListener("change", (event) => { if (event.matches) { showFinal(); setPaused(true); } });
  }

  /* Copy install command */
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const source = document.getElementById(button.dataset.copy);
      const status = document.getElementById("copy-status");
      if (!source) return;
      let timeout;
      try {
        if (!navigator.clipboard || !window.isSecureContext) throw new Error("Clipboard unavailable");
        await Promise.race([
          navigator.clipboard.writeText(source.textContent.trim()),
          new Promise((resolve, reject) => { timeout = window.setTimeout(() => reject(new Error("Clipboard did not respond")), 1500); }),
        ]);
        const label = button.querySelector("span");
        if (label) label.textContent = "Copied";
        button.setAttribute("aria-label", "Installation command copied");
        if (status) status.textContent = "Installation command copied to clipboard.";
        window.setTimeout(() => {
          if (label) label.textContent = "Copy";
          button.setAttribute("aria-label", "Copy package installation command");
        }, 2200);
      } catch {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(source);
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
        if (status) status.textContent = "The installation command is selected. Use your device’s copy command.";
      } finally {
        window.clearTimeout(timeout);
      }
    });
  });
})();
