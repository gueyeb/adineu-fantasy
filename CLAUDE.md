# Claude Project Handoff

Read `AGENTS.md` first; its repository, testing, identity, and security rules are authoritative.

## Current State

- Production: `https://adineu-fantasy.bakene.tech/`
- Sleeper 2026: league `1392715510830878721`, 12 owners and 12 rosters, currently `pre_draft`.
- Yahoo archive: 2019–2025, seven seasons, 88/88 team-season identities across 16 managers.
- Birama is a Yahoo-only owner for `El Fenomeno` (2019) and `Ethan Hunt` (2020). Jonnel played both 2019 and 2020.
- Next data milestone: weekly Yahoo scoreboards for all-time head-to-head and streak records.

## Access Matrix

| System | Working access | Rules |
| --- | --- | --- |
| Sleeper | Public REST API | No authentication; sync with `npm run sync:sleeper:production`. |
| Supabase | MCP when connected, otherwise ignored `.env.production` | Secret key is server-only. Never print, commit, or place it in frontend code. |
| Yahoo archive | Existing authenticated Chrome session | Read-only extraction. Never inspect cookies/local storage or persist browser credentials. |
| Yahoo Fantasy API | Currently blocked after successful OAuth | Every tested Fantasy resource returned 403. Do not describe it as the archive source. |
| Coolify | GitHub deployment/UI | No assumed MCP. A push to `main` triggers the configured deployment. |
| n8n | Deployed weekly Sleeper workflow | Supabase secret is already stored there; do not duplicate it in tracked files. |

## Yahoo API Procedure

If Yahoo enables **Fantasy Sports Read**, use OAuth 2.0 authorization code flow with scope `fspt-r`:

1. Send the authorized Yahoo member to `https://api.login.yahoo.com/oauth2/request_auth`.
2. Exchange the returned code at `https://api.login.yahoo.com/oauth2/get_token`.
3. Store access/refresh tokens only in a server-side secret store.
4. Discover valid game, league, and team keys with:

   ```text
   GET https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/teams?format=json
   Authorization: Bearer <access-token>
   ```

5. Use the returned keys to fetch `league`, `standings`, `scoreboard`, `team`, `roster`, and `draftresults` resources. Refresh the access token server-side when required.

Do not invent Yahoo league keys from the numeric league IDs. The API integration is inactive until an authorized Fantasy request returns 200.

## Authenticated Archive Procedure

The reliable source is Yahoo's archived HTML in the logged-in Chrome session:

- Base URL: `https://football.fantasysports.yahoo.com/{year}/f1/{league_id}`
- Weekly results: append `?matchup_week={week}&module=matchups&lhst=matchups`
- League IDs: 2019 `103079`, 2020 `67190`, 2021 `75892`, 2022 `109259`, 2023 `767350`, 2024 `534755`, 2025 `518783`.

Extract final team scores, team IDs/names, week, and season. The weekly module covers regular-season matchups; playoff brackets require a separate extraction. Resolve managers through `public/data/yahoo-history.json` and preserve the page URL as provenance. Validate `teamCount / 2` matchups per complete week—six for 12-team seasons, seven for 2020–2021—and reconcile every team's wins, losses, PF, and PA against the final archive before importing.

Yahoo throttles rapid archived-page navigation. Process one season at a time. If the page becomes `Request denied`, stop immediately, save the validated seasons outside the repository, and resume later from the first missing week. Do not loop on reloads or replace verified history with inferred data.

## Verification

Run `npm run check`, `git diff --check`, and a focused secret scan before committing. Keep the untracked `env.example` untouched unless the user explicitly asks to add it.
