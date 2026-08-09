# Roadmap & handover notes

Written 2026-08-07, after the app went live and the first round of improvements shipped. This is the "where things stand and what's worth doing next" file — [README.md](README.md) covers setup and how to use the app.

## Where it stands

Live at https://krishtafar123-cmyk-expense-tracker.vercel.app/, deployed from `main` on every push. Everything on the original improvement list is done:

- **Phone** — installable PWA, numeric keypad on amounts, inline editing, auto-date, low-latency PIN pad
- **Security** — 15-minute idle auto-lock, manual Lock button, PIN reset by email
- **Reliability** — visible load errors with Retry, double-submit guards, CSV export of all data
- **Insights** — 6-month income-vs-spending trend, per-category budgets with auto-suggest, rule-based observations
- **Owed to you** — Work Purchases and Lent to Roommate reminders, cleared/reopened with the cleared date recorded
- **Polish** — WCAG AA contrast in both themes, screen-reader labelling throughout, loading feedback
- **Theme** — light orange glass (translucent blurred cards over a warm gradient), light and dark

## Gotchas to know before changing things

These caused real bugs or are easy to break:

1. **`[hidden]` vs `display`** — an element with a `display:` rule in CSS will ignore the `hidden` attribute (equal specificity, later rule wins). Anything toggled via `hidden` must scope its display to `:not([hidden])`. This shipped a bug where the login screen stayed visible under the dashboard.
2. **Dates must not go through UTC** — use `toDateStr()`, never `toISOString().slice(0,10)`. The latter shifts the day depending on timezone and mis-files expenses.
3. **A hidden `required` field silently blocks form submit** — browsers refuse to submit and can't focus the field to explain why. `#daily-date` is deliberately not `required`.
4. **`reset.js` reads `location.hash` before `createClient`** — supabase-js consumes the recovery token out of the URL immediately, so checking afterwards always looks like a normal visit.
5. **A locked session must never be able to change its own PIN** via `reset.html`, or the idle lock is bypassable. Only a genuine emailed recovery link may override a lock.
6. **`create policy` has no `IF NOT EXISTS`** — every SQL file does `drop policy if exists` first so it can be re-run safely.
7. **New tables need their migration run in Supabase before the feature works.** Code that reads a new table should degrade gracefully if it's missing (see how `category_budgets` is handled) rather than failing the whole page load.
8. **The category list is duplicated** — `CATEGORIES` in `dashboard.js` and the `<option>` list in `dashboard.html` must be kept in sync by hand. Worth consolidating if categories ever become editable.
9. **Escaping** — `escapeHtml()` does not escape quotes. Anything interpolated into an HTML *attribute* needs `escapeAttr()`.
10. **List rows are a grid, not `space-between` flex.** With three flex children the free space gets distributed *around* the amount, so amounts drift horizontally with the length of the name and never form a column. Keep the fixed money column.
11. **Reimbursements must never enter a spending total.** Work purchases and roommate loans are money owed *back* to you; they are excluded from Remaining, the trend chart, budgets and every spending insight by living in their own table. Don't "helpfully" fold them in.

## Ideas not built yet

Roughly in order of value for how this app is actually used:

**Recurring / automation**
- Auto-roll fixed expenses and family maintenance into each new month, instead of the manual "Copy from previous month" prompt.
- Optional reminder to log the fortnightly salary on payday.

**Offline entry** — the service worker caches the app shell, so the app *opens* offline, but adding an expense still needs the network. Queueing writes locally and syncing on reconnect is the main missing piece for logging things out and about.

**Reporting**
- Year-to-date and per-year views; the trend chart is fixed at 6 months.
- Filter/search the expense list (by category, date range, note text).
- Export the currently-viewed month only, alongside the existing export-everything.

**Data model**
- Multi-currency (currency is AUD, hardcoded in the `Intl.NumberFormat` in `dashboard.js`).
- User-editable categories (see gotcha 8).
- Splitting expenses with another person; sharing a household budget across two logins.

**Smaller wins**
- Stop month navigation running arbitrarily far into the future.
- `savings_transactions` loads all-time on every month change to compute the running balance — fine at personal scale, but a running total column or a view would scale better.
- Biometric unlock (WebAuthn) instead of typing the PIN on a phone that supports it.

## Deliberate non-goals

- **No analytics or third-party scripts.** The only external request is the supabase-js CDN.
- **No server of our own.** It's static files plus Supabase; keeping it that way is what makes hosting free and deploys instant.
