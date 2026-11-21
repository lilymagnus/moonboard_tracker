// Moonboard Masters 2017 (40°) board: holds, arrows and labels.
(function () {
  const COLS = "ABCDEFGHIJK";
  const ROWS = 18;
  // Holds mode cycles: none -> middle -> start -> end -> none
  const ROLE_CYCLE = [null, "middle", "start", "end"];
  const SVG_NS = "http://www.w3.org/2000/svg";
  const HINTS = {
    holds: "Tap a hold: middle, then start, then end, then clear.",
    arrow: "Tap where the move starts, then where it ends.",
    label: "Tap a hold to add or edit its label.",
  };
  let uidCounter = 0;

  // ---------- Helpers ----------

  // Hold position -> centre point in the SVG coordinate space (110 x 180)
  function centre(pos) {
    return {
      x: COLS.indexOf(pos[0]) * 10 + 5,
      y: (ROWS - parseInt(pos.slice(1), 10)) * 10 + 5,
    };
  }

  function svgEl(tag, attrs, text) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // "C5 start, F9, H14 end" -> { C5: "start", F9: "middle", H14: "end" }
  function parseText(text) {
    const holds = {};
    text.split(",").forEach((part) => {
      const tokens = part.trim().split(/\s+/);
      if (!tokens[0]) return;
      const pos = tokens[0].toUpperCase();
      const word = (tokens[1] || "").toLowerCase();
      holds[pos] = word === "start" || word === "end" ? word : "middle";
    });
    return holds;
  }

  // Start hold first, end hold last
  function toText(holds) {
    const entries = Object.entries(holds);
    const ordered = [
      ...entries.filter(([, role]) => role === "start"),
      ...entries.filter(([, role]) => role === "middle"),
      ...entries.filter(([, role]) => role === "end"),
    ];
    return ordered
      .map(([pos, role]) => (role === "middle" ? pos : `${pos} ${role}`))
      .join(", ");
  }

  function parseAnnotations(text) {
    try {
      return normaliseAnnotations(JSON.parse(text || "{}"));
    } catch (err) {
      return normaliseAnnotations({});
    }
  }

  function normaliseAnnotations(data) {
    const obj = data && typeof data === "object" ? data : {};
    return {
      arrows: Array.isArray(obj.arrows) ? obj.arrows : [],
      labels: Array.isArray(obj.labels) ? obj.labels : [],
    };
  }

  // ---------- Drawing ----------

  // Creates the grid and the SVG overlay used for arrows and labels
  function buildBoard(container) {
    container.classList.add("board");

    const wrap = document.createElement("div");
    wrap.className = "board-wrap";

    const main = document.createElement("div");
    main.className = "board-main";

    const grid = document.createElement("div");
    grid.className = "board-grid";
    for (let r = ROWS; r >= 1; r--) {
      for (const letter of COLS) {
        const pos = letter + r;
        const cell = document.createElement("div");
        cell.className = "hold-cell";
        cell.dataset.pos = pos;
        cell.title = pos;
        grid.appendChild(cell);
      }
    }

    const uid = ++uidCounter;
    const svg = svgEl("svg", {
      class: "board-svg",
      viewBox: "0 0 110 180",
      preserveAspectRatio: "none",
    });
    const defs = svgEl("defs");
    const marker = svgEl("marker", {
      id: "arrow-" + uid,
      viewBox: "0 0 10 10",
      refX: "8",
      refY: "5",
      markerWidth: "4",
      markerHeight: "4",
      orient: "auto",
    });
    marker.appendChild(svgEl("path", { d: "M0,0 L10,5 L0,10 z", fill: "#facc15" }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    main.appendChild(grid);
    main.appendChild(svg);
    wrap.appendChild(main);
    container.appendChild(wrap);
    return { grid, svg, uid };
  }

  // Sets each cell's class from the holds, plus "pending" for a half-drawn arrow
  function paintHolds(grid, holds, pending) {
    grid.querySelectorAll(".hold-cell").forEach((cell) => {
      const pos = cell.dataset.pos;
      const role = holds[pos];
      cell.className =
        "hold-cell" +
        (role ? " " + role : "") +
        (pos === pending ? " pending" : "");
    });
  }

  // Redraws all arrows and labels on the SVG overlay
  function drawOverlay(svg, uid, annotations) {
    Array.from(svg.children).forEach((node) => {
      if (node.tagName !== "defs") node.remove();
    });

    annotations.arrows.forEach((a) => {
      const from = centre(a.from);
      const to = centre(a.to);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const trim = 3.5; // stop the line short of the hold centres

      svg.appendChild(
        svgEl("line", {
          x1: from.x + (dx / len) * trim,
          y1: from.y + (dy / len) * trim,
          x2: to.x - (dx / len) * trim,
          y2: to.y - (dy / len) * trim,
          stroke: "#facc15",
          "stroke-width": "1.6",
          "stroke-linecap": "round",
          "marker-end": `url(#arrow-${uid})`,
        })
      );

      if (a.label) {
        svg.appendChild(
          svgEl(
            "text",
            {
              x: (from.x + to.x) / 2,
              y: (from.y + to.y) / 2 - 1.5,
              "text-anchor": "middle",
              "font-size": "4",
              "font-weight": "bold",
              fill: "#fff",
              stroke: "#1f2328",
              "stroke-width": "1.2",
              "paint-order": "stroke",
            },
            a.label
          )
        );
      }
    });

    annotations.labels.forEach((l) => {
      const c = centre(l.pos);
      svg.appendChild(
        svgEl(
          "text",
          {
            x: c.x,
            y: c.y - 6,
            "text-anchor": "middle",
            "font-size": "4",
            "font-weight": "bold",
            fill: "#fff",
            stroke: "#1f2328",
            "stroke-width": "1.2",
            "paint-order": "stroke",
          },
          l.text
        )
      );
    });
  }

  // ---------- Editor ----------

  function initEditor(container, holdsInput, annotationsInput) {
    const { grid, svg, uid } = buildBoard(container);
    container.classList.add("board-editable");

    const toolbar = document.createElement("div");
    toolbar.className = "board-toolbar";
    toolbar.innerHTML = `
      <button type="button" class="tool active" data-mode="holds">Holds</button>
      <button type="button" class="tool" data-mode="arrow">Arrow</button>
      <button type="button" class="tool" data-mode="label">Label</button>
      <button type="button" class="tool" data-action="undo">Undo</button>
      <button type="button" class="tool" data-action="clear">Clear</button>
      <div class="mode-hint"></div>`;
    container.prepend(toolbar);
    const hint = toolbar.querySelector(".mode-hint");

    let holds = parseText(holdsInput.value);
    let annotations = parseAnnotations(annotationsInput.value);
    let mode = "holds";
    let pendingFrom = null;
    const history = [];

    function snapshot() {
      history.push(JSON.stringify({ holds, annotations }));
      if (history.length > 100) history.shift();
    }

    function updateHint() {
      if (mode === "arrow" && pendingFrom) {
        hint.textContent = `From ${pendingFrom}: now tap where it ends (tap ${pendingFrom} again to cancel).`;
      } else {
        hint.textContent = HINTS[mode];
      }
    }

    // Repaints everything and writes the results into the form fields
    function refresh() {
      paintHolds(grid, holds, pendingFrom);
      drawOverlay(svg, uid, annotations);
      holdsInput.value = toText(holds);
      annotationsInput.value = JSON.stringify(annotations);
      updateHint();
    }

    grid.addEventListener("click", (e) => {
      const cell = e.target.closest(".hold-cell");
      if (!cell) return;
      const pos = cell.dataset.pos;

      if (mode === "holds") {
        snapshot();
        const current = holds[pos] || null;
        const next = ROLE_CYCLE[(ROLE_CYCLE.indexOf(current) + 1) % ROLE_CYCLE.length];
        // Only one start and one end: move the existing one to middle
        if (next === "start" || next === "end") {
          for (const key of Object.keys(holds)) {
            if (holds[key] === next) holds[key] = "middle";
          }
        }
        if (next) {
          holds[pos] = next;
        } else {
          delete holds[pos];
        }
      } else if (mode === "arrow") {
        if (!pendingFrom) {
          pendingFrom = pos;
        } else if (pos === pendingFrom) {
          pendingFrom = null;
        } else {
          const label = window.prompt("Describe this move (optional):", "");
          if (label !== null) {
            snapshot();
            annotations.arrows.push({ from: pendingFrom, to: pos, label: label.trim() });
          }
          pendingFrom = null;
        }
      } else if (mode === "label") {
        const existing = annotations.labels.find((l) => l.pos === pos);
        const text = window.prompt(`Label for ${pos}:`, existing ? existing.text : "");
        if (text !== null) {
          snapshot();
          annotations.labels = annotations.labels.filter((l) => l.pos !== pos);
          if (text.trim()) annotations.labels.push({ pos, text: text.trim() });
        }
      }

      refresh();
    });

    toolbar.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;

      if (btn.dataset.mode) {
        mode = btn.dataset.mode;
        pendingFrom = null;
        toolbar.querySelectorAll("[data-mode]").forEach((b) => {
          b.classList.toggle("active", b === btn);
        });
      } else if (btn.dataset.action === "undo") {
        if (!history.length) return;
        ({ holds, annotations } = JSON.parse(history.pop()));
        pendingFrom = null;
      } else if (btn.dataset.action === "clear") {
        if (!window.confirm("Remove all arrows and labels? (Holds are kept.)")) return;
        snapshot();
        annotations = { arrows: [], labels: [] };
        pendingFrom = null;
      }

      refresh();
    });

    // Typing in the text box updates the board, but doesn't rewrite the text
    holdsInput.addEventListener("input", () => {
      holds = parseText(holdsInput.value);
      paintHolds(grid, holds, pendingFrom);
    });

    paintHolds(grid, holds, null);
    drawOverlay(svg, uid, annotations);
    updateHint();
  }

  // ---------- Viewer (saved problem cards) ----------

  function initViewer(container) {
    const { grid, svg, uid } = buildBoard(container);
    container.classList.add("board-small");

    const holds = {};
    JSON.parse(container.dataset.holds || "[]").forEach((h) => {
      holds[h.position] = h.role;
    });
    paintHolds(grid, holds, null);

    const annotations = normaliseAnnotations(JSON.parse(container.dataset.annotations || "{}"));
    drawOverlay(svg, uid, annotations);
  }

  // ---------- Start ----------

  const editor = document.getElementById("board-input");
  const holdsInput = document.getElementById("holds-input");
  const annotationsInput = document.getElementById("annotations-input");
  if (editor && holdsInput && annotationsInput) {
    initEditor(editor, holdsInput, annotationsInput);
  }

  document.querySelectorAll(".board-view").forEach(initViewer);
})();
