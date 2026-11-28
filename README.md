# ECNL Schedule Pilot

Published ECNL and ECNL-RL schedules for boys and girls, plus conference standings, head-to-head comparisons, club pages, and a places page for home fields. A FastAPI service under `api/` stores the league in PostgreSQL 16. A Next.js app under `web/` is the dashboard.

The league file is the public AthleteOne JSON at `api.athleteone.com`, season `2026-27`. `api/load_league.py` reads four orgs: 12 (ECNL Boys), 16 (ECNL-RL Boys), 9 (ECNL Girls), and 13 (ECNL-RL Girls). Pre-ECNL orgs 21 and 22 are not loaded. Event ids 4423 and 4424 (a QA event and a non-US test event) are skipped.

There is no `render.yaml` and no other deploy file in this repository. Web and API start commands, and the Render service settings, live in the Render dashboard. The cron commands, environment variable names, and cadences that this repo does define are in [Cron setup](#cron-setup).

## Overview

### Dashboard (`web/`)

Boys and Girls are chosen on the page that needs one division. Team Schedules and Conference Standings each have a Boys/Girls control beside their other filters. Head-to-Head follows the first team, and the other team is that same gender. Clubs, Places, and the signed-in home show boys and girls together. There is no site-wide switch and no `ecnl-league-gender` value. A `gender` query on standings or head-to-head is used when one is present. A link such as `/?team=` opens that team even when it is the other gender.

| Page | Route | What it shows |
| --- | --- | --- |
| Team Schedules | `/` for a signed-out visitor, and `/?board=schedule` for everyone | Conference, age group, and team, then that team's games. Filters are all, home, and away. A Venue Guide link on a game opens that complex at `/locations/{venue_key}`. A signed-in visitor at `/` sees the favorites home instead. The header Team Schedules link and a team link such as `/?team=` still open this schedule. Slot 1 is the team that link opens first. |
| Clubs | `/clubs` | Club search. The list is capped at 30 clubs that have at least one squad. A club page is `/clubs/{id}` and shows boys and girls together. Its Venue Guide link opens `/locations?club=` for that club. The field rows on the club page open Google Maps. |
| Conference Standings | `/standings` | One conference table. The client asks for `mode=official` (stored rows) or `mode=calculated` (rows built from completed conference games). |
| Projected | `/projected` | One conference table of predicted standings. Predicted points are current points plus max(0, 3 − opponent points per game) for each remaining conference game. |
| Head-to-Head | `/head-to-head` | Two teams in the same gender: direct meetings, common opponents, and a scouting report built in `api/scouting.py` with no model calls. |
| Places | `/locations` | A club filter, then that club's home fields on a map, Club Ratings with stars, and family tips. `/locations/v2` and `/locations/v3` redirect here. Details are in [Places](#places). |
| Field | `/locations/{venue_key}` | One complex: scorecard stars, a map, stay and eat tips, and the rest of the tips. Add a tip opens `/locations/{venue_key}/tip`. |
| Add a family tip | `/locations/tip` | A dropdown of the club's fields (`?club=`), then the tip form. The field page uses `/locations/{venue_key}/tip`. |
| Profile | `/profile` | Google or Apple sign-in. Signed out, this page is only the sign-in card. Signed in, a side menu opens Favorites (`/profile/favorites`), Home address (`/profile/address`), and Team calendar (`/profile/calendar`). On a phone the menu stacks above the page. One club and up to four teams are saved on the account. Slot 1 is the default team. The home address is saved on the account. Each favorite team can store one PlayMetrics or TeamSnap calendar link. Those links are not fetched. |
| Privacy | `/privacy` | Privacy policy for the Premier Gameday HQ app. Favorites stay on the device. The app has no account and does not send personal data to the server. The website section covers the session cookie and location ratings. The two admin accounts can see account email on the users page and on a contribution’s history. Location pages do not show email or that history. Contact premiergamedayhq@gmail.com. |
| Support | `/support` | How to use Premier Gameday HQ without an account. Email premiergamedayhq@gmail.com, or send a report from the page. |
| Share image | `/api/og/h2h` | A 1200×630 image for a head-to-head link. It calls the API `/head-to-head` route. |
| Issue reports | `/admin` | Private inbox for reports sent from the app and from `/support`. Preferences has Report an Issue. The support form posts `category`, `description`, and an optional `email`, with `screen` `web-support` and `app_version` `web`. The phone waits 60 seconds after a successful send, and a failed send keeps the draft. The same five-reports-per-IP-per-hour limit applies. The page is not linked from the header, the footer, or any public page, and it sends `noindex`. It opens only for a signed-in `myuranv97@gmail.com` or `premiergamedayhq@gmail.com`. Anyone else stays on the public site. The same two accounts open Contributions, Users, and Terms from the side menu. History is not a menu item. Each contribution row has a History link. Choosing it opens a popup that requests only that rating, tip, or vote: the first submission, edits, hides, and restores, including the original comment. Closing the popup drops that payload. The contributions table does not include those history events. |

The browser calls `NEXT_PUBLIC_API_URL`, or `http://127.0.0.1:8000` when that variable is unset. The Open Graph route uses the same variable, or `http://localhost:8000`.

### Places

`/locations` is the Places page. It shows one club’s home fields on a map. No fields are listed until a club is chosen. The choice is stored as `?club=` and the page loads `GET /locations/club` and `GET /locations/map/club`. The closed filter shows the club name. When a club is chosen, that club's logo is shown once, inside the closed filter. Opening the filter calls `GET /clubs?all=true`, which is every club that has a squad, not the 30-club cap used by `/clubs`. Typing filters that list to 30 names. Each row has the club logo and the club name. A club that the API splits into more than one public name uses that public id, such as `1353-sporting-sa-jax`. The bare AthleteOne id is 404 for a split club.

The fields are that club's home complexes. A game is included only when one of the club's teams is the home team. `make_venue_key` in `api/app/locations.py` drops a trailing field number, so `Davis Park - Field 1` and `Field 2` are one place. The key is the cleaned name, the lowercase city, and the state. Away venues are not listed. Cards are ordered by venue name, city, state, then key. Each card shows the complex name, city and state, the overall line, and the five scores with a star. It also shows hotel, food, hangout, and parking counts, plus up to two tip lines. Open field goes to `/locations/{venue_key}`. Saved pins for those fields are drawn on the map. A pin is a saved lookup, not a verified location.

Club Ratings is above the field list. It is a centered heading, an overall line, and five scores. It has no card, border, or background. The scores are field quality, referees, parent vibe, parking, and amenities. Each one is a one-decimal number and a star. The overall line is like `3.6 overall · 2 ratings`, or `No ratings yet` when the count is zero. The numbers are one pooled average of every `venue_rating` row on those fields. They are not the average of each field's own average. Overall is the mean of the five criteria across those rows.

Add a Family Tip opens `/locations/tip`, or `/locations/tip?club=` when a club is already chosen. The page requires that club query. The field is labeled Field. One home field is static text. More than one is a dropdown of those fields, and that dropdown is not the place search. Hotel name and Restaurant name are a separate box and start empty. That box is what Geoapify searches. Street, city, state, and postal code sit under it. A picked match fills those fields from the street address. The hotel or restaurant name stays in the name box. Typing the place by hand leaves them editable, and save stores that address. Saving posts `POST /locations/recommendations` and returns to `/locations?club=`. The field page opens `/locations/{venue_key}/tip` instead. That wizard keeps the field on a map.

Hotel and Team Food and Dining can match a business. The first time someone adds one of those tips for a complex, `GET /locations/field-point` geocodes the complex name, city, and state and stores that point on `venue_field_point`. `TBD` is stored as skipped and is not geocoded. The form shows the matched field label and does not ask for suggestions until the person confirms that label. Suggestions are `GET /locations/places`: the typed hotel or restaurant name, lodging or food only, within twenty-five miles of the stored point. Lodging is a hotel, motel, or guest house. Food is a restaurant, fast-food place, or cafe. Each of those categories is requested on its own, because a combined category list makes the provider name filter return nothing. A short query does not call the provider. Picking one sends `place_id` with the tip. The API retrieves that place and stores `place_provider`, `place_id`, `matched_name`, `formatted_address`, `latitude`, `longitude`, and `place_fetched_at` on the same `venue_recommendation` row. The provider address is the one that is stored. Other families see the matched name and address. The Map link uses the stored address. A hotel or restaurant with no pick still saves the typed name. A hand-typed address is stored as `formatted_address` with no provider, place id, or coordinates, and the Map link uses it. Hangout, activity, and sideline stay free text and ignore an address. They keep the old search link. The Hotels and Restaurants buttons stay outbound map links. The provider is Geoapify. `GEOAPIFY_API_KEY` is read on the API process only. The browser sends the typed text and the field. It does not send the account, the email, or the home address, and the key is not logged or returned. A matched tip credits OpenStreetMap and Geoapify.

The field page scorecard shows the overall line, or `No family ratings yet`, and five rows: field quality, referees, parent and sideline vibe, parking and walkability, and amenities. Each row is 1 to 5 stars. A signed-in visitor’s stars save when all five rows are set. The map shows the field and pinned tips. Stay lists hotels. Eat lists restaurants and cafes. The tips list is under that, and each tip shows its stars. Add a tip opens `/locations/{venue_key}/tip`.

Ratings, tips, and tip votes require a signed-in website account. The website finishes Google or Apple sign-in, asks the API for a session, and stores the raw token in an httpOnly Secure SameSite=Lax cookie on premiergamedayhq.com. The browser does not send that cookie to the API host. The website server sends `Authorization: Bearer`. `user_id` stores the account id and `author_key` is `user:{id}`, so one account has one rating per complex and one vote per tip. The name on a tip is the account display name. Email is not shown on the location page. Rows already stored under a browser `author_key` stay visible and are not rewritten. Signed-out visitors can still read every location. A home address saved on the account is not public.

`/locations/v2`, `/locations/v2/{venue_key}`, and `/locations/v2/{venue_key}/tip` redirect to the same path under `/locations`. `/locations/v3` and its field and tip paths do the same. A `?club=` query is kept.

The club page Venue Guide link goes to `/locations?club=` for that club. The field rows under it still open Google Maps. A Venue Guide link on a team schedule opens `/locations/{venue_key}` for that one complex.

### API (`api/`)

`api/app/main.py` builds the FastAPI app. The title string on that app is `ECNL Boys Southeast Schedule`. The routes serve both genders and both tiers. On startup it creates any missing tables and adds columns the current models expect. CORS allows `http://localhost:3000` and `http://127.0.0.1:3000`, plus any extra origins in `ALLOWED_ORIGINS` (comma-separated). `*` is ignored.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/health` | Returns `{"status": "ok"}`. |
| GET | `/teams` | Lists `team` rows. Optional `q` (name substring), `age_group` (`U13`, `U14`, `U15`, `U16`, `U17`, or `U18/19`), `gender` (`boys` or `girls`), and `ids` (comma-separated team ids, for example `53,108`, at most 100). When `gender` and `ids` are both omitted, `gender` defaults to `boys`. When `ids` is set and `gender` is omitted, both genders are returned, in the order of `ids`. Each row includes `gender`, `tier`, `club_id`, `club_key`, and `logo_url` (the club logo, or null). `club_key` is the public `/clubs/{club_key}` id: the numeric id when every squad shares one name, or `{id}-{name-slug}` when the club has more than one team name. A split club's numeric id is not a page. |
| GET | `/teams/{team_id}/schedule` | Games for one team. `filter` is `all`, `home`, or `away`. |
| GET | `/mobile/dashboard` | Home payload for the mobile app and for the signed-in website home. Optional `team_ids` (comma-separated, at most 4, favorite order) and `club_id` (the same public club key as `/clubs/{club_key}`). Unknown team ids are skipped. An unknown `club_id` is 404. More than 4 ids, or a non-integer, is 400. Each team includes the next scheduled game, the latest completed result, conference rank, points per game (the official table when a row exists, otherwise conference games), and the overall and conference records. The club includes the combined record, the conference record, squad ranks, the past 10 days, and the next 10 days. The route does not read a profile key, does not require a token, and its response shape is unchanged. |
| GET | `/standings` | One conference table. Required: `conference`, `tier` (`ECNL` or `ECNL-RL`), `age_group`. `mode` is `official` or `calculated`. `gender` defaults to `boys`. Rank is points per game, then goal difference, then goals for, then name. Form is the last five completed conference results, computed when the request runs. |
| GET | `/standings/predicted` | One projected conference table. Required: `conference`, `tier`, `age_group`. `gender` defaults to `boys`. Completed conference games keep their points. Each remaining scheduled conference game adds max(0, 3 − opponent points per game). |
| GET | `/clubs` | Clubs that have at least one squad. Optional `q` is a case-insensitive name substring. Without `all=true` the list stops at `CLUB_LIST_LIMIT` (30). `all=true` returns every match. An empty query is ordered by squad count, then name. A club with more than one public spelling is returned as separate ids. |
| GET | `/clubs/{club_key}` | One club: squads, record, home venues, and recent weekends. An unknown key is 404, including a bare AthleteOne id when that club is split. |
| GET | `/locations` | Every published complex. Optional `search`, `state`, `home_lat`, and `home_lng`. The Places page does not call this route. It calls `/locations/club` and `/locations/map/club`. |
| GET | `/locations/club` | Required `club` (the public id). Home complexes, the Club Ratings `aggregate`, and `tips` for those fields. Unknown club is 404. Optional `home_lat` and `home_lng` fill `drive_minutes`. |
| GET | `/locations/map/club` | Required `club` (the public id). Saved map pins for that club's home fields. A field with no saved point is looked up once. Unknown club is 404. |
| GET | `/locations/map/field` | Required `venue_key`. The field pin and its pinned tips, nearest first. 404 when that complex has no games, no saved pin, and no tips. |
| GET | `/locations/detail` | `venue_key`, or venue name plus city and state. Optional `category` is one of the five tip categories. Optional `home`, `home_lat`, and `home_lng`. Optional `Authorization: Bearer` or `X-Profile-Key` fills `my_rating` and `my_vote`. A tip that has a stored place also includes `matched_name`, `formatted_address`, and `place_provider`. The Map link uses that address. 404 when that complex has no games, ratings, or tips. |
| POST | `/locations/rate` | Requires `Authorization: Bearer`. A missing token is 401. Scores are integers 1–5 for field quality, referees, parent vibe, parking, and amenities. `surface_vote` is `GRASS`, `TURF`, `MIXED`, or omitted. One row per `venue_key` and account. A later post from that account updates the row. The display name comes from the account. The same transaction appends a `location_write_event` row. The response shape is unchanged. |
| GET | `/locations/field-point` | Requires `Authorization: Bearer` and the current terms. Query `venue_name`, `city`, and `state`. Geocodes that complex once through Geoapify and returns `status` (`found`, `miss`, or `skipped`), `formatted_address`, and `map_url`. `TBD` is `skipped` and does not call Geoapify. A later call for the same complex reads `venue_field_point`. The response has no coordinates and no API key. A missing `GEOAPIFY_API_KEY`, or a provider failure, is 503 `Place lookup is unavailable` and is not cached. | 
| GET | `/locations/places` | Requires `Authorization: Bearer` and the current terms. Query `venue_key`, `category` (`HOTEL` or `RESTAURANT`), and `q`. Fewer than 3 characters returns an empty list and does not call Geoapify. Otherwise the typed name is searched within twenty-five miles of the cached field point. A hotel searches hotel, motel, and guest house. A restaurant searches restaurant, fast food, and cafe. Each category is its own provider request, and the nearer places are returned. Each suggestion has `place_id`, `name`, `formatted_address`, `street`, `city`, `state`, and `postal_code`. `street` is the street address. It is not the business name. No cached point returns an empty list. Another category is 400. | 
| POST | `/locations/recommendations` | Requires `Authorization: Bearer`. `category` is `HOTEL`, `RESTAURANT`, `COFFEE_GAP`, `ACTIVITY`, or `SIDELINE_TIP`. `rating` is 1–5. `tags` must be in `TIP_TAGS` in `api/app/locations.py`. Optional `place_id` is a Geoapify id. For a hotel or restaurant, the API loads that place and stores the provider, id, matched name, formatted address, and coordinates when the place is within 25 miles of the cached field and matches lodging or food. That stored address comes from the provider. Optional `formatted_address` is saved for a hotel or restaurant only when no place is stored. Hangout, activity, and sideline ignore `place_id` and `formatted_address`. A missing match still saves the typed title. The route builds `venue_key` from the venue name, city, and state. The display name comes from the account. The same transaction appends a `location_write_event` row. The response adds `matched_name`, `formatted_address`, and `place_provider` when a place was stored, and `formatted_address` when a hand-typed address was stored. It does not include the API key, the place id, or the coordinates. |
| POST | `/locations/recommendations/{recommendation_id}/vote` | Requires `Authorization: Bearer`. Body `{"choice": "up"}` or `{"choice": "down"}`. One vote per account. The same choice again changes nothing on the current vote row. An unknown id is 404. The same transaction appends a `location_write_event` row. The response is the tip, including `matched_name`, `formatted_address`, and `place_provider` when a place was stored. |
| POST | `/auth/session` | Called by the website with header `X-Internal-Auth` set to `AUTH_INTERNAL_SECRET`. Body is the provider, subject, email, whether that email is verified, display name, and client (`web`, `ios`, or `android`). Returns a raw session token once. If `AUTH_INTERNAL_SECRET` is missing, the response is 503 and names that variable. |
| GET | `/auth/me` | Requires `Authorization: Bearer`. Returns the display name, email, and providers. When a home address is saved, the response also includes `home_address` (`street`, `unit`, `city`, `state`, `postal_code`). With no address, that field is omitted, so the previous fields stay as they were. |
| GET | `/me` | Requires `Authorization: Bearer`. Returns the same person plus `club_id` and ordered `team_ids`. A club or team that no longer exists is left out of this response. This shape does not include the home address or calendar links. |
| PUT | `/me/favorites` | Requires `Authorization: Bearer`. Body `club_id` (a public club key, or null) and `team_ids` (at most four ids, in slot order). Replaces the account's favorites. An unknown club or team is 400. A team removed from the list loses its calendar link. |
| PUT | `/me/home-address` | Requires `Authorization: Bearer`. Saves `street`, `unit`, `city`, a US `state`, and `postal_code` on the account. Returns the same body as `GET /auth/me`, including `home_address`. Latitude and longitude stay empty. |
| DELETE | `/me/home-address` | Requires `Authorization: Bearer`. Removes the saved home address. |
| GET | `/me/calendars` | Requires `Authorization: Bearer`. Returns `calendars`: one PlayMetrics or TeamSnap link for each current favorite team that has one, in slot order. The link is returned only to that signed-in user. |
| PUT | `/me/calendars` | Requires `Authorization: Bearer`. Body `team_id`, `source` (`playmetrics` or `teamsnap`), and `url`. An `https` link is stored. A `webcal` link is rewritten to `https` before it is stored. Anything else is 400. The team must already be a favorite. A later save for the same team replaces that one row. The feed is not fetched. |
| DELETE | `/me/calendars/{team_id}` | Requires `Authorization: Bearer`. Removes that team's calendar link. |
| POST | `/auth/logout` | Deletes the bearer session. |
| DELETE | `/auth/account` | Deletes the user, identities, sessions, favorites, home address, calendar links, and that person’s ratings, tips, and votes. History rows in `location_write_event` stay, with the email and display name copied at the time of the write. Calendar links are not copied into that history. |
| GET | `/head-to-head` | Compares `team_a_id` and `team_b_id`. They must differ and share a gender. `conference_only` limits the games used. |
| GET | `/data-refresh` | `last_successful_finish` for the newest successful `data_refresh` row whose `job` is `schedule`. People and reference runs are not included. |
| POST | `/ingest/ics` | Fetches a public calendar and upserts `ingest_team` / `ingest_game`. |
| POST | `/ingest/url` | Renders a public schedule page with Playwright and upserts the same ingest tables. |
| POST | `/ingest/raw-text` | Parses pasted schedule text into the ingest tables. |
| POST | `/ingest/scores` | Upserts scores on ingest games and copies matching scores onto published `game` rows. |
| POST | `/ingest/standings` | Parses a pasted table into `conference_standing`. The rows it writes use gender `boys`. |
| POST | `/issues` | Public. No auth. Creates one row in `issue`. `category` is `data`, `app`, or `other`. `description` is required and not blank. `email` is optional. `app_version` and `screen` are required. At most five reports per IP address per hour. |
| GET | `/admin/history` | Requires `Authorization: Bearer` for `myuranv97@gmail.com` or `premiergamedayhq@gmail.com`. Anyone else is 403. No token is 401. Newest first. Optional `kind` (`rating`, `tip`, or `vote`), `venue` (name or key), and `email`. The website no longer links this list from the admin menu. | 
| GET | `/admin/users` | Same two accounts. Anyone else is 403. No token is 401. One row per account, newest `created_at` first, 50 per page. `page` starts at 1. Optional `q` matches display name or email. Each row has the name, email, providers, `created_at`, `last_login_at` (null when the account has no recorded login), favorite club name, favorite team names, and the saved home address. Calendar links and session tokens are not included. |
| GET | `/admin/terms` | Same two accounts. Anyone else is 403. No token is 401. One row per account, newest `created_at` first, 50 per page. `page` starts at 1. Optional `q` matches display name or email. Optional `accepted` is `yes` or `no` for the current terms (`ugc-1`); anything else is 400. Each row has the name, email, `terms_accepted_at`, `terms_version`, and `terms_accepted` (true only when both the timestamp and `ugc-1` are stored). The page also returns `terms_version` `ugc-1`. |
| POST | `/admin/terms/{id}/revoke` | Same two accounts. Clears `terms_accepted_at` and `terms_version` on that account. An unknown id is 404. The next review or tip from that account is refused until they agree to `ugc-1` again. |
| GET | `/admin/contributions` | Same two accounts. One page of current ratings, tips, and votes. The response does not include history events. |
| GET | `/admin/contributions/{kind}/{id}/history` | Same two accounts. `kind` is `rating`, `tip`, or `vote`. An unknown row is 404. Oldest first: the first submission, later edits, hides, and restores for that one contribution. A rating’s original comment stays on the create row after an edit. The contributions table does not include these events. |
| GET | `/admin/issues` | Requires `Authorization: Bearer` for `myuranv97@gmail.com` or `premiergamedayhq@gmail.com`. Anyone else is 403. No token is 401. `status` is `open` (default, newest first) or `done`. |
| PATCH | `/admin/issues/{id}` | Same account requirement. Body `{"done": true}` sets `status` to `done` and `completed_at`. `{"done": false}` sets `status` to `open` and clears `completed_at`. |

A paste dialog in the dashboard posts to `/ingest/raw-text`, `/ingest/scores`, and `/ingest/standings`.

### Database

PostgreSQL 16. `docker-compose.yml` runs `postgres:16`, publishes port 5432, and reads `.env`. The API does not use `DATABASE_URL`. `api/app/config.py` builds `postgresql+psycopg://...` from `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT`, and `POSTGRES_DB`. If all five are set in the process environment, those values win. If any one is missing, the same five keys are read from the `.env` file at the repository root.

`issue` stores in-app reports only. Columns are `id`, `created_at`, `category`, `description`, `email` (nullable), `app_version`, `screen`, `status` (`open` or `done`, default `open`), and `completed_at` (nullable).

Accounts live in `app_user`, `auth_identity`, and `app_session`. `app_user.last_login_at` is set when a session is created. On startup, an empty `last_login_at` is filled once from the newest `app_session.created_at`. An account with no session keeps it empty. `GET /auth/me` and `GET /me` do not include it. `terms_accepted_at` and `terms_version` record agreement to the current terms, `ugc-1`. Clearing both makes the next review or tip ask again. `user_favorite` stores one club (`position` 0) and up to four teams (`position` 1 through 4) for an account. `user_home_address` stores one street address for that account. `user_calendar` stores one PlayMetrics or TeamSnap link per favorite team. `app_session` stores a hash of the token, never the raw token. Set `AUTH_INTERNAL_SECRET` on the API and on the website. The website also needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY`. Set `GEOAPIFY_API_KEY` on the API process for hotel and restaurant lookup. The website does not read that key. When it is missing, a tip still saves the typed name. Sign-in fails clearly when a required value is missing. Redirects are `https://premiergamedayhq.com/api/auth/google/callback` and `https://premiergamedayhq.com/api/auth/apple/callback`.

## Code layout

```
api/
  app/main.py              FastAPI app, CORS, /health, startup schema
  app/config.py            Postgres URL from the five POSTGRES_* variables
  app/database.py          Engine, sessions, column and check-constraint updates
  app/models.py            All tables
  app/schemas.py           Response models
  app/routers/             HTTP routes listed above
  app/refresh.py           In-place upsert of team, game, and standings; data_refresh rows
  app/capture.py           Clubs, coaches, players, ratings, playoff, weather, live events
  app/standings.py         Official and calculated conference tables
  app/predictions.py       Predicted conference table
  app/head_to_head.py      Matchup comparison
  app/clubs.py             Club search, club page, and home venues
  app/auth.py              Accounts, hashed sessions, and the shared internal secret
  app/issues.py            Issue validation and the per-IP limit
  app/locations.py         Complex keys, ratings, tips, and the club field directory
  app/places.py            Geoapify field geocoding and hotel or restaurant lookup
  app/logos.py             Club logo lookup for a team
  app/ingestion/           Parse and upsert pasted or fetched club schedules
  load_league.py           Download AthleteOne JSON
  refresh_league.py        Schedule cron entrypoint
  refresh_people.py        People cron entrypoint
  refresh_reference.py     Reference cron entrypoint
  seed.py                  Drop and reload team, game, and conference_standing from the JSON file
  data/ecnl_boys_2026_27.json
  tests/                   unittest modules
  scouting.py              Head-to-head scouting report
web/
  app/                     Routes /, /clubs, /standings, /projected, /head-to-head, /locations, /locations/tip, /profile, /profile/favorites, /profile/address, /profile/calendar, /privacy, /support, /admin, /admin/contributions, /admin/users, /admin/terms, /api/og/h2h
  components/              Schedule, standings, projected, clubs, locations, head-to-head, profile, and ingest UI
  lib/                     API client, gender, conferences, formatting
docker-compose.yml         Postgres 16
.env.example               Variable names for local Postgres and the web app
```

`api/app/ingestion/` splits into `fetch.py` (public HTTP and Playwright), `parsing.py` (ICS, HTML, pasted text, scores, standings text), `normalizer.py` (venue, team name, conference vs showcase), `upsert.py` (ingest games and scores), and `league_scores.py` (copy a parsed score onto a published `game`).

Tests, all under `api/tests/`:

| Module | Covers |
| --- | --- |
| `test_refresh.py` | In-place league upsert, the seven-day skip, and `data_refresh` success and failure. |
| `test_capture.py` | People and reference pulls, and that `/data-refresh` ignores a reference job. |
| `test_ingestion.py` | Ingest parsing, ingest endpoints, and the scouting meter. |
| `test_startup_schema.py` | Columns added on startup. |
| `test_clubs.py` | Club search cap, split public ids, club detail, records, and weekend windows. |
| `test_locations.py` | One complex per field number, one rating per profile, tips, and the pooled club directory. |
| `test_favorites.py` | Saving one club and up to four ordered teams, and dropping a missing club or team from `GET /me`. |
| `test_history.py` | History rows for ratings, tips, and votes, the admin allow list, and rows that stay after delete account. |
| `test_predictions.py` | Predicted points from opponent points per game, and `/standings/predicted`. |
| `test_mobile.py` | Enriched `/teams` rows and `GET /mobile/dashboard`. |
| `test_issues.py` | Creating a report, the per-IP limit, the admin allow list, and the done checkbox. |
| `test_auth.py` | Session tokens, linking a verified email, Apple private relay, and deleting an account. |
| `test_profile.py` | Saving, reading, and clearing a home address. A rejected calendar link, one link per favorite team, and delete-account removing the address and that user's links. |
| `test_admin_users.py` | `last_login_at` on a new session, the one-time session backfill, a second users page, a contributions table with no history events, and a single-row history list that keeps the original comment. |
| `test_admin_terms.py` | The admin terms list, and revoke clearing acceptance so the next review or tip asks again. |

`web/README.md` is the Next.js template text. It does not describe this project.

## Batch jobs

Three jobs write a `data_refresh` row: `schedule`, `people`, and `reference`. Two more scripts download or reload data and do not write `data_refresh`. None of these scripts drop the database except `seed.py`, which drops three tables and is not a cron job.

Every refresh opens a `data_refresh` row with `status` `running`, then sets `success` or `failure` and `finished_at`. A failure updates only that row. Older success rows stay. `error` is truncated to 4000 characters, and a Postgres URL in the message is redacted. Counts on a success row are `teams_count`, `games_count`, and `scores_count`. The people and reference jobs reuse those three columns for different counts. The log line is the one to read.

### Schedule: `refresh_league.py`

Downloads the four leagues, upserts `team` and `game` in place, rebuilds `conference_standing`, then tries the live capture. It does not drop tables and does not use Playwright.

```bash
cd api && python refresh_league.py
```

The cron command omits `--full`. Pass `--full` only when you want every stored game updated, including completed games older than seven days.

What it loads:

1. `load_league.load()` downloads each org from AthleteOne, writes `api/data/ecnl_boys_2026_27.json`, and returns teams, games, and flight metadata. The JSON file does not contain the flights. The in-memory payload does.
2. `upsert_published` matches an existing team by `source_id`, then by name, age group, tier, conference, and gender, then by a single team with the same name, age group, tier, and gender whose `source_id` is empty or already that id. Games match by `source_id`, or by home team, away team, and kickoff. If several games share that kickoff, the venue name has to match too. Changed rows are updated. Missing rows are inserted.
3. For `ECNL` and then `ECNL-RL`, it deletes `conference_standing` rows for that tier (boys and girls separately) and inserts a table computed from completed conference games. A win is 3 points and a draw is 1. Teams with no results stay at zero. The upsert key is conference, tier, gender, age group, and team name.
4. `capture_live` then reads standings extras and bracket seeds, and keeps weather, match events, and embedded lineups for games that start within the next 48 hours. Weather and match events outside that window are deleted. If this step raises, the schedule job still succeeds. The log line is `League context skipped <error>`.

Window and skips:

- Without `--full`, a stored game is left unchanged when its status is `COMPLETED` and `starts_at` is more than seven days before the run. The log calls this the seven-day window. The download itself is still the whole season.
- A game row is examined only when it has `source_id`, `home_source_id`, and `away_source_id`. It is written only when both clubs resolve to teams in the same age group and the same gender.
- During the download, matches with `isactive` 0, or with no home or away team, are dropped. Team rows are built from conference matches. A non-conference game can still attach to a club when exactly one stored team has that club, age group, and gender.
- The saved team list is ordered by tier, conference, age group, name, and `source_id`. Games are ordered by `starts_at`, then `source_id`. The upsert walks that order.
- `teams_count` is teams inserted or whose fields changed, not the number of teams in the file. `games_count` is games inserted or whose schedule fields changed. `scores_count` is games whose status or score changed, including new games that already have a result.

Progress, in order:

```text
League refresh start 2026-01-01T00:00:00Z
Teams started
Teams finished written=<n>
Games started seven-day window
Games progress examined=<n> written=<n> skipped=<n> old completed games
Games finished examined=<n> written=<n> skipped=<n> old completed games
Standings started ECNL
Standings finished ECNL
Standings started ECNL-RL
Standings finished ECNL-RL
teams=<n> games=<n> scores=<n>
League refresh success 2026-01-01T00:00:00Z
```

`Games started full pass` replaces the seven-day line when `--full` is set. The progress line is printed every 5000 games examined. Download lines, before the upsert, look like `Fetching ECNL boys: <n> events, <n> flights.`, `Loaded <n> matches. Resolving venue zips.`, a per-league summary with `conferences=`, `teams=`, `games=`, `completed=`, `postponed=`, `zips_ok=`, `zips_skipped=`, and `venue_fallbacks=`, then `Wrote ecnl_boys_2026_27.json: teams=<n> games=<n>`.

Flight schedules are fetched with six workers. Each AthleteOne request is tried four times, with a 60 second timeout, and sleeps `1.5 * (attempt + 1)` seconds between tries. Venue city and state come from `api.zippopotam.us` with a 2 second timeout. After three failures and no successes, zip lookup stops and later games use the home club city. The log line is `Zip lookup is not responding. Remaining zips will use the home club city.`

A finished run has `League refresh success <UTC time>` and a `data_refresh` row with `job` `schedule`, `status` `success`, `finished_at` set, and the three counts. Failure prints `League refresh failure <UTC time> <error>` and sets that row to `failure`. `GET /data-refresh` then stays on the previous schedule success.

### People: `refresh_people.py`

Coaches and player profiles. The module docstring calls this the weekly job. It does not write games, scores, or standings.

```bash
cd api && python refresh_people.py
```

It discovers 2026-27 flights for the four orgs, then reads each flight's team list. A head coach name on that list is upserted into `coaching_staff` (unique on source team, name, and role). Phone numbers and email are not stored. It probes three roster paths on one sample team. If one returns a list, every team is read from that path and upserted into `player` by `source_id`. Email, home address, date of birth, and parent contact are not stored. If none of the roster paths returns a list, no player rows are written and the log says `Player profiles: no public roster endpoint. No player rows written.`

`data_refresh.teams_count` is coaches written. `games_count` is players written. `scores_count` is 0. The log prints `coaches=<n> players=<n>`, which is those two counts.

On start it prints one `Unavailable: ...` line for each note in `api/app/capture.py`. Those notes say the public feed has no stream link, field surface, venue address, coordinates, postponement reason, capped goal difference, RPI, strength of schedule, national rank, playoff seed, wildcard cutoff, coach id, parent club id, or match token, and that no public roster, showcase, scout, college-coach, or weather route returned these fields.

Success is `People refresh success <UTC time>` and a `data_refresh` row with `job` `people` and `status` `success`. Failure is `People refresh failure <UTC time> <error>`. A roster or directory failure stays on this job. It does not change the schedule job's last success. `/data-refresh` does not report this row.

### Reference: `refresh_reference.py`

Clubs, event squads, and directory probes. The module docstring calls this the monthly job. It does not write scores.

```bash
cd api && python refresh_reference.py
```

For each of the four orgs it upserts `club` from the org club list. `club.id` is the AthleteOne club id. It then upserts `team_event` for each squad in each discovered flight, keyed by event id, flight id, and source team id. `kind` is `league` when the event counts as a conference event, otherwise `playoff`, `scout`, `friendly`, or `showcase` when that word is in the event name, otherwise `showcase`. It probes showcase, scout, and college-coach paths and upserts `showcase`, `scout_attendance`, and `college_coach` only when a path returns rows. Contact details are not stored. The same `Unavailable:` lines as the people job print first. If those routes are not public, this job still records success and simply writes no directory rows.

`data_refresh.teams_count` is club rows upserted, including updates. `games_count` is new `team_event` rows only. `scores_count` is 0. The log prints `clubs=<n> squads=<n>`.

Success is `Reference refresh success <UTC time>` and a `data_refresh` row with `job` `reference` and `status` `success`. Failure is `Reference refresh failure <UTC time> <error>`.

### Download and one-time load

These are not cron jobs. They do not write `data_refresh`.

| Command | What it does |
| --- | --- |
| `cd api && python load_league.py` | Downloads all four leagues and overwrites `api/data/ecnl_boys_2026_27.json`. |
| `cd api && python load_league.py --scores` | Rewrites scores in that file from published box scores. Does not reload venues. Prints `Updated ecnl_boys_2026_27.json: completed=<n> scheduled=<n> missing=<n> official_matches=<n>`. |
| `cd api && python load_league.py --merge` | Downloads only a league whose tier and gender are missing from the file. |
| `cd api && python seed.py` | Drops `conference_standing`, `game`, and `team`, then inserts the JSON file and rebuilds standings for `ECNL` and `ECNL-RL`. Prints `Seeded ECNL Boys <season>: teams=<n> games=<n> completed=<n> ecnl_standings=<n> rl_standings=<n>`. |
| `cd api && python seed.py --apply-scores` | Writes scores from the JSON file onto existing `game` rows and rebuilds ECNL standings. Refuses the write when unmatched and ambiguous games together exceed 50. |

`seed.py` is a full reload of those three tables. Do not point it at a database you need to keep.

The schedule refresh also calls `capture_live`, which is not its own command. When a standings or bracket request fails for one flight it prints `Standings skipped flight <id>: <error>` or `Brackets skipped flight <id>: <error>` and continues.

## Database structure

Tables are created from `api/app/models.py` on API startup and at the start of each refresh. Integer primary keys are generated by the database except `club.id`.

Check constraints:

- `team.age_group` is `U13`, `U14`, `U15`, `U16`, `U17`, or `U18/19`.
- `team.tier` is `ECNL` or `ECNL-RL`. The default is `ECNL`.
- `team.gender`, `conference_standing.gender`, and `team_event.gender` are `boys` or `girls`. The default on `team` and `conference_standing` is `boys`.
- `player.gender` is null or `boys` or `girls`.
- `game.status` and `ingest_game.status` are `SCHEDULED`, `COMPLETED`, `POSTPONED`, or `CANCELLED`. The default is `SCHEDULED`.
- `data_refresh.status` is `running`, `success`, or `failure`.
- `data_refresh.job` is `schedule`, `people`, or `reference`. The default is `schedule`.
- Each `venue_rating` score (`field_quality`, `referees`, `parent_vibe`, `parking_access`, `amenities`) is from 1 to 5.
- `venue_rating.surface_vote` is null or `GRASS`, `TURF`, or `MIXED`.
- `venue_recommendation.category` is `HOTEL`, `RESTAURANT`, `COFFEE_GAP`, `ACTIVITY`, or `SIDELINE_TIP`.
- `venue_recommendation.rating` is from 1 to 5, and `upvotes` is at least 0.

`team_rating`, `playoff_picture`, `wildcard_cutoff`, and `showcase` store gender and tier as strings and do not add those checks.

### Published league tables

| Table | Purpose | Primary key and rules | Written by |
| --- | --- | --- | --- |
| `team` | One published squad. City and state are the club home. | `id`. `source_id` is unique. Indexed on name, age group, and `club_id`. `club_id` is not a foreign key. | Schedule upsert. `seed.py` replaces the table and does not set `source_id`. |
| `game` | One published match. | `id`. `source_id` is unique. `home_team_id` and `away_team_id` reference `team.id`. Indexed on the two team ids and `starts_at`. | Schedule upsert. Score ingest can update a matching published game. `seed.py` replaces the table. |
| `conference_standing` | One official conference row. Re-importing the same club updates it. | `id`. Unique on `conference`, `tier`, `gender`, `age_group`, `team_name`. `team_id` references `team.id` and may be null. | Schedule refresh deletes and rebuilds both tiers. `capture_live` can set `capped_goal_diff` when the feed has it. `POST /ingest/standings` upserts boys rows. |
| `club` | One AthleteOne club. | `id` is the AthleteOne club id and is not autoincremented. `parent_club_id` stays null when the feed omits it. | Reference job. |

`team` columns: `name`, `age_group`, `tier`, `conference`, `city`, `state`, `source_id`, `gender`, `club_id`.

`game` columns: `home_team_id`, `away_team_id`, `starts_at`, `venue_name`, `city`, `state`, `timezone` (default `America/New_York`), `event`, `status`, `home_score`, `away_score`, `is_conference_game` (default true), `source_id`, `venue_address`, `venue_zip`, `venue_lat`, `venue_lng`, `field_name`, `stream_link`, `field_surface`, `postponement_reason`. The capture notes say the public schedule rows do not include stream, surface, address, coordinates, or a postponement reason, so those columns stay null unless a payload actually contains them.

`conference_standing` columns: `conference`, `tier`, `gender`, `age_group`, `capped_goal_diff`, `team_id`, `team_name`, `games_played`, `wins`, `losses`, `draws`, `goals_for`, `goals_against`, `goal_diff`, `points`, `points_per_game`, `updated_at`.

`club` columns: `name`, `parent_club_id`, `logo_url`.

### Family location tables

These are written by the locations routes, not by the refresh jobs. `venue_key` is the cleaned complex name, lowercase city, and state from `make_venue_key`.

| Table | Purpose | Primary key and rules | Written by |
| --- | --- | --- | --- |
| `venue_rating` | One browser profile's stars for one complex. A second submit from the same profile updates the row. | `id`. Unique on `venue_key`, `author_key`. Score and surface checks above. | `POST /locations/rate`. |
| `venue_recommendation` | One family tip for one complex: hotel, food, hangout, activity, or sideline and parking. A picked hotel or restaurant also stores the public business name, address, and point. | `id`. Category, rating, and upvote checks above. | `POST /locations/recommendations`. Votes use `POST /locations/recommendations/{id}/vote`. | 
| `venue_field_point` | One geocoded complex, keyed by `venue_key`. `status` is `found`, `miss`, or `skipped`. | `venue_key`. | `GET /locations/field-point`, the first time someone adds a hotel or restaurant tip for that complex. |
| `location_write_event` | One history row for a rating, tip, or vote. It is not rewritten, and it stays after the account is deleted. | `id`. `kind` is `rating`, `tip`, or `vote`. `action` is `create`, `update`, `hide`, `restore`, or `edit`. No foreign key to `app_user`, `venue_rating`, or `venue_recommendation`. | The same transaction as the location write or the admin hide, restore, or edit. `GET /admin/history` and `GET /admin/contributions/{kind}/{id}/history` read it. |

`venue_rating` columns: `venue_key`, `venue_name`, `city`, `state`, `author_key`, `user_id` (the account id for a signed-in rating; older rows stay null), `author_name`, `field_quality`, `referees`, `parent_vibe`, `parking_access`, `amenities`, `surface_vote`, `comment`, `updated_at`.

`venue_recommendation` columns: `venue_key`, `venue_name`, `city`, `state`, `category`, `title`, `rating`, `review_text`, `tags` (comma-separated, or null), `author_name` (the account display name; older rows keep the name they were saved with), `author_key`, `user_id` (the account id for a signed-in tip; older rows stay null), `upvotes` (default 0), `created_at`. A picked hotel or restaurant also sets `place_provider` (`geoapify`), `place_id`, `matched_name`, `formatted_address`, `latitude`, `longitude`, and `place_fetched_at`. A hand-typed hotel or restaurant address sets `formatted_address` only. Those place columns stay null when the tip is free text.

`venue_field_point` columns: `venue_key` (primary key), `venue_name`, `city`, `state`, `status` (`found`, `miss`, or `skipped`), `provider`, `place_id`, `formatted_address`, `latitude`, `longitude`, `fetched_at`. `skipped` is a `TBD` complex. `miss` is a geocode with no result. A provider failure is not written.

`location_write_event` columns: `created_at`, `user_id`, `email`, `display_name` (both copied at that moment), `kind`, `venue_key`, `venue_name`, `rating_id`, `tip_id`, `action`, `previous_values`, `new_values`. A rating stores the five scores, `surface`, and `comment`. A tip stores `category`, `title`, `stars`, `review_text`, and `tags`. A matched tip also stores `place_provider`, `place_id`, `matched_name`, `formatted_address`, `latitude`, and `longitude`. A hand-typed address stores `formatted_address` without those place columns. A vote stores `choice`.

`user_favorite` columns: `user_id`, `kind` (`club` or `team`), `ref` (the public club key, or the team id as text), `position` (0 for the club, 1 through 4 for teams). Unique on user plus kind plus ref, and on user plus kind plus position. Deleting the account deletes these rows.

`user_home_address` columns: `user_id` (primary key, references `app_user.id`, deleted with the account), `street`, `unit`, `city`, `state`, `postal_code`, `latitude`, `longitude`. Latitude and longitude stay null. The row is not public and is not written into location history.

`user_calendar` columns: `user_id` (references `app_user.id`, deleted with the account), `team_id` (references `team.id`, deleted with that team), `source` (`playmetrics` or `teamsnap`), `url`. Unique on user plus team. The url is a secret link for that signed-in user. Removing the team from favorites deletes the row. The feed is not fetched, and the url is not shown on public pages, location pages, admin history, or the admin users list.

### Ingest tables

These hold pasted or fetched club schedules. They are separate from `team` and `game`.

| Table | Purpose | Primary key and rules | Written by |
| --- | --- | --- | --- |
| `ingest_team` | A club created while importing a schedule. | `id`. Unique on `name`, `age_group` (`uq_ingest_team_name_age`). | `POST /ingest/ics`, `/ingest/url`, `/ingest/raw-text`, and `/ingest/scores`. |
| `ingest_game` | One imported match. `match_key` ignores kickoff and field so a re-import updates them. | `id`. `match_key` is unique. `home_team_id` and `away_team_id` reference `ingest_team.id`. | Same ingest routes. Scores use `ON CONFLICT (match_key)` and do not clear a score on a later schedule import. |

`ingest_team` columns: `name`, `age_group` (default `Unknown`), `tier`, `home_complex`.

`ingest_game` columns: `match_key`, `date`, `kickoff_time`, `home_team_id`, `away_team_id`, `complex_name`, `field_number`, `city_state`, `is_showcase`, `status`, `home_score`, `away_score`, `is_conference_game` (default true).

### Refresh log

| Table | Purpose | Primary key and rules | Written by |
| --- | --- | --- | --- |
| `data_refresh` | One run of the schedule, people, or reference job. A failure does not replace the last success. | `id`. Checks on `status` and `job`. | The three refresh scripts. |

Columns: `job`, `started_at`, `finished_at`, `status`, `teams_count`, `games_count`, `scores_count`, `error`. See [Batch jobs](#batch-jobs) for what the counts mean for each job.

### Reference tables

The people job, the reference job, and `capture_live` (the end of the schedule job) fill these. `capture.py` records that several of the source routes are not public. A missing field stores null. No directory row is inserted when the probe returns nothing.

| Table | Purpose | Primary key and rules | Written by |
| --- | --- | --- | --- |
| `team_event` | One squad inside a league event or showcase flight. Does not create a second `team` row. | `id`. Unique on `event_id`, `flight_id`, `source_team_id`. `team_id` references `team.id` and is set null if that team is deleted. Gender check. `kind` defaults to `league`. | Reference job. |
| `coaching_staff` | A coach on a club or team. Phone numbers and personal email are not columns. | `id`. Unique on `source_team_id`, `name`, `role`. `team_id` references `team.id` and is set null on delete. | People job, from the head coach on the flight team list. |
| `player` | A public player profile. Email, home address, date of birth, and parent contact are not columns. | `id`. `source_id` is unique. `team_id` references `team.id` and is set null on delete. Gender check allows null. | People job when a roster route returns players. `capture_live` can also upsert a player from an embedded lineup. |
| `match_player` | Lineup slot and match stats for one player in one game, only when AthleteOne sends them. | `id`. Unique on `game_id`, `source_player_id`. `game_id` references `game.id` and is deleted with the game. `player_id` references `player.id` and is set null on delete. | `capture_live`, from a lineup on a game inside the 48-hour window. |
| `team_rating` | RPI, strength of schedule, and national rank. Conference rank stays on `conference_standing`. | `id`. Unique on `gender`, `tier`, `age_group`, `source_team_id`. `team_id` references `team.id` and is set null on delete. | `capture_live`, only when a standings row has at least one of those three values. |
| `playoff_picture` | National playoff status for one squad. The seed is stored here, not as conference rank. | `id`. Unique on `gender`, `tier`, `age_group`, `source_team_id`. `team_id` references `team.id` and is set null on delete. | `capture_live`, from standings fields or from flight brackets. |
| `wildcard_cutoff` | Points-per-game cutoff for one gender, tier, and age. No row is stored when the feed omits it. | `id`. Unique on `gender`, `tier`, `age_group`. | `capture_live`. |
| `showcase` | A national showcase catalog entry. | `id`. `source_id` is unique when present. | Reference job, when a showcase path returns rows. |
| `scout_attendance` | Scout attendance for an event or game. Contact details are not stored. | `id`. `source_id` is unique when present. `game_id` references `game.id` and is set null on delete. | Reference job, when a scout path returns rows. |
| `college_coach` | College coach directory: name, school, and role only. | `id`. Unique on `name`, `school`, `role`. | Reference job, when a college-coach path returns rows. |
| `game_weather` | One weather snapshot for a game that starts within the next 48 hours. Older games are deleted. | `id`. `game_id` is unique and references `game.id`. Deleted with the game. | `capture_live`, and only if the downloaded game payload includes a weather object. |
| `match_event` | A match event for a game in that same 48-hour window. Older games are deleted. | `id`. Unique on `game_id`, `source_id`. `game_id` references `game.id` and is deleted with the game. | `capture_live`, when the game payload includes events. |

`player` columns: `source_id`, `first_name`, `last_name`, `photo_url`, `gender`, `position`, `graduation_year`, `jersey_number`, `height`, `weight`, `club_id`, `team_id`, `gpa`, `college_commitment`, `high_school`.

`match_player` columns: `game_id`, `player_id`, `source_player_id`, `lineup_slot`, `minutes`, `yellow_cards`, `red_cards`, `formation`.

`team_rating` columns: `source_team_id`, `team_id`, `gender`, `tier`, `age_group`, `rpi`, `strength_of_schedule`, `national_rank`.

`playoff_picture` columns: `source_team_id`, `team_id`, `gender`, `tier`, `age_group`, `status`, `playoff_seed`.

`game_weather` columns: `game_id`, `summary`, `temperature`, `fetched_at`.

`match_event` columns: `game_id`, `source_id`, `minute`, `kind`, `detail`, `fetched_at`.

## Cron setup

Nothing in this repository schedules a refresh. There is no `render.yaml`, crontab, or other start command. The only invocations are the three scripts below, run by hand or by a Render cron service you configure in the dashboard. `refresh_league.py` then calls `capture_live`. That is not a fourth job. Tests call the Python functions directly and do not name a schedule.

No code, comment, or test names a 12-hour league refresh. The schedule interval is set in Render and is not in the repo. The cron command for that job omits `--full`. The people and reference module docstrings say weekly and monthly. They do not name a day or an hour, and they do not name a Render schedule expression.

The running API and each cron job read the same five environment variables. `api/app/database.py` opens Postgres with `build_database_url()` in `api/app/config.py`. `refresh_league.py`, `refresh_people.py`, and `refresh_reference.py` import that engine. The names are `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT`, and `POSTGRES_DB`. If all five are set in the process environment, those values are used. If any one is missing, the same five keys are read from the repository `.env`, which a Render cron service will not have. `.env.example` also contains `DATABASE_URL`. The API and the cron scripts do not read `DATABASE_URL`.

| Variable | Read by |
| --- | --- |
| `POSTGRES_USER` | API process and all three cron jobs. |
| `POSTGRES_PASSWORD` | API process and all three cron jobs. |
| `POSTGRES_HOST` | API process and all three cron jobs. |
| `POSTGRES_PORT` | API process and all three cron jobs. |
| `POSTGRES_DB` | API process and all three cron jobs. |

`ALLOWED_ORIGINS` is read by the API process only. `NEXT_PUBLIC_API_URL` is read by the Next.js app only. Neither is read by a cron job.

| Job | `data_refresh.job` | Command | Schedule this repo states | Success |
| --- | --- | --- | --- | --- |
| Schedule | `schedule` | `cd api && python refresh_league.py` | Interval is set in Render and is not in the repo. Do not add `--full`. | Log ends with `League refresh success <UTC time>`. The new `data_refresh` row has `status` `success` and `finished_at` set. `GET /data-refresh` returns that `finished_at`. |
| People | `people` | `cd api && python refresh_people.py` | Weekly, from the module docstring. No day or hour is named. | Log ends with `People refresh success <UTC time>`. The row has `job` `people` and `status` `success`. |
| Reference | `reference` | `cd api && python refresh_reference.py` | Monthly, from the module docstring. No day or hour is named. | Log ends with `Reference refresh success <UTC time>`. The row has `job` `reference` and `status` `success`. |

A run that failed ends with `League refresh failure`, `People refresh failure`, or `Reference refresh failure`, and that row's `status` is `failure`. The previous success row for the same job is left in place.

The three commands write different tables for scores: only the schedule command changes `game` scores and rebuilds `conference_standing`. People and reference do not. The code does not take a lock between them, and it does not say they must not overlap.

## Local use

Copy `.env.example` to `.env` at the repository root and start Postgres with the `docker-compose.yml` service. The sample values in `.env.example` are for that local database. Do not reuse them anywhere else.

From `web/`, `package.json` defines `npm run dev`, `npm run build`, `npm run start`, and `npm run lint`. The API dependencies are `api/requirements.txt`, including FastAPI and uvicorn. This repository does not include a start script for the API process. The app object is `app` in `api/app/main.py`, and the web client defaults to port 8000.
