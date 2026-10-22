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
- No automatic backups on the free plan.
- All times are Bangkok time. A booking after midnight but before closing counts for the previous night.

## Tests

```
node --test tests/time.test.mjs          # booking/time logic
node tests/ui.test.mjs <screenshot-dir>  # UI flows in headless Chrome (needs tools/: npm install)
```
`supabase/test/` runs the database rules against a local Postgres with a stand-in auth schema.
