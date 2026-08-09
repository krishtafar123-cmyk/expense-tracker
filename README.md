# Expense Tracker — Setup Guide

> Planning changes or picking this up after a break? See [ROADMAP.md](ROADMAP.md) for where things stand, ideas not built yet, and the gotchas that caused real bugs.

A small web app to track your salary, fixed expenses, family maintenance, and daily spending, synced across every device via Supabase (free hosted Postgres + auth) and deployed on Vercel (free static hosting).

No coding needed for setup — just account creation and copy/pasting keys, which you should do yourself in your own browser.

## 1. Create a Supabase project

1. Go to https://supabase.com and sign up / log in.
2. Click **New project**. Pick any name and a database password (save it somewhere safe), choose a region close to you.
3. Wait ~1-2 minutes for it to provision.

## 2. Create the database tables

1. In your new project, open **SQL Editor** (left sidebar) → **New query**.
2. Open [schema.sql](schema.sql) from this folder, copy its entire contents, paste into the editor, and click **Run**.
3. You should see "Success. No rows returned" — this created 3 tables (`monthly_data`, `fixed_expenses`, `daily_expenses`) with security rules so each user can only ever see their own data.

## 3. Get your API keys

1. In Supabase, go to **Project Settings** → **API**.
2. Copy the **Project URL** and the **anon public** key (not the `service_role` key — never use that one in a browser app).
3. Open [config.js](config.js) in this folder and paste them in:

```js
window.SUPABASE_URL = "https://xxxxxxxx.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIs...";
```

The anon key is designed to be public/client-side — it can't do anything outside what the Row Level Security policies in `schema.sql` allow (i.e. a logged-in user can only touch their own rows).

## 4. (Recommended) Turn off email confirmation for a smoother signup

By default Supabase makes new users click a confirmation link before they can log in. For a personal app this is an extra step you probably don't want:

1. **Authentication** → **Providers** → **Email** → turn off **Confirm email**.
2. Save.

If you skip this, just check your inbox after signing up and click the confirmation link before logging in.

## 5. Test it locally

Open `index.html` in a browser (double-click it, or right-click → Open with → your browser) — this is the login page. Create an account (email + a 6-digit PIN), then try adding a salary, a fixed expense, and a daily expense on the dashboard.

## 6. Deploy to Vercel (so it has a real URL you can open from your phone)

1. Go to https://vercel.com and sign up / log in (you can use your GitHub account or email).
2. Easiest path — no GitHub needed:
   - Install Node.js if you don't have it (https://nodejs.org), then in a terminal, inside this `expense-tracker` folder, run:
     ```bash
     npx vercel
     ```
   - Follow the prompts (log in, confirm the project settings — it's a static site, no build step needed). It'll give you a live URL like `https://expense-tracker-yourname.vercel.app`.
   - Run `npx vercel --prod` to publish it to your permanent production URL.
3. Alternative — via GitHub: push this folder to a new GitHub repo, then in Vercel click **Add New → Project**, import that repo, and deploy (no build settings needed, it's plain HTML/CSS/JS).

Open the resulting URL on your phone and log in with the same email + PIN — your data will be there because it's stored in Supabase, not the browser.

## Updates that need a one-time SQL migration

If you set this up before these features existed, run these once each in Supabase's SQL Editor (safe to run alongside your existing data):

- [migration_salary_payments.sql](migration_salary_payments.sql) — adds dated Salary Payments (for fortnightly/irregular pay), replacing the old single monthly salary figure.
- [migration_savings.sql](migration_savings.sql) — adds the Savings tab (deposits/withdrawals with a running balance).
- [migration_category_budgets.sql](migration_category_budgets.sql) — adds per-category monthly budgets.
- [migration_reimbursements.sql](migration_reimbursements.sql) — adds the Work Purchases and Lent to Roommate reminders.

A fresh setup via `schema.sql` already includes both — no migration needed.

## Allow the "Forgot PIN?" emails to work

Supabase only sends people back to URLs you've allow-listed, so the reset link needs one setting:

1. Supabase → **Authentication** → **URL Configuration**.
2. Set **Site URL** to your live URL (e.g. `https://krishtafar123-cmyk-expense-tracker.vercel.app`).
3. Under **Redirect URLs**, add the same URL with `/**` on the end:
   `https://krishtafar123-cmyk-expense-tracker.vercel.app/**`
4. Save.

Without this, tapping the link in the reset email will bounce you to the wrong place and the new PIN can't be set. Note that Supabase's built-in email sender is rate-limited on the free tier (a handful per hour), which is fine for personal use.

## Locking

The dashboard locks itself after **15 minutes** of inactivity, and also if you reopen it having been away longer than that. Locking does *not* log you out — your session stays alive, so getting back in is just your PIN, not a full login. There's also a **Lock** button in the top bar to lock immediately.

To change the timeout, edit `LOCK_AFTER_MS` in [shared.js](shared.js).

## Install it on your phone

The app is a PWA, so it can live on your home screen and open fullscreen with no browser chrome:

- **Android / Chrome**: open the site, tap the ⋮ menu → **Add to Home screen** (or accept the install prompt).
- **iPhone / Safari**: open the site, tap the Share button → **Add to Home Screen**.

A service worker caches the app shell, so the app opens instantly and still loads when offline. Note that your *data* still needs a connection — Supabase is the source of truth, so adding an expense offline will fail.

## How it works / what's stored

- **Pages**: `index.html` is the login page (email + PIN), `dashboard.html` is the app. Visiting either while already logged in / logged out redirects you to the right one automatically.
- **Login flow**: the first time on a device, you enter your email once, then set (or enter) your PIN. From then on, that device remembers the email (in its browser storage) and only ever asks for the PIN — like a banking app's quick-unlock. A "‹ Back" link forgets the remembered email if you want to switch accounts on that device.
- Under the hood, the PIN is just your Supabase account password — there's no separate PIN system, so an email is still required by Supabase itself; this app just hides that after the first login on each device.
- **Salary Payments**: logged individually with a date (and optional note) rather than one monthly number, since fortnightly pay lands on different days each month. The month's total is just whatever payments actually landed in it.
- **Monthly Setup** (family maintenance, fixed expenses) is saved per calendar month, so changing next month's rent doesn't rewrite history. Use **"Copy from previous month"** to carry values forward instead of retyping them.
- **Daily Expenses** default to today's date, so logging is just category + amount. Use **Change** on the date line to back-date something you forgot. The **Today** card shows just today's spending and naturally shows $0 once a new day starts — nothing is deleted, it's just filtered by date.
- **Editing**: every row in every list has a ✎ button that swaps it into an inline form. Saving reloads the month, so totals stay correct even if you move an entry to a different date.
- **Work Purchases** and **Lent to Roommate**: money you laid out that someone owes back to you. **Neither counts as your spending** — they're stored in a separate table so they can never reach Remaining, the trend chart, budgets or any insight. They're also not tied to a month: something bought in June still shows as outstanding in August, because you still haven't been paid back. Press **✓** to mark an item cleared once you get the money (it records the date and greys the row out); **↺** reopens it if you marked it too early. Outstanding totals also appear in Insights so they don't get forgotten.
- **Savings**: dated deposits and withdrawals, showing an all-time running balance plus this month's activity.
  - **Deposit** = money moved *into* savings. Balance goes up, **Remaining** goes down (it's no longer available to spend).
  - **Withdrawal** = money taken *back out* of savings to spend. Balance goes down, **Remaining** goes up.
  - The big number on the card is the all-time balance (every deposit minus every withdrawal, carried across months). The list below it shows only the current month's activity.
  - If you withdraw more than you deposit in a month, that month's net savings is negative and correctly *increases* Remaining.
- **Last 6 months**: a bar chart comparing income against total spending (daily + fixed + family maintenance) per month.
- **Category Budgets**: an optional monthly cap per category, with a bar showing what you've spent against it this month. Budgets are not per-month — one cap applies every month until you change it.
  - **Suggest from my history** fills them in from your own spending: for each category it takes the *lowest* month you actually achieved in the last 6 (ignoring months where you spent nothing in that category), so the target is one you've already proven is doable rather than an invented number. If those add up to more than what's left after salary − family − fixed, they're all scaled down proportionally to fit.
  - This is arithmetic on your own numbers, not financial advice — treat the suggestions as a starting point and edit any of them.
- **Insights**: a few rule-based observations computed from your own data (no external AI, nothing leaves Supabase) — over-budget warnings, a spending-pace projection with a suggested daily cap, category spikes vs. the same point last month, your dominant category, and how much of your salary is already committed to fixed costs.
- **Remaining** = Salary − Family Maintenance − Fixed Expenses − Daily Expenses − Savings (this month's net deposits), for the selected month.

## Troubleshooting

- **"Failed to fetch" / nothing loads**: double check `config.js` has your real URL/key, not the placeholders.
- **Can't log in after signup**: check step 4 — either disable email confirmation or click the link in your inbox.
- **Data not showing on another device**: make sure you're logged into the same account (same email) on both.
- **Forgot your PIN**: tap **Forgot PIN?** on the PIN screen to get a reset link by email. If the link doesn't work, check the URL Configuration step above.
- **Salary Payments or Savings tab errors out**: you likely haven't run the matching migration yet — see "Updates that need a one-time SQL migration" above.
