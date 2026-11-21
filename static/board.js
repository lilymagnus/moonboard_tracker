// Moonboard Masters 2017 (40°) board: holds, arrows and movable labels.
(function () {
  const COLS = "ABCDEFGHIJK";
  const ROWS = 18;
  const VIEW_W = 110;
  const VIEW_H = 180;
  // Holds mode cycles: none -> middle -> start -> end -> none
  const ROLE_CYCLE = [null, "middle", "start", "end"];
  const SVG_NS = "http://www.w3.org/2000/svg";
  const HINTS = {
    holds: "Tap a hold to cycle: middle, start, end, clear. Several starts and ends are fine.",
    arrow: "Tap where the move starts, then where it ends.",
    label: "Tap a hold to add a label above it. Drag labels anywhere. Tap a label to edit it.",
  };
  let uidCounter = 0;

  // ---------- Helpers ----------

  // Hold position -> centre point in the SVG coordinate space
  function centre(pos) {
    return {
      x: COLS.indexOf(pos[0]) * 10 + 5,
      y: (ROWS - parseInt(pos.slice(1), 10)) * 10 + 5,
    };
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function svgEl(tag, attrs, text) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Converts a mouse event into SVG coordinates, so labels can be dragged
  function toSvgPoint(svg, e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
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

  // Start holds first, middle holds, end holds last
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

  function normaliseAnnotations(data) {
    const obj = data && typeof data === "object" ? data : {};
    const arrows = Array.isArray(obj.arrows) ? obj.arrows : [];
    const rawLabels = Array.isArray(obj.labels) ? obj.labels : [];
    const labels = [];
    rawLabels.forEach((l) => {
      if (!l || typeof l !== "object") return;
      const text = String(l.text || "");
      if (typeof l.x === "number" && typeof l.y === "number") {
        labels.push({ x: l.x, y: l.y, text });
      } else if (l.pos && /^[A-K](1[0-8]|[1-9])$/.test(l.pos)) {
        // Older labels attached to a hold: place them just above it
        const c = centre(l.pos);
        labels.push({ x: c.x, y: c.y - 6, text });
      }
    });
    return { arrows, labels };
  }

  function parseAnnotations(text) {
    try {
      return normaliseAnnotations(JSON.parse(text || "{}"));
    } catch (err) {
      return normaliseAnnotations({});
    }
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
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
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
    marker.appendChild(svgEl("path", { d: "M0,0 L10,5 L0,10 z", fill: "#f97316" }));
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

  const LABEL_STYLE = {
    "text-anchor": "middle",
    "font-size": "4",
    "font-weight": "bold",
    fill: "#fff",
    stroke: "#1f2328",
    "stroke-width": "1.2",
    "paint-order": "stroke",
  };

  // Redraws arrows and labels. opts is only passed in the editor.
  function drawOverlay(svg, uid, annotations, opts) {
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
          stroke: "#f97316",
          "stroke-width": "1.6",
          "stroke-linecap": "round",
          "marker-end": `url(#arrow-${uid})`,
        })
      );

      if (a.label) {
        svg.appendChild(
          svgEl(
            "text",
            { ...LABEL_STYLE, x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 1.5 },
            a.label
          )
        );
      }
    });

    annotations.labels.forEach((l, index) => {
      const text = svgEl("text", { ...LABEL_STYLE, x: l.x, y: l.y }, l.text);
      if (opts && opts.editable) {
        text.style.pointerEvents = "auto";
        text.style.cursor = "move";
        text.addEventListener("pointerdown", (e) => startLabelDrag(e, svg, index, opts));
      }
      svg.appendChild(text);
    });
  }

  // ---------- Label dragging (editor only) ----------

  function startLabelDrag(e, svg, index, opts) {
    e.preventDefault();
    e.stopPropagation();

    const start = toSvgPoint(svg, e);
    const label = opts.getLabels()[index];
    if (!label) return;
    const offsetX = label.x - start.x;
    const offsetY = label.y - start.y;
    let moved = false;

    svg.setPointerCapture(e.pointerId);

    function onMove(ev) {
      const p = toSvgPoint(svg, ev);
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 0.8) return;
      if (!moved) {
        moved = true;
        opts.onDragStart();
      }
      label.x = clamp(p.x + offsetX, 0, VIEW_W);
      label.y = clamp(p.y + offsetY, 0, VIEW_H);
      opts.onDrag();
    }

    function onUp() {
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onUp);
      if (moved) {
        opts.onDragEnd();
      } else {
        opts.onLabelTap(index);
      }
    }

    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);
  }

  // ---------- Snapshot (saved picture of the board) ----------
  // Converts the SVG drawing into a PNG data URL
  function svgToPng(svgText) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
    });
  }
  
  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]
    );
  }

  // Draws the board as an SVG string. Coordinates are scaled 4x from the editor's space.
  function buildSnapshot(holds, annotations) {
    const S = 4;
    const p = (pt) => ({ x: pt.x * S, y: pt.y * S });
    const parts = [];

    parts.push(`<rect width="${VIEW_W * S}" height="${VIEW_H * S}" rx="16" fill="#1f2328"/>`);

    // Empty grid positions
    for (let r = ROWS; r >= 1; r--) {
      for (const letter of COLS) {
        const c = p(centre(letter + r));
        parts.push(`<circle cx="${c.x}" cy="${c.y}" r="11" fill="#374151"/>`);
      }
    }

    // Arrows: dark outline, then orange line with a triangle head
    annotations.arrows.forEach((a) => {
      const from = p(centre(a.from));
      const to = p(centre(a.to));
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const tip = { x: to.x - ux * 18, y: to.y - uy * 18 };
      const base = { x: tip.x - ux * 22, y: tip.y - uy * 22 };
      const px = -uy * 12;
      const py = ux * 12;
      const start = { x: from.x + ux * 14, y: from.y + uy * 14 };
      const head = `${tip.x},${tip.y} ${base.x + px},${base.y + py} ${base.x - px},${base.y - py}`;

      parts.push(
        `<line x1="${start.x}" y1="${start.y}" x2="${base.x}" y2="${base.y}" stroke="#1f2328" stroke-width="17" stroke-linecap="round"/>`
      );
      parts.push(
        `<line x1="${start.x}" y1="${start.y}" x2="${base.x}" y2="${base.y}" stroke="#f97316" stroke-width="10" stroke-linecap="round"/>`
      );
      parts.push(`<polygon points="${head}" fill="#f97316"/>`);

      if (a.label) {
        parts.push(
          `<text x="${(from.x + to.x) / 2}" y="${(from.y + to.y) / 2 - 6}" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#fff" stroke="#1f2328" stroke-width="4" paint-order="stroke">${escapeXml(a.label)}</text>`
        );
      }
    });

    // Holds: coloured circles with S or E marked
    Object.entries(holds).forEach(([pos, role]) => {
      const c = p(centre(pos));
      const colour = role === "start" ? "#22c55e" : role === "end" ? "#ef4444" : "#3b82f6";
      parts.push(`<circle cx="${c.x}" cy="${c.y}" r="15" fill="${colour}" stroke="#fff" stroke-width="2"/>`);
      if (role !== "middle") {
        parts.push(
          `<text x="${c.x}" y="${c.y + 6}" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#fff">${role === "start" ? "S" : "E"}</text>`
        );
      }
    });

    // Labels, placed where they were dragged
    annotations.labels.forEach((l) => {
      const x = l.x * S;
      const y = l.y * S;
      parts.push(
        `<text x="${x}" y="${y}" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#fff" stroke="#1f2328" stroke-width="4" paint-order="stroke">${escapeXml(l.text)}</text>`
      );
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W * S} ${VIEW_H * S}" width="${VIEW_W * S}" height="${VIEW_H * S}">${parts.join("")}</svg>`;
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

    // Hidden field that carries the board picture when the form is saved
    const snapshotInput = document.createElement("input");
    snapshotInput.type = "hidden";
    snapshotInput.name = "snapshot";
      container.closest("form").appendChild(snapshotInput);

        // Convert the picture to PNG just before the form is sent
    let submitting = false;
    const form = container.closest("form");
    form.addEventListener("submit", (e) => {
      if (submitting) return;
      e.preventDefault();
      const send = () => {
        submitting = true;
        form.submit();
      };
      svgToPng(buildSnapshot(holds, annotations))
        .then((png) => {
          snapshotInput.value = png;
          send();
        })
        .catch(() => {
          snapshotInput.value = "";
          send();
        });
    });
      
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
      drawOverlay(svg, uid, annotations, editorOpts);
      holdsInput.value = toText(holds);
      annotationsInput.value = JSON.stringify(annotations);
	snapshotInput.value = buildSnapshot(holds, annotations);
	updateHint();
    }

    // Tapping an existing label opens its text for editing
    function editLabel(index) {
      const label = annotations.labels[index];
      if (!label) return;
      const text = window.prompt("Label text (clear it to delete):", label.text);
      if (text === null) return;
      snapshot();
      if (text.trim()) {
        label.text = text.trim();
      } else {
        annotations.labels.splice(index, 1);
      }
      refresh();
    }

    const editorOpts = {
      editable: true,
      getLabels: () => annotations.labels,
      onDragStart: () => snapshot(),
      onDrag: () => drawOverlay(svg, uid, annotations, editorOpts),
      onDragEnd: () => refresh(),
      onLabelTap: (index) => editLabel(index),
    };

    grid.addEventListener("click", (e) => {
      const cell = e.target.closest(".hold-cell");
      if (!cell) return;
      const pos = cell.dataset.pos;

      if (mode === "holds") {
        snapshot();
        const current = holds[pos] || null;
        const next = ROLE_CYCLE[(ROLE_CYCLE.indexOf(current) + 1) % ROLE_CYCLE.length];
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
        const text = window.prompt(`Label for ${pos}:`, "");
        if (text && text.trim()) {
          snapshot();
          const c = centre(pos);
          annotations.labels.push({ x: c.x, y: c.y - 6, text: text.trim() });
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
	snapshotInput.value = buildSnapshot(holds, annotations);
	paintHolds(grid, holds, pendingFrom);
    });

    paintHolds(grid, holds, null);
    drawOverlay(svg, uid, annotations, editorOpts);
    updateHint();
      
    paintHolds(grid, holds, null);
    drawOverlay(svg, uid, annotations, editorOpts);
    updateHint();
    snapshotInput.value = buildSnapshot(holds, annotations);
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
    drawOverlay(svg, uid, annotations, null);
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
