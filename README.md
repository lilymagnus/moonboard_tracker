# Climb Log

I hate the moonboard app, this is a personal space to log my climbs and betas to improve on the board.

It makes a local web app for logging Moonboard Masters 2017 (40°) problems and attempts. Your data stays on your machine.
 
## Features

- Add problems with name, Moonboard font grade, status, holds, tags, and notes
- Holds are checked against the board (columns A to K, rows 1 to 18)
- Filter the catalog by grade or status
- Log attempts with date, result, and notes. A "sent" attempt marks the problem as sent.
- Change status or delete problems
- Can edit previously logged problems and create variants of these linked back to the original
- Export to JSON and import it back for backups

## Setup

Requires Python 3.10 or newer.

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip3 install -r requirements.txt
```

## Run

```bash
python3 app.py
```

Then open http://127.0.0.1:5000 in your browser.

## Data

Problems are saved to `data/climb_log.json`. Use **Export** to keep a backup copy. The `data/` folder is git-ignored so your climbs don't end up in the repository.

## Project structure

```
app.py                 Flask app: routes, storage, validation
templates/index.html   Page template
static/styles.css      Styling
data/                  Your saved climbs (created automatically, git-ignored)
requirements.txt       Python dependencies
```
