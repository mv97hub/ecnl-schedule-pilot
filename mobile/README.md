# Premier Gameday HQ

A schedule companion for ECNL families. It is not affiliated with, endorsed by, or sponsored by ECNL.

The app lives in this folder so the Render web build under `web/` stays unchanged. Favorites (up to 4 teams and 1 club) stay on the device. Sign-in is optional. The device profile key is still never sent. Schedule and standings calls stay unsigned.

## API

Requests go to `EXPO_PUBLIC_API_URL` when that variable is set at build time. Otherwise they use `extra.apiUrl` in `app.json`, then the fallback in `src/lib/api.ts`:

`https://www.premiergamedayhq.com/backend`

`/backend` is a proxy on the website. It forwards to the FastAPI service (`NEXT_PUBLIC_API_URL`).

Home calls `GET /mobile/dashboard`. Schedules, tables, matchup, and club call the existing `/teams`, `/teams/{id}/schedule`, `/standings`, `/standings/predicted`, `/head-to-head`, and `/clubs` routes. Places calls `/locations/club` and `/locations/detail`. Signed-in rating, comment, vote, favorites, address, and calendar calls send `Authorization: Bearer`.

## Checks

```bash
npm run typecheck
npm run web
```

This environment is Linux and cannot run the iOS Simulator. `eas.json` is configured for a later build. Do not run `eas submit` until the Apple Developer account is ready. Support email: premiergamedayhq@gmail.com. There is no Play Store submission.
