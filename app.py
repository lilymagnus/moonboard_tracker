"""Climb Log: a local web app for logging Moonboard Masters 2017 (40°) problems."""

import json
import re
import uuid
from datetime import date, datetime
from pathlib import Path
import base64
import binascii

from flask import (
    Flask, Response, abort, flash, redirect, render_template, request,
    send_from_directory, url_for,
)

BASE_DIR = Path(__file__).parent
DATA_FILE = BASE_DIR / "data" / "climb_log.json"

GRADES = ["V2", "V2+", "V3", "V3+", "V4", "V4+", "V5", "V5+", "V6", "V6+"]
STATUSES = ["to-try", "projecting", "sent"]

# Masters 2017 board: columns A to K, rows 1 to 18
VALID_HOLD = re.compile(r"^([A-K])([1-9]|1[0-8])$")
MAX_LABEL_LENGTH = 60

SNAPSHOT_DIR = BASE_DIR / "data" / "snapshots"
MAX_SNAPSHOT_BYTES = 2_000_000

app = Flask(__name__)
app.secret_key = "change-me-for-local-use"


# ---------- Storage ----------

def load_problems():
    if not DATA_FILE.exists():
        return []
    try:
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def save_problems(problems):
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(problems, indent=2), encoding="utf-8")


def find_problem(problems, problem_id):
    for p in problems:
        if p["id"] == problem_id:
            return p
    abort(404)
# ---- SNAPSHOTS ----

def snapshot_filename(name, problem_id, problems):
    """Build a PNG filename from the problem name, adding a number if it's taken."""
    base = re.sub(r"[^A-Za-z0-9 _()-]", "", name).strip() or "problem"
    taken = {p.get("snapshot") for p in problems if p["id"] != problem_id}
    candidate, n = f"{base}.png", 2
    while candidate in taken:
        candidate = f"{base} {n}.png"
        n += 1
    return candidate


def save_snapshot(filename, data_url):
    """Save a PNG sent as a data URL. Returns the filename, or None if invalid."""
    prefix = "data:image/png;base64,"
    if not data_url or not data_url.startswith(prefix):
        return None
    try:
        raw = base64.b64decode(data_url[len(prefix):], validate=True)
    except (binascii.Error, ValueError):
        return None
    if len(raw) > MAX_SNAPSHOT_BYTES or not raw.startswith(b"\x89PNG"):
        return None
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    (SNAPSHOT_DIR / filename).write_bytes(raw)
    return filename


def remove_snapshot_file(filename):
    if filename:
        (SNAPSHOT_DIR / filename).unlink(missing_ok=True)


@app.route("/snapshots/<path:filename>")
def snapshot(filename):
    return send_from_directory(SNAPSHOT_DIR, filename, mimetype="image/png")

# ---------- Parsing and validation ----------

def parse_holds(text):
    """Parse 'C5 start, F9, H14 end' into [{'position': 'C5', 'role': 'start'}, ...]."""
    holds = []
    for part in text.split(","):
        tokens = part.split()
        if not tokens:
            continue
        role_word = tokens[1].lower() if len(tokens) > 1 else ""
        role = role_word if role_word in ("start", "end") else "middle"
        holds.append({"position": tokens[0].upper(), "role": role})
    return holds


def validate_holds(holds):
    if not holds:
        return "Please enter at least one hold."
    for h in holds:
        if not VALID_HOLD.match(h["position"]):
            return f'"{h["position"]}" is not on the board. Use columns A to K and rows 1 to 18.'
    if not any(h["role"] == "start" for h in holds):
        return "A problem needs at least one start hold."
    if not any(h["role"] == "end" for h in holds):
        return "A problem needs at least one end hold."
    return None

def parse_annotations(text):
    """Clean the arrows and labels JSON sent by the board editor.

    Labels are stored as free positions: {"x": 0-110, "y": 0-180, "text": "..."}.
    Older labels attached to a hold ({"pos": "C5", "text": "..."}) are converted.
    """
    empty = {"arrows": [], "labels": []}
    try:
        data = json.loads(text or "{}")
    except json.JSONDecodeError:
        return empty
    if not isinstance(data, dict):
        return empty

    def clean_pos(value):
        pos = str(value or "").strip().upper()
        return pos if VALID_HOLD.match(pos) else None

    def pos_centre(pos):
        col = "ABCDEFGHIJK".index(pos[0])
        row = int(pos[1:])
        return col * 10 + 5, (18 - row) * 10 + 5

    arrows = []
    raw_arrows = data.get("arrows") if isinstance(data.get("arrows"), list) else []
    for a in raw_arrows:
        if not isinstance(a, dict):
            continue
        start, end = clean_pos(a.get("from")), clean_pos(a.get("to"))
        if start and end:
            label = str(a.get("label", "")).strip()[:MAX_LABEL_LENGTH]
            arrows.append({"from": start, "to": end, "label": label})

    labels = []
    raw_labels = data.get("labels") if isinstance(data.get("labels"), list) else []
    for item in raw_labels:
        if not isinstance(item, dict):
            continue
        text_value = str(item.get("text", "")).strip()[:MAX_LABEL_LENGTH]
        if not text_value:
            continue
        try:
            x = min(max(float(item["x"]), 0), 110)
            y = min(max(float(item["y"]), 0), 180)
        except (KeyError, TypeError, ValueError):
            pos = clean_pos(item.get("pos"))
            if not pos:
                continue
            cx, cy = pos_centre(pos)
            x, y = cx, cy - 6
        labels.append({"x": round(x, 1), "y": round(y, 1), "text": text_value})

    return {"arrows": arrows, "labels": labels}

def parse_tags(text):
    return [t.strip().lower() for t in text.split(",") if t.strip()]


def format_holds(holds):
    return ", ".join(
        h["position"] if h["role"] == "middle" else f'{h["position"]} {h["role"]}' for h in holds
    )


# ---------- Routes ----------
def has_snapshot(problem):
    """True only if the saved picture file really exists."""
    filename = problem.get("snapshot")
    return bool(filename) and (SNAPSHOT_DIR / filename).is_file()


app.jinja_env.globals["has_snapshot"] = has_snapshot

@app.route("/")
def index():
    problems = load_problems()
    by_id = {p["id"]: p for p in problems}
    grade_filter = request.args.get("grade", "").strip().lower()
    status_filter = request.args.get("status", "all")

    visible = [
        p for p in problems
        if (not grade_filter or grade_filter in p["grade"].lower())
        and (status_filter == "all" or p["status"] == status_filter)
    ]

    # Map each parent problem to its variants
    variant_list = {}
    for p in problems:
        parent = p.get("parent_id")
        if parent:
            variant_list.setdefault(parent, []).append(p)
            
    # If "Make variant" was clicked, pre-fill the form from that problem
    prefill = by_id.get(request.args.get("variant_of", ""))
    if prefill:
        prefill_name = f"{prefill['name']} (variant)"
        prefill_holds = format_holds(prefill["holds"])
        prefill_annotations = json.dumps(prefill.get("annotations", {"arrows": [], "labels": []}))
    else:
        prefill_name = ""
        prefill_holds = ""
        prefill_annotations = json.dumps({"arrows": [], "labels": []})

    return render_template(
        "index.html",
        problems=visible,
        total=len(problems),
        grades=GRADES,
        statuses=STATUSES,
        grade_filter=grade_filter,
        status_filter=status_filter,
        today=date.today().isoformat(),
        format_holds=format_holds,
        by_id=by_id,
        variant_list=variant_list,
        prefill=prefill,
        prefill_name=prefill_name,
        prefill_holds=prefill_holds,
        prefill_annotations=prefill_annotations,
    )


@app.route("/problems", methods=["POST"])
def add_problem():
    holds = parse_holds(request.form.get("holds", ""))
    error = validate_holds(holds)
    grade = request.form.get("grade", "")
    if grade not in GRADES:
        error = error or "Please choose a valid grade."
    if error:
        flash(error)
        return redirect(url_for("index"))

    problems = load_problems()

    parent_id = request.form.get("parent_id", "")
    if not any(p["id"] == parent_id for p in problems):
        parent_id = None

    problem_id = uuid.uuid4().hex[:10]
    name = request.form.get("name", "").strip()
    snap_name = snapshot_filename(name, problem_id, problems)

    problems.append({
        "id": problem_id,
        "name": name,
        "grade": grade,
        "status": request.form.get("status") if request.form.get("status") in STATUSES else "to-try",
        "holds": holds,
        "annotations": parse_annotations(request.form.get("annotations", "")),
        "tags": parse_tags(request.form.get("tags", "")),
        "notes": request.form.get("notes", "").strip(),
        "beta": request.form.get("beta", "").strip(),
        "parent_id": parent_id,
        "snapshot": save_snapshot(snap_name, request.form.get("snapshot", "")),
        "attempts": [],
        "createdAt": datetime.now().isoformat(timespec="seconds"),
    })
    save_problems(problems)
    flash("Variant saved." if parent_id else "Problem saved.")
    return redirect(url_for("index"))

@app.route("/problems/<problem_id>/attempts", methods=["POST"])
def log_attempt(problem_id):
    problems = load_problems()
    problem = find_problem(problems, problem_id)
    result = request.form.get("result", "attempt")
    attempt_date = request.form.get("date") or date.today().isoformat()

    problem["attempts"].append({
        "date": attempt_date,
        "result": result,
        "notes": request.form.get("notes", "").strip(),
    })
    if result == "sent":
        problem["status"] = "sent"
    elif problem["status"] == "to-try":
        problem["status"] = "projecting"

    save_problems(problems)
    return redirect(url_for("index"))


@app.route("/problems/<problem_id>/status", methods=["POST"])
def set_status(problem_id):
    problems = load_problems()
    problem = find_problem(problems, problem_id)
    status = request.form.get("status")
    if status in STATUSES:
        problem["status"] = status
        save_problems(problems)
    return redirect(url_for("index"))


@app.route("/problems/<problem_id>/delete", methods=["POST"])
def delete_problem(problem_id):
    problems = load_problems()
    problem = find_problem(problems, problem_id)
    remove_snapshot_file(problem.get("snapshot"))
    problems = [p for p in problems if p["id"] != problem_id]
    save_problems(problems)
    flash("Problem deleted.")
    return redirect(url_for("index"))

@app.route("/problems/<problem_id>/edit")
def edit_problem(problem_id):
    problem = find_problem(load_problems(), problem_id)
    return render_template(
        "edit.html",
        p=problem,
        grades=GRADES,
        statuses=STATUSES,
        holds_text=format_holds(problem["holds"]),
        annotations_json=json.dumps(problem.get("annotations", {"arrows": [], "labels": []})),
        tags_text=", ".join(problem.get("tags", [])),
    )

@app.route("/problems/<problem_id>/update", methods=["POST"])
def update_problem(problem_id):
    problems = load_problems()
    problem = find_problem(problems, problem_id)

    holds = parse_holds(request.form.get("holds", ""))
    error = validate_holds(holds)
    grade = request.form.get("grade", "")
    if grade not in GRADES:
        error = error or "Please choose a valid grade."
    if error:
        flash(error)
        return redirect(url_for("edit_problem", problem_id=problem_id))

    name = request.form.get("name", "").strip()
    old_snapshot = problem.get("snapshot")
    new_snapshot = save_snapshot(
        snapshot_filename(name, problem_id, problems),
        request.form.get("snapshot", ""),
    )
    # If the name changed, the old picture file is no longer used
    if new_snapshot and old_snapshot and old_snapshot != new_snapshot:
        remove_snapshot_file(old_snapshot)

    problem.update({
        "name": name,
        "grade": grade,
        "status": request.form.get("status") if request.form.get("status") in STATUSES else problem["status"],
        "holds": holds,
        "annotations": parse_annotations(request.form.get("annotations", "")),
        "tags": parse_tags(request.form.get("tags", "")),
        "notes": request.form.get("notes", "").strip(),
        "beta": request.form.get("beta", "").strip(),
        "snapshot": new_snapshot or old_snapshot,
    })
    save_problems(problems)
    flash("Problem updated.")
    return redirect(url_for("index"))

@app.route("/export")
def export():
    body = json.dumps(load_problems(), indent=2)
    filename = f"climb-log-{date.today().isoformat()}.json"
    return Response(
        body,
        mimetype="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.route("/import", methods=["POST"])
def import_problems():
    upload = request.files.get("file")
    if not upload:
        flash("Choose a JSON file to import.")
        return redirect(url_for("index"))
    try:
        incoming = json.loads(upload.read().decode("utf-8"))
        if not isinstance(incoming, list):
            raise ValueError("expected a list of problems")
    except (ValueError, UnicodeDecodeError) as err:
        flash(f"That file could not be imported: {err}")
        return redirect(url_for("index"))

    problems = load_problems()
    existing_ids = {p["id"] for p in problems}
    new = [p for p in incoming if isinstance(p, dict) and p.get("id") and p["id"] not in existing_ids]
    save_problems(problems + new)
    flash(f"Imported {len(new)} new problem(s).")
    return redirect(url_for("index"))


if __name__ == "__main__":
    print("Climb Log running at http://127.0.0.1:5000")
    app.run(debug=True)
