"use strict";

(() => {
  const root = document.documentElement;
  root.classList.add("has-script");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const packageDemoButton = document.querySelector(".package-demo-control");
  const packageDemoImage = document.querySelector("#package-demo-image");
  const packageDemoStatus = document.querySelector("#package-demo-status");
  if (packageDemoButton && packageDemoImage) {
    const setPackageDemoPlaying = (playing) => {
      packageDemoImage.src = playing ? packageDemoImage.dataset.animation : packageDemoImage.dataset.poster;
      packageDemoButton.setAttribute("aria-pressed", String(playing));
      const symbol = packageDemoButton.querySelector("[data-package-demo-symbol]");
      const label = packageDemoButton.querySelector("[data-package-demo-label]");
      if (symbol) symbol.textContent = playing ? "Ⅱ" : "▷";
      if (label) label.textContent = playing ? "Pause walkthrough" : "Play report walkthrough";
      if (packageDemoStatus) packageDemoStatus.textContent = playing ? "Report walkthrough playing." : "Walkthrough paused. Showing the still report image.";
    };
    packageDemoButton.hidden = false;
    packageDemoButton.addEventListener("click", () => {
      setPackageDemoPlaying(packageDemoButton.getAttribute("aria-pressed") !== "true");
    });
    packageDemoImage.addEventListener("error", () => {
      if (packageDemoButton.getAttribute("aria-pressed") !== "true") return;
      setPackageDemoPlaying(false);
      if (packageDemoStatus) packageDemoStatus.textContent = "The animation could not load. Showing the still report image.";
    });
    reducedMotion.addEventListener("change", (event) => {
      if (event.matches && packageDemoButton.getAttribute("aria-pressed") === "true") setPackageDemoPlaying(false);
    });
  }
  const menuButton = document.querySelector(".menu-toggle");
  const navigation = document.querySelector("#primary-nav");
  if (menuButton && navigation) {
    menuButton.addEventListener("click", () => {
      const expanded = menuButton.getAttribute("aria-expanded") === "true";
      menuButton.setAttribute("aria-expanded", String(!expanded));
      navigation.classList.toggle("is-open", !expanded);
    });
    navigation.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        menuButton.setAttribute("aria-expanded", "false");
        navigation.classList.remove("is-open");
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
        menuButton.setAttribute("aria-expanded", "false");
        navigation.classList.remove("is-open");
        menuButton.focus();
      }
    });
  }

  const historyButton = document.querySelector(".history-toggle");
  const historyPanel = document.querySelector(".trace-panel");
  const compactHistory = window.matchMedia("(max-width: 760px)");
  const setHistoryExpanded = (expanded) => {
    if (!historyButton || !historyPanel) return;
    historyPanel.classList.toggle("is-collapsed", !expanded);
    historyButton.setAttribute("aria-expanded", String(expanded));
    const label = historyButton.querySelector("[data-history-label]");
    if (label) label.textContent = expanded ? "Hide 4 events" : "View 4 events";
  };
  if (historyButton && historyPanel) {
    setHistoryExpanded(!compactHistory.matches);
    historyButton.addEventListener("click", () => {
      setHistoryExpanded(historyButton.getAttribute("aria-expanded") !== "true");
    });
    compactHistory.addEventListener("change", (event) => setHistoryExpanded(!event.matches));
  }

  const motionButton = document.querySelector(".motion-toggle");
  if (motionButton) {
    motionButton.addEventListener("click", () => {
      const paused = motionButton.getAttribute("aria-pressed") !== "true";
      motionButton.setAttribute("aria-pressed", String(paused));
      root.classList.toggle("motion-paused", paused);
      const symbol = document.createElement("span");
      symbol.setAttribute("aria-hidden", "true");
      symbol.textContent = paused ? "▷" : "Ⅱ";
      motionButton.replaceChildren(symbol, document.createTextNode(paused ? " Resume motion" : " Pause motion"));
    });
  }

  if (!reducedMotion.matches && "IntersectionObserver" in window) {
    root.classList.add("motion-ready");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -20px 0px" });
    document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
  }

  const scenarios = {
    confirmed: {
      symbol: "✓",
      title: "Contract satisfied.",
      description: "Independent readback establishes the refund. Qualified provenance links the effect to this agent.",
      readback: "Matching effect; qualified agent provenance",
      state: "Satisfied", origin: "Confirmed", alignment: "Contradicted",
      edge: "qualified provenance", target: "Effect E01", source: "Action A01",
      sourceKind: "DISPATCH", effectSymbol: "✓"
    },
    unknown: {
      symbol: "?",
      title: "Outcome unknown.",
      description: "The readback is incomplete. The timeout and reported failure cannot establish whether the requested refund occurred.",
      readback: "Incomplete source view; no sufficient persistence witness",
      state: "Unknown", origin: "Unknown", alignment: "Unassessable",
      edge: "insufficient evidence", target: "No qualified witness", source: "Action A01",
      sourceKind: "DISPATCH", effectSymbol: "?"
    },
    other: {
      symbol: "✓",
      title: "State satisfied. Origin differs.",
      description: "The requested refund exists, but qualified provenance identifies another actor. State satisfaction alone does not attribute the effect to this agent.",
      readback: "One matching effect, attributed to another actor",
      state: "Satisfied", origin: "Other actor", alignment: "Aligned for linked target",
      edge: "qualified provenance", target: "Effect E01", source: "Actor B01",
      sourceKind: "EFFECT ORIGIN", effectSymbol: "✓"
    }
  };
  const fields = {
    symbol: "verdict-symbol", title: "verdict-title", description: "verdict-description",
    readback: "demo-readback", state: "fact-state", origin: "fact-origin",
    alignment: "fact-alignment", edge: "graph-edge", target: "graph-target", source: "graph-source",
    sourceKind: "graph-source-kind", effectSymbol: "graph-effect-symbol"
  };
  const scenarioButtons = document.querySelectorAll("[data-scenario]");
  scenarioButtons.forEach((button, index) => {
    button.addEventListener("keydown", (event) => {
      const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = scenarioButtons.length - 1;
      else next = (index + (event.key === "ArrowRight" ? 1 : -1) + scenarioButtons.length) % scenarioButtons.length;
      scenarioButtons[next].focus();
      scenarioButtons[next].click();
    });
  });
  scenarioButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const scenario = scenarios[button.dataset.scenario];
      if (!scenario) return;
      scenarioButtons.forEach((item) => {
        const selected = item === button;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-pressed", String(selected));
      });
      const verdict = document.querySelector("#demo-verdict");
      if (verdict) verdict.dataset.state = button.dataset.scenario;
      const inspector = document.querySelector(".inspector");
      if (inspector) inspector.dataset.scenarioView = button.dataset.scenario;
      Object.entries(fields).forEach(([key, id]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = scenario[key];
      });
    });
  });

  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const source = document.getElementById(button.dataset.copy);
      const status = document.getElementById("copy-status");
      if (!source) return;
      let clipboardTimeout;
      try {
        if (!navigator.clipboard || !window.isSecureContext) throw new Error("Clipboard unavailable");
        if (status) status.textContent = "Copying the installation command…";
        await Promise.race([
          navigator.clipboard.writeText(source.textContent.trim()),
          new Promise((resolve, reject) => {
            clipboardTimeout = window.setTimeout(() => reject(new Error("Clipboard did not respond")), 1500);
          })
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
        window.clearTimeout(clipboardTimeout);
      }
    });
  });
})();
