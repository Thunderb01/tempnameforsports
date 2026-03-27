# Beyond the Portal

Static site + data tooling for the basketball transfer portal project.

## Project structure
- `data/team_codes.json` — hashed team access codes that are safe to publish
- `private/team_codes_PRIVATE.csv` — plaintext team codes for internal use only
- `generate_team_codes.py` — regenerates the public hashed file and the private plaintext file

## Run locally
Open `index.html` directly, or run a small local server:

- `python -m http.server 8080`
- then visit `http://localhost:8080`

## Team code workflow
Generate or refresh codes with:

`python generate_team_codes.py`

This writes:
- `data/team_codes.json`
- `private/team_codes_PRIVATE.csv`

Keep `private/` out of Git. The included `.gitignore` is set up for that.

## Deploy
This repo can still be used normally with GitHub. The cleanup here preserves the `.git` directory when working from the repo itself; only the private folder is ignored.
