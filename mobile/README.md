# Soccer Away Day

A schedule companion for ECNL families. It is not affiliated with, endorsed by, or sponsored by ECNL.

The app lives in this folder so the Render web build under `web/` stays unchanged. Favorites (up to 4 teams and 1 club) stay on the device. The app does not send a profile key or other personal data.

## API

Requests go to `EXPO_PUBLIC_API_URL` when that variable is set at build time, otherwise the `extra.apiUrl` value in `app.json`:

`https://ecnl-schedule-pilot-node1.onrender.com`

Home calls `GET /mobile/dashboard` from the API pull request. Schedules, tables, matchup, and club call the existing `/teams`, `/teams/{id}/schedule`, `/standings`, `/standings/predicted`, `/head-to-head`, and `/clubs` routes.

## Checks

```bash
npm run typecheck
npm run web
```

This environment is Linux and cannot run the iOS Simulator. `eas.json` is configured for a later build. Do not run `eas submit` until the Apple Developer account and a support email are ready. There is no Play Store submission.
