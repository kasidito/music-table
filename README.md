# Music Table

Staff-only table booking app for the bar. Web app (phone/tablet browser) + Supabase (free plan).

## Folders

- `app/` — the website (plain HTML/JS, no build step). Deployed to GitHub Pages.
- `supabase/migration.sql` — database: tables, rules, permissions, change history.
- `supabase/functions/create-staff/` — lets managers create staff logins.
- `tests/` — logic, database and UI tests.

## First-time setup (once)

1. **Create the first manager**: Supabase dashboard → Authentication → Users → Add user → Create new user.
   Tick "Auto Confirm User". The first account becomes the manager automatically.
2. **Turn off public sign-up**: Authentication → Sign In / Providers → turn off "Allow new users to sign up".
   (Sign-ups would get no access anyway, this just keeps the user list clean.)
3. **Publish the site**: GitHub repo → Settings → Pages → Source: "GitHub Actions". Every push to `main` deploys `app/`.
4. Log in, open "แก้ผัง", build floor 1 and 2, then add staff in "พนักงาน".

## Good to know

- Supabase free plan pauses a project after 1 week with no use. If the bar is closed that long, open the dashboard and restore it.
- No automatic backups on the free plan (see Backup below).
- All times are Bangkok time. A booking after midnight but before closing counts for the previous night.

## Debugging and logs

**In the app (managers):** Settings → Diagnostics shows the version, connection and realtime status, the last 40 log
lines on this device, and the server log. "Copy diagnostics" puts a JSON report on the clipboard to paste into a chat or issue.

**Debug mode:** add `?debug=1` to the URL once (or toggle it in Diagnostics). Debug and info lines then print to the
browser console as `[level] event {context}`. It stays on for that device until turned off.

**What is logged (`app/log.js`):**

| Level | When | Where it goes |
|---|---|---|
| debug / info | normal actions: app start, sign-in, booking created/updated/moved, payment recorded, CSV export | device buffer; console in debug mode |
| warn | expected problems: wrong password, rule violations (e.g. table taken), offline, realtime drop | device buffer, console, **server** |
| error | unexpected failures: database errors, uncaught exceptions, failed slip uploads | device buffer, console, **server** |

- Every database call goes through `run(promise, 'what.was.attempted')`, so a failed query is logged with the action name,
  Postgres error code, message, details and hint.
- `window.error` and `unhandledrejection` are captured globally.
- Personal data (phone, names, notes, emails, passwords, tokens, signed URLs) is redacted before anything is logged.
- Server logs live in the `app_logs` table (managers can read, staff can only add their own rows; 30-day retention, max 30 lines/min per device).

**Querying server logs (Supabase SQL editor):**
```sql
select at, level, event, message, context, app_version from app_logs
where level = 'error' order by at desc limit 50;
```

**Version:** the deploy workflow writes the commit id and date into `app/version.js`; logs carry it, so an error can be matched to the exact code.

**Audit trail:** every booking change (who, when, before/after) is in `booking_history` and shown in each booking's history.

## Backup

- Daily backup to Google Sheets ("Music Table Backup") runs as a scheduled task.
- Manual: Settings → Backup downloads CSV (bookings, payments, guests). In Google Sheets: File → Import → Upload.

## Tests

```
node --test tests/time.test.mjs tests/modules.test.mjs   # logic: time, money, messages, reports, CSV, log redaction
node tests/ui.test.mjs <screenshot-dir>                  # phone UI flows (needs tools/: npm install)
node tests/ipad.test.mjs <screenshot-dir>                # iPad landscape + portrait
node tests/features.test.mjs <screenshot-dir>            # notifications, combine/move tables, reports, CSV, logging
```
`supabase/test/` runs the database rules against a local Postgres with a stand-in auth schema.
