# Ravens Marlboro Playbook

The flag football playbook at **https://marlbororavens.com**.

- **Players** open it with the team PIN. They can drag pieces around on their own screen, flip a play, and double-tap a card to see it full screen.
- **Coaches** open it with their own coach PIN. They can edit plays, add plays, star plays and save for the team.

## How it runs

Everything runs on Cloudflare's free plan:

- **The page:** `public/`
- **A small Worker:** `src/worker.js`, which loads and saves the playbook.
- **A D1 database:** holds the current playbook and the last 30 saved versions.

The domain is registered at GoDaddy, and its DNS is on Cloudflare.

**Deploying:**
- **Automatic:** every push to `main` deploys by itself, through Cloudflare Workers Builds (root directory `/`, deploy command `npx wrangler deploy`).
- **By hand:** `npm run deploy` does the same.

## What's here

```
public/index.html       the playbook page: layout, drawing, PIN lock, editing (one file)
public/playbook.json    backup copy of the plays, used only if the Worker can't answer
src/worker.js           the Worker: GET /playbook, POST /save, and http:// or www. to https://marlbororavens.com
wrangler.toml           Cloudflare settings: domain routes, the page, the database
tools/playbook.mjs      command-line tools (below)
tools/lib/              shared helpers: PIN locking, tidying play drawings, headless Chrome, a tiny file server
tests/run.mjs           end-to-end tests (npm test)
tests/fixtures/         three sample plays the tests use
docs/league-rules.md    the league rules that matter when designing plays
```

## PINs and saving

- **Team PIN:** the plays are stored scrambled with it, using PBKDF2 and AES-GCM in the browser.
- **Coach PINs:**
  - Each coach PIN opens a small box that holds the *staff key*.
  - The staff key opens the team PIN.
  - The Worker only accepts a save that comes with the staff key. It checks the key's SHA-256 against the `STAFF_KEY_HASH` secret set on the Worker.
- **Managing PINs:** coaches add or remove coaches, and change the team PIN, in **Settings**. No one needs to know another coach's PIN.
- **Keeping PINs out of the repo:**
  - PINs never appear in this repo.
  - The tools read them from environment variables for a single command.

## Everyday tasks

- **Change plays:** on the site, with a coach PIN, then **Save for the team**.
- **Change the page:** edit `public/index.html`, run `npm test`, then push to `main`.
- **Command-line tools:** run `npm run playbook` to see them all.

```sh
TEAM_PIN=... npm run playbook -- list                            # every play, in order
npm run playbook -- preview new-plays.json                       # draw plays from a file to check them
TEAM_PIN=... COACH_PIN=... npm run playbook -- add new-plays.json
TEAM_PIN=... COACH_PIN=... npm run playbook -- rename <id> New Name
npm run playbook -- history                                      # the saved versions the server keeps
COACH_PIN=... npm run playbook -- restore <rev>                  # bring one back
npm run playbook -- backup                                       # refresh public/playbook.json from the live site
```

- **Local copy:** `npm run dev` serves one at http://localhost:8787, with its own local database.
- **Saving on the local copy:** put `STAFF_KEY_HASH="..."` in `.dev.vars`. Get the value from `COACH_PIN=... npm run playbook -- key-hash`.

## Writing plays in a file

`add` and `preview` read a JSON list of plays, like the ones in `tests/fixtures/plays.json`.

**The card:**
- It's 600 by 410. The line of scrimmage is at `y = 243`, and upfield means a smaller `y`.
- Every play starts from the team's usual lineup. The tools put everyone on these spots:
  - `1` at (90, 262)
  - `2` at (190, 262)
  - `C` at (300, 262)
  - `3` at (410, 262)
  - `4` at (510, 262)
  - `QB` at (300, 335)
  - `RB` at (245, 335) or (355, 335)

**The pieces:**
- `players`: exactly 7 O's (`"t":"O"`, labeled with `"l"`) and 7 X's (`"t":"X"`).
- `r`: the route points after the start. Mark a point `[x, y, 1]` to draw the segment leading to it dashed (a pitch or a throw).
- `hi`: draws that player blue, the primary.
- `gr`: draws that player green, the secondary.
- `dash` on the thrower: marks the throw.
- A note that starts with "Your run:" marks a play that uses the one run per four downs.

## Tests

`npm test` does the following:
- Runs the real Worker on your computer (`wrangler dev`, with a throwaway database) using made-up PINs.
- Uses the page in headless Chrome the way players and coaches do.
- Checks the players' view, dragging, Flip and full screen.
- Checks coach saves, stars and the green highlight.
- Checks adding and removing coaches and changing the team PIN.
- Checks the server's safety rules.

It needs Google Chrome. If Chrome is installed somewhere unusual, set `CHROME` to its path.

## Moving off GitHub Pages

The site used to be served by GitHub Pages. For devices that still have the old DNS answer, that old copy keeps running from the frozen `pages-transition` branch until about 2026-09-27. After that:
1. Turn GitHub Pages off: `gh api -X DELETE repos/vladbekker/ravens-playbook/pages`.
2. Delete the `pages-transition` branch.
