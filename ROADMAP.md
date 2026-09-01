# Roadmap & handover notes

Written 2026-08-07, after the app went live and the first round of improvements shipped. This is the "where things stand and what's worth doing next" file — [README.md](README.md) covers setup and how to use the app.

## Where it stands

Live at https://krishtafar123-cmyk-expense-tracker.vercel.app/, deployed from `main` on every push. Everything on the original improvement list is done:

- **Phone** — installable PWA, numeric keypad on amounts, inline editing, auto-date, low-latency PIN pad
- **Security** — 15-minute idle auto-lock, manual Lock button, PIN reset by email
- **Reliability** — visible load errors with Retry, double-submit guards, CSV export of all data
- **Insights** — 6-month income-vs-spending trend, per-category budgets with auto-suggest, rule-based observations
- **Owed to you** — Work Purchases and Lent to Roommate reminders, cleared/reopened with the cleared date recorded
- **Saving** — pay-cycle view derived from logged salary payments, pay-yourself-first target, safe-to-spend-today, three-payday month flagging
- **Polish** — WCAG AA contrast in both themes, screen-reader labelling throughout, loading feedback
- **Theme** — light orange glass (translucent blurred cards over a warm gradient), light and dark

## Picking up from here (last session)

All four features the user chose are now built:

1. **Debt payoff** — done. `migration_debt.sql` run. Set a "total owed" via ✎ on a fixed expense; what's left is derived from paid ticks, not stored.
2. **Auto-roll monthly setup** — done, no migration. Current month carries forward on load; a payday nudge fires if the fortnight has started with no pay logged.
3. **Quick-add chips** — done and now verified. The suggestion logic was exercised against stubbed data (threshold, 60-day boundary, grouping, sort/cap, undo): all passing. Verification turned up one real bug, now fixed — chips rendered while viewing a *future* month, where a tap logs to today and so looked like a no-op. `renderQuickAdd` now bails unless you're viewing the month containing today.
4. **Receipt photos** — done, and `migration_receipts.sql` has been run. If a photo ever fails to attach, the expense itself still saves and the message names the migration.

Added since, on request:

5. **Money I Owe** (`personal_debts`) — the user owed a colleague and a manager, and the app only tracked money owed *to* them. **`migration_personal_debts.sql` needs running.** They chose "counts only when repaid" over deducting it up front, and one card with a free-text name over fixed per-person cards. See gotcha 12 for the rule that matters.

### What receipts look like in the code

- `migration_receipts.sql` adds `receipt_path` to `daily_expenses` and `reimbursements`, and creates the private `receipts` bucket **and its policies in SQL** — deliberately, so the user doesn't have to click through the Storage dashboard.
- Objects are stored at `<user_id>/<uuid>.<ext>`. The uid folder is not cosmetic: the Storage policy is `(storage.foldername(name))[1] = auth.uid()::text`. Changing the path shape breaks access.
- The bucket is private; viewing mints a 60-second signed URL and shows it in an in-app overlay (`#receipt-viewer`) rather than a new tab, because a new tab drops an installed PWA out into the browser.
- Photos are downscaled to 1600px client-side before upload; anything that won't decode falls back to the original file rather than failing.
- **The row is always saved first, then the photo attached.** A Storage or missing-migration failure costs the photo, never the expense — see `attachReceipt`, which also deletes the uploaded object if the row update then fails, so nothing is orphaned.
- Clearing a work purchase deletes its receipt (what the user asked for). `toggleOwedSettled` nulls the column **before** removing the object, so a failure can't leave a row pointing at a missing file. It's irreversible, so the toast says "Cleared — receipt deleted" rather than letting it vanish quietly.
- Only work purchases get a picker; a roommate loan is a note to yourself, not something you have to prove.

**Do not test against the user's live Supabase data.** A test-account sign-in failed silently once and an existing session for their real account was used instead, writing two rows into real data (removed). Verify logic in isolation — extract the function from the deployed `dashboard.js` and run it with stubbed dependencies, as the debt, carry-forward and cent-splitting tests do. If a live check is genuinely needed, ask first.

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
12. **`personal_debts` is the exact opposite of `reimbursements`, and the one "owed" table that IS spending.** Money you owe costs nothing while outstanding; it lands in Remaining only as you pay it, and **each payment counts in the month it was made** — `debt_payments.date` decides the month, never the date the debt was incurred. What's left on a debt is always `amount − sum(payments)`, derived and never stored, so no balance can drift away from the payments meant to explain it. Remaining and the trend chart both subtract payments and must stay in step; a new spending view needs them too. Keep the two tables apart: summing them would net off two things that have nothing to do with each other.
13. **Anything "right now" must check it's being viewed in the current month.** Quick-add chips and the pay-cycle card both act on *today*, so in another month they'd either mislead or silently do nothing. Both use the same `viewingCurrentMonth` check. A past month often hides such things by accident (no recent data); a future month does not.
14. **Cards live inside a tab panel now, and panels are toggled with `hidden`.** A new card must go inside one of the five `.tab-panel` divs in `dashboard.html` or it renders nowhere. Don't switch panels with a CSS `display` rule keyed off a body attribute: several cards (`#debt-card`, `#cycle-card`, `#insights-card`) carry their own `hidden`, and a `display` rule would override it — gotcha 1. Rendering into a hidden panel is safe because nothing measures the DOM; keep it that way, or charts sized from `offsetWidth` will come out zero-width on a background tab.
15. **A file in Storage and a path in a row can disagree.** Always update the row first and delete the object second, so a failure leaves a harmless orphan rather than a row pointing at a file that's gone. Deletes are best-effort and must never block the thing the user actually asked for.

## Ideas not built yet

Roughly in order of value for how this app is actually used:

**Offline entry** — the service worker caches the app shell, so the app *opens* offline, but adding an expense still needs the network. Queueing writes locally and syncing on reconnect is the main missing piece for logging things out and about. Worth noting this is also the most likely *cause* of the logging gaps the nudge now reports.

**Per-category history** — the trend chart shows total spending per month, so a category creeping up is invisible. Analysing the user's real August export made the case: Food was 100% coffee and takeaway, and coffee alone ran at ~$6.50/day, which no single month would ever flag as wrong.

**A payoff date for personal debts** — part payments landed 2026-08-24, so a debt now has a running balance and progress. What's still missing is the forward view: set an intended monthly amount and see when it clears, the way `debt_total` does for fixed expenses.

**Receipts, second pass**
- A receipt can only be attached while *creating* a row. Forget one, or have an upload fail, and the only way back is to delete the expense and re-add it. Attaching from an existing row via ✎ is the obvious gap.
- Nothing ever lists what's actually in the bucket, so an orphan from a half-failed delete is invisible.

**Reporting**
- Year-to-date and per-year views; the trend chart is fixed at 6 months.
- Filter/search the expense list (by category, date range, note text).
- Export the currently-viewed month only, alongside the existing export-everything.
- The export mixes income, spending and money owed in one Amount column, discriminated only by the Type column. Fine for a backup, easy to misread if summed naively.

**Data model**
- Multi-currency (currency is AUD, hardcoded in the `Intl.NumberFormat` in `dashboard.js`).
- User-editable categories (see gotcha 8).
- Splitting expenses with another person; sharing a household budget across two logins.

**Smaller wins**
- Stop month navigation running arbitrarily far into the future.
- `savings_transactions` loads all-time on every month change to compute the running balance — fine at personal scale, but a running total column or a view would scale better.
- Biometric unlock (WebAuthn) instead of typing the PIN on a phone that supports it.

## The visual language

Changed 2026-08-24, from slate & navy to "ink & indigo", after the user said it looked dated. Four rules hold it together — breaking any of them is what made the old theme read as a 2016 dashboard:

1. **A surface gets a hairline border OR a shadow, never both.** Cards, summary tiles and the tab bar use a border and no shadow. Only genuinely floating things — the toast, the update banner — keep a shadow, and they have no border.
2. **Micro-labels are sentence case.** No `text-transform: uppercase` with letter-spacing anywhere; it was on every tile and is the single most dating detail after the navy.
3. **Numbers dominate.** `--radius` is 14px (cards 16px), amounts carry `font-variant-numeric: tabular-nums` so money forms a column and doesn't jitter as digits change, and large figures get negative letter-spacing.
4. **Every colour pair holds WCAG AA in both modes**, and the two chart series differ in *lightness*, not just hue — check any new colour before adding it. The dark spending bar had to move from `#e3a008` to `#fbbf24` for exactly this reason.

Typography is Inter from Google Fonts, with the old system stack as the fallback, so a blocked or offline request degrades to how the app looked before rather than to a serif. This is the **one** exception to the no-third-party-requests rule below, made deliberately.

### The scales — don't invent values outside them

Tightened 2026-08-24. Before this there were 15 font sizes (including 17, 18 *and* 19), 7 corner radii, and paddings like `7px 9px` and `9px 10px` — numbers picked one at a time rather than chosen. Nobody can see the difference between 17px and 18px; what they can see is that nothing quite lines up.

- **Type:** 12 / 13 / 14 / 16 / 20 / 24 / 28 / 32. Plus 40px for the decorative greeting emoji only. No adjacent pair is closer than 8%, so every step is a real decision.
- **Radius:** 4px thin bars, 12px controls (`--radius`), 16px cards, 999px pills, 50% circles. Nothing else.
- **Spacing:** multiples of 4 only.
- **Touch targets:** buttons carry `min-height: 44px`; form inputs land at ~43px from 12px padding. The topbar's own buttons are the deliberate exception at 36px — see the note by that rule.

Adding a one-off value is how the previous mess accumulated. If something genuinely needs a size that isn't here, change the scale rather than making an exception to it.

**Gotcha that bit here:** `.negative` sets red text, but on `.summary-card-highlight` (the Remaining tile) that was red on the highlight colour — 1.05:1, invisible, at exactly the moment the number matters most. The tile now flips whole via `.is-negative`. Any future "highlight" surface needs the same treatment; don't just set a text colour on it.

## Keeping it generic

The app was built for one person, and their life had leaked into it: two fixed
categories called "work" and "roommate", and a field labelled "Family
Maintenance". Anyone else running a copy would have been stuck with someone
else's living arrangements. Fixed 2026-08-24 — keep it that way:

- **Who owes you is free text**, not an enum. `reimbursements.person` replaced
  `owed_by check (owed_by in ('work','roommate'))`, which also collapsed two
  near-identical cards into one. `personal_debts` was already built this way.
  Insights name the person and cap at the two largest, rolling the rest into
  one line, so a long list of small IOUs can't crowd out everything else.
- **The monthly commitment's label is a setting**, `user_settings.family_label`.
  The *column* is still `family_maintenance` — renaming it would mean migrating
  every row for a cosmetic win — but nothing on screen says so unless the user
  typed it. Anything new that shows that label must read the setting, not
  hardcode a string; there are four such places already.
- **Still hardcoded, and would need doing before a wider release:** currency is
  AUD in the `Intl.NumberFormat` in `dashboard.js`, and the pay cycle assumes
  a fortnight.

Publishing model, decided with the user: **share the code, not a service.**
Everyone deploys their own Supabase project and their own copy, so no one
else's data ever lands in anyone's database. That's also what keeps the
6-digit PIN reasonable — it guards a single-user instance, not a shared one.
If that ever changes to a hosted service, the PIN has to stop being the
account password first.

## Deliberate non-goals

- **No analytics.** No third-party scripts. External requests are limited to the supabase-js CDN and the Inter webfont — nothing else.
- **No server of our own.** It's static files plus Supabase; keeping it that way is what makes hosting free and deploys instant.
