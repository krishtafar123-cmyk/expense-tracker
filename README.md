# Expense Tracker — Setup Guide

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

A fresh setup via `schema.sql` already includes both — no migration needed.

## How it works / what's stored

- **Pages**: `index.html` is the login page (email + PIN), `dashboard.html` is the app. Visiting either while already logged in / logged out redirects you to the right one automatically.
- **Login flow**: the first time on a device, you enter your email once, then set (or enter) your PIN. From then on, that device remembers the email (in its browser storage) and only ever asks for the PIN — like a banking app's quick-unlock. A "‹ Back" link forgets the remembered email if you want to switch accounts on that device.
- Under the hood, the PIN is just your Supabase account password — there's no separate PIN system, so an email is still required by Supabase itself; this app just hides that after the first login on each device.
- **Salary Payments**: logged individually with a date (and optional note) rather than one monthly number, since fortnightly pay lands on different days each month. The month's total is just whatever payments actually landed in it.
- **Monthly Setup** (family maintenance, fixed expenses) is saved per calendar month, so changing next month's rent doesn't rewrite history. Use **"Copy from previous month"** to carry values forward instead of retyping them.
- **Daily Expenses** are logged with a date, category, amount, and optional note, and are totalled for whichever month you're viewing. The **Today** card shows just today's spending and naturally shows $0 once a new day starts — nothing is deleted, it's just filtered by date.
- **Savings**: deposits and withdrawals with dates, showing an all-time running balance plus this month's activity. Money moved to savings this month reduces **Remaining** (a withdrawal adds back to it).
- **Insights**: a few rule-based observations computed from your own data (no external AI, nothing leaves Supabase) — over-budget warnings, a spending-pace projection with a suggested daily cap, category spikes vs. the same point last month, your dominant category, and how much of your salary is already committed to fixed costs.
- **Remaining** = Salary − Family Maintenance − Fixed Expenses − Daily Expenses − Savings (this month's net deposits), for the selected month.

## Troubleshooting

- **"Failed to fetch" / nothing loads**: double check `config.js` has your real URL/key, not the placeholders.
- **Can't log in after signup**: check step 4 — either disable email confirmation or click the link in your inbox.
- **Data not showing on another device**: make sure you're logged into the same account (same email) on both.
- **Forgot your PIN**: there's no reset flow built in yet. Go to Supabase → **Authentication → Users**, delete that user, and sign up again.
- **Salary Payments or Savings tab errors out**: you likely haven't run the matching migration yet — see "Updates that need a one-time SQL migration" above.
