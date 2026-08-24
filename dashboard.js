// ---------- Setup ----------
const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const CATEGORIES = ["Food", "Groceries", "Transport", "Shopping", "Bills", "Health", "Entertainment", "Other"];

const currencyFmt = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
function fmt(n) { return currencyFmt.format(n || 0); }

// `action` adds a button to the toast (used for Undo) and holds it on screen
// longer, since it now needs reading and acting on rather than just noticing.
function toast(msg, action) {
  const el = document.getElementById("toast");
  el.textContent = "";
  el.appendChild(document.createTextNode(msg));
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      el.hidden = true;
      clearTimeout(toast._t);
      action.onClick();
    });
    el.appendChild(btn);
  }
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, action ? 7000 : 2500);
}

// Wires up a form submit with the button disabled for the duration, so a
// double-tap on a slow connection can't insert the same row twice.
function onSubmitLocked(formId, handler) {
  const form = document.getElementById(formId);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      await handler();
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- State ----------
let currentUser = null;
let currentMonth = firstOfMonth(new Date());
let monthlyRow = null; // { id, family_maintenance } or null
let fixedExpenses = [];
let dailyExpenses = [];
let salaryPayments = [];
let prevMonthDailyExpenses = [];
let savingsTransactions = []; // all-time, for the running balance
let categoryBudgets = [];
let budgetsUnavailable = false;
// Debt rows across every month, not just the visible one — a payoff spans the
// whole life of the debt.
let allDebtRows = [];
let debtsUnavailable = false;
// Money owed back to you. All-time and not month-scoped: a purchase from two
// months ago still needs claiming today, so it has to stay visible.
let reimbursements = [];
let reimbursementsUnavailable = false;
// Money YOU owe other people — the mirror of `reimbursements`, and separate
// from it so the two directions can never be summed together. Also all-time:
// an IOU from two months ago is still owed today. Unlike a reimbursement,
// paying one of these back IS spending, in the month you actually paid it.
let personalDebts = [];
let personalDebtsUnavailable = false;
// "Pay yourself first" target, held aside before anything is called spendable.
let savePerCycle = 0;
let settingsUnavailable = false;

// How many months the trend chart covers, including the current one.
const TREND_MONTHS = 6;

// Wide slices covering the whole trend window; the current and previous month
// are derived from these rather than queried separately.
let allDailyExpenses = [];
let allSalaryPayments = [];
let allFixedRows = [];
let allMonthlyRows = [];

function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function monthKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}
function monthLabel(d) {
  return d.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}
function monthEndExclusive(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------- Auth guard ----------
document.getElementById("logout-btn").addEventListener("click", async () => {
  localStorage.removeItem(LOCK_KEY);
  await sb.auth.signOut();
  window.location.href = "index.html";
});

// ---------- Idle auto-lock ----------
// Locking keeps the Supabase session alive but sends the user back to the PIN
// screen, so getting back in is one PIN entry rather than a full login.
function markActivity() {
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

function lockNow() {
  localStorage.setItem(LOCK_KEY, "1");
  window.location.href = "index.html";
}

function checkIdle() {
  const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0);
  if (last && Date.now() - last > LOCK_AFTER_MS) lockNow();
}

for (const evt of ["pointerdown", "keydown", "scroll"]) {
  document.addEventListener(evt, markActivity, { passive: true });
}

document.addEventListener("visibilitychange", () => {
  // Stamp on the way out so time spent in another app counts as idle.
  if (document.visibilityState === "visible") checkIdle();
  else markActivity();
});

setInterval(checkIdle, 30000);

document.getElementById("lock-btn").addEventListener("click", lockNow);

sb.auth.onAuthStateChange((_event, session) => {
  if (!session || !session.user) {
    window.location.href = "index.html";
  }
});

function startApp() {
  document.getElementById("user-email").textContent = currentUser.email;
  resetDailyDateToToday();
  document.getElementById("salary-date").value = toDateStr(new Date());
  document.getElementById("savings-date").value = toDateStr(new Date());
  document.getElementById("work-date").value = toDateStr(new Date());
  document.getElementById("roommate-date").value = toDateStr(new Date());
  document.getElementById("iou-date").value = toDateStr(new Date());
  loadMonth();
}

// ---------- Month navigation ----------
document.getElementById("month-prev").addEventListener("click", () => {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
  loadMonth();
});
document.getElementById("month-next").addEventListener("click", () => {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
  loadMonth();
});

// ---------- Loading / error state ----------
let hasLoadedOnce = false;

function setLoading(on) {
  document.getElementById("loading-bar").hidden = !on;
  document.querySelector(".content").setAttribute("aria-busy", on ? "true" : "false");
}

function showLoadError(message, detail) {
  document.getElementById("load-error-text").textContent = message;
  // The cause used to go only to console.error, which is unreadable on a
  // phone — the one place this error actually turns up.
  const detailEl = document.getElementById("load-error-detail");
  detailEl.textContent = detail || "";
  detailEl.hidden = !detail;
  document.getElementById("load-error").hidden = false;
}

function hideLoadError() {
  document.getElementById("load-error").hidden = true;
}

// Blanks the totals so a failed first load never looks like a real $0 balance.
function blankSummary() {
  const ids = ["sum-salary", "sum-fixed", "sum-family", "sum-daily", "sum-savings", "sum-remaining", "sum-today"];
  for (const id of ids) document.getElementById(id).textContent = "—";
}

document.getElementById("load-retry").addEventListener("click", loadMonth);

// ---------- Data loading ----------

// A single dropped request shouldn't cost you the whole month. Eight queries
// go out at once, so on a phone with patchy signal the odds of one of them
// failing are a good deal higher than the odds of the connection being
// genuinely down — retrying briefly turns most of those back into a normal
// load instead of an error banner.
const RETRY_DELAYS_MS = [400, 1200];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Worth another attempt: the request never landed, the server wobbled, or we
// were rate limited. A 4xx (missing table, bad request, RLS refusal) fails
// identically every time, so retrying it only delays showing the real problem.
function isTransient(result) {
  if (result.status === 0) return true; // fetch() rejected: offline, DNS, dropped mid-flight
  return result.status === 408 || result.status === 429 || result.status >= 500;
}

// The queries run in parallel, so one expired token would otherwise set off
// eight simultaneous refreshes. The first to notice does the work and the rest
// wait on the same promise.
let refreshInFlight = null;
function refreshSessionOnce() {
  if (!refreshInFlight) {
    refreshInFlight = sb.auth.refreshSession().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

// `build` returns a fresh query rather than a promise, because a supabase query
// builder can only be awaited once — a retry needs a newly built one.
async function runQuery(label, build) {
  let attempt = 0;
  let refreshed = false;

  while (true) {
    let result;
    try {
      result = await build();
    } catch (err) {
      // fetch() itself rejected, so there's no response to read a status off.
      // Normalised into the shape a Postgrest error already comes back in.
      result = { data: null, error: err, status: 0 };
    }

    if (!result.error) return { label, ...result };

    // An expired access token comes back as a flat 401 and would fail the same
    // way on every retry — but succeeds after one refresh. Doesn't spend a
    // retry, since it isn't a flaky-connection failure.
    if (result.status === 401 && !refreshed) {
      refreshed = true;
      try { await refreshSessionOnce(); } catch (err) { console.error(err); }
      continue;
    }

    if (!isTransient(result) || attempt >= RETRY_DELAYS_MS.length) return { label, ...result };

    console.warn(describeFailure({ label, ...result }) + " — retrying");
    await sleep(RETRY_DELAYS_MS[attempt]);
    attempt++;
  }
}

// What actually went wrong, short enough to sit in the error banner. The table
// name matters most: a bare "Failed to fetch" narrows nothing down.
function describeFailure(result) {
  if (!result || !result.error) return "";
  if (result.status === 0) return `${result.label}: no connection`;
  const err = result.error;
  const msg = err.message || String(err);
  let code = "";
  if (err.code) code = ` (${err.code})`;
  else if (result.status) code = ` (HTTP ${result.status})`;
  return `${result.label}: ${msg}${code}`;
}

async function loadMonth() {
  document.getElementById("month-label").textContent = monthLabel(currentMonth);
  const key = monthKey(currentMonth);

  const prevMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);

  setLoading(true);
  hideLoadError();

  const trendStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - (TREND_MONTHS - 1), 1);
  const rangeStart = toDateStr(trendStart);
  const rangeEnd = toDateStr(monthEndExclusive(currentMonth));

  try {
    // One wide query per table covering the whole trend window. The current
    // and previous month are sliced out of these client-side, which keeps the
    // round trips down instead of querying each month separately.
    const results = await Promise.all([
      runQuery("monthly_data", () => sb.from("monthly_data").select("*").eq("user_id", currentUser.id)
        .gte("month", rangeStart).lte("month", key)),
      runQuery("fixed_expenses", () => sb.from("fixed_expenses").select("*").eq("user_id", currentUser.id)
        .gte("month", rangeStart).lte("month", key).order("created_at")),
      runQuery("daily_expenses", () => sb.from("daily_expenses").select("*").eq("user_id", currentUser.id)
        .gte("date", rangeStart).lt("date", rangeEnd).order("date", { ascending: false })),
      runQuery("salary_payments", () => sb.from("salary_payments").select("*").eq("user_id", currentUser.id)
        .gte("date", rangeStart).lt("date", rangeEnd).order("date", { ascending: false })),
      runQuery("savings_transactions", () => sb.from("savings_transactions").select("*").eq("user_id", currentUser.id).order("date", { ascending: false })),
      runQuery("category_budgets", () => sb.from("category_budgets").select("*").eq("user_id", currentUser.id)),
      runQuery("reimbursements", () => sb.from("reimbursements").select("*").eq("user_id", currentUser.id).order("date", { ascending: false })),
      runQuery("personal_debts", () => sb.from("personal_debts").select("*").eq("user_id", currentUser.id).order("date", { ascending: false })),
      runQuery("user_settings", () => sb.from("user_settings").select("*").eq("user_id", currentUser.id).maybeSingle()),
      // Deliberately not limited to the trend window — a payoff spans the
      // whole life of the debt, which can be longer than six months.
      runQuery("debts", () => sb.from("fixed_expenses").select("*").eq("user_id", currentUser.id).not("debt_total", "is", null)),
    ]);

    const [monthlyRes, fixedRes, dailyRes, salaryRes, savingsRes, budgetRes, owedRes, iouRes, settingsRes, debtRes] = results;

    // If anything that feeds a total failed, bail out rather than rendering a
    // partial month — a silently wrong total is worse than a visible error.
    const failed = [monthlyRes, fixedRes, dailyRes, salaryRes, savingsRes].find((r) => r.error);
    // Thrown whole rather than as `.error` alone, so the catch below can name
    // which table it was.
    if (failed) throw failed;

    allMonthlyRows = monthlyRes.data || [];
    allFixedRows = fixedRes.data || [];
    allDailyExpenses = dailyRes.data || [];
    allSalaryPayments = salaryRes.data || [];
    savingsTransactions = savingsRes.data || [];

    // Budgets are only caps, never money in a total, so a missing table (the
    // migration hasn't been run yet) degrades to "no budgets" instead of
    // taking the whole dashboard down with it.
    budgetsUnavailable = !!budgetRes.error;
    if (budgetRes.error) console.error(budgetRes.error);
    categoryBudgets = budgetRes.data || [];

    // Same reasoning for reimbursements — they're reminders, never part of a
    // total, so a missing table degrades to an empty list.
    reimbursementsUnavailable = !!owedRes.error;
    if (owedRes.error) console.error(owedRes.error);
    reimbursements = owedRes.data || [];

    // Money you owe does feed a total (Remaining, once repaid), so a missing
    // table can't just be shrugged off the way reimbursements can — but it
    // degrades to "nothing owed", which is what an unrun migration means
    // anyway, rather than taking the whole dashboard down.
    personalDebtsUnavailable = !!iouRes.error;
    if (iouRes.error) console.error(iouRes.error);
    personalDebts = iouRes.data || [];

    // A missing settings table just means no savings target yet.
    settingsUnavailable = !!settingsRes.error;
    if (settingsRes.error) console.error(settingsRes.error);
    savePerCycle = settingsRes.data ? Number(settingsRes.data.save_per_cycle) : 0;
    document.getElementById("save-per-cycle").value = savePerCycle > 0 ? savePerCycle : "";

    // A missing debt_total column just means no debts are being tracked.
    debtsUnavailable = !!debtRes.error;
    if (debtRes.error) console.error(debtRes.error);
    allDebtRows = debtRes.data || [];

    const curStart = toDateStr(currentMonth);
    const prevStart = toDateStr(prevMonth);

    monthlyRow = allMonthlyRows.find((r) => r.month === key) || null;
    fixedExpenses = allFixedRows.filter((f) => f.month === key);
    dailyExpenses = allDailyExpenses.filter((d) => d.date >= curStart && d.date < rangeEnd);
    salaryPayments = allSalaryPayments.filter((p) => p.date >= curStart && p.date < rangeEnd);
    prevMonthDailyExpenses = allDailyExpenses.filter((d) => d.date >= prevStart && d.date < curStart);
    hasLoadedOnce = true;

    document.getElementById("input-family").value = monthlyRow ? monthlyRow.family_maintenance : "";

    document.getElementById("copy-prompt").hidden = !!monthlyRow;

    // A new month shouldn't need a button press. Deliberately limited to the
    // current month: browsing to a future month must not quietly create rows
    // there, and a past month left empty was presumably left empty on purpose.
    const now = new Date();
    const isCurrentMonth =
      now.getFullYear() === currentMonth.getFullYear() && now.getMonth() === currentMonth.getMonth();
    if (isCurrentMonth && !monthlyRow && fixedExpenses.length === 0) {
      const rolled = await setUpMonthFrom(
        new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
      );
      if (rolled) {
        // Fold the new rows into the wide slices, or the trend chart and debt
        // payoff would ignore the month that was just created.
        allFixedRows = allFixedRows.concat(fixedExpenses);
        if (monthlyRow) allMonthlyRows = allMonthlyRows.concat([monthlyRow]);
        allDebtRows = allDebtRows.concat(fixedExpenses.filter((f) => f.debt_total != null));
      }
    }

    renderSalaryList();
    renderSavingsList();
    renderFixedList();
    renderFamilyPaid();
    renderStillToPay();
    renderDebts();
    renderDailyList();
    renderQuickAdd();
    renderCategoryBreakdown();
    renderBudgets();
    renderOwed();
    renderIouList();
    renderTrend();
    renderPayCycle();
    renderSummary();
  } catch (err) {
    console.error(err && err.error ? err.error : err);
    // A bug in one of the render functions lands here too, and used to be
    // reported as a connection problem — showing the real message stops that
    // sending you off chasing the wrong thing.
    const detail = err && err.label ? describeFailure(err) : (err && err.message) || String(err);
    showLoadError("Couldn't load your data — check your connection and try again.", detail);
    if (!hasLoadedOnce) blankSummary();
  } finally {
    setLoading(false);
  }
}

// ---------- Monthly setup: family maintenance ----------
async function ensureMonthlyRow() {
  if (monthlyRow) return monthlyRow;
  const key = monthKey(currentMonth);
  const { data, error } = await sb.from("monthly_data")
    .insert({ user_id: currentUser.id, month: key, family_maintenance: 0 })
    .select().single();
  if (error) { console.error(error); toast("Failed to save"); return null; }
  monthlyRow = data;
  document.getElementById("copy-prompt").hidden = true;
  return monthlyRow;
}

async function saveField(field, value) {
  const row = await ensureMonthlyRow();
  if (!row) return;
  const num = parseFloat(value) || 0;
  const { data, error } = await sb.from("monthly_data")
    .update({ [field]: num, updated_at: new Date().toISOString() })
    .eq("id", row.id).select().single();
  if (error) { console.error(error); toast("Failed to save"); return; }
  monthlyRow = data;
  renderFamilyPaid();
  renderStillToPay();
  renderSummary();
}

let familyTimer;
document.getElementById("input-family").addEventListener("input", (e) => {
  clearTimeout(familyTimer);
  familyTimer = setTimeout(() => saveField("family_maintenance", e.target.value), 500);
});

// ---------- Fixed expenses ----------
// Divide in whole cents and give the remainder to the earliest parts, so the
// pieces always add back up to the total exactly. Splitting $100 three ways
// naively would give 33.33 x 3 = 99.99 and quietly lose a cent every month.
function splitAmount(total, parts) {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / parts);
  const extra = cents - base * parts;
  return Array.from({ length: parts }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

onSubmitLocked("fixed-form", async () => {
  const nameInput = document.getElementById("fixed-name");
  const amountInput = document.getElementById("fixed-amount");
  const splitInput = document.getElementById("fixed-split");
  const name = nameInput.value.trim();
  const amount = parseFloat(amountInput.value);
  const parts = Math.max(1, parseInt(splitInput.value, 10) || 1);
  if (!name || isNaN(amount)) return;

  await ensureMonthlyRow();
  const key = monthKey(currentMonth);

  // One insert either way — a split is just several ordinary rows, each
  // independently tickable, editable and copied forward like any other.
  const rows = splitAmount(amount, parts).map((amt, i) => ({
    user_id: currentUser.id,
    month: key,
    name: parts > 1 ? `${name} (${i + 1}/${parts})` : name,
    amount: amt,
  }));

  const { data, error } = await sb.from("fixed_expenses").insert(rows).select();
  if (error) { console.error(error); toast("Failed to add"); return; }

  fixedExpenses.push(...(data || []));
  nameInput.value = "";
  amountInput.value = "";
  splitInput.value = "1";
  renderFixedList();
  renderStillToPay();
  renderSummary();
  if (parts > 1) toast(`Added ${parts} rows totalling ${fmt(amount)}`);
});

async function deleteFixedExpense(id) {
  const { error } = await sb.from("fixed_expenses").delete().eq("id", id);
  if (error) { console.error(error); toast("Failed to delete"); return; }
  fixedExpenses = fixedExpenses.filter((f) => f.id !== id);
  renderFixedList();
  renderStillToPay();
  renderSummary();
}

// ---------- Category budgets held as fixed expenses ----------
// A fixed expense named after a daily category (Groceries, Food, …) doubles as
// the budget for it: the amount is set aside up front and spending in that
// category comes out of it, rather than being charged on top. Without this the
// same money is deducted twice — once as the budget, once as the spending.
//
// The link is derived from the name rather than stored, so there's nothing to
// configure and nothing hidden: what drives the behaviour is the row's own
// label. A split row like "Groceries (1/2)" still counts.
function categoryOfFixed(row) {
  const base = String(row.name || "")
    .replace(/\s*\(\s*\d+\s*\/\s*\d+\s*\)\s*$/, "")
    .trim()
    .toLowerCase();
  return CATEGORIES.find((c) => c.toLowerCase() === base) || null;
}

function spentInCategory(category) {
  return dailyExpenses
    .filter((d) => d.category === category)
    .reduce((s, d) => s + Number(d.amount), 0);
}

function budgetFixedFor(category) {
  return fixedExpenses
    .filter((f) => categoryOfFixed(f) === category)
    .reduce((s, f) => s + Number(f.amount), 0);
}

// Every fixed cost, whether or not any of it has been spent yet. Used where
// the question is "how much am I committed to", not "how much is left".
function fixedCommitted() {
  return fixedExpenses.reduce((s, f) => s + Number(f.amount), 0);
}

// What's still held back: ordinary rows in full, allowance rows only for the
// part not yet spent. Overspending an allowance reserves nothing further —
// the excess is already counted once, in daily spending.
//
// Remaining then works out as salary − family − reserved − allDaily, which
// stays correct whether an allowance is untouched, partly used or blown.
function fixedReserved() {
  let reserved = 0;
  const seen = new Set();
  for (const f of fixedExpenses) {
    const cat = categoryOfFixed(f);
    if (!cat) { reserved += Number(f.amount); continue; }
    if (seen.has(cat)) continue; // rows sharing a category are summed once
    seen.add(cat);
    reserved += Math.max(0, budgetFixedFor(cat) - spentInCategory(cat));
  }
  return reserved;
}

// ---------- Debts ----------
// Zip, Latitude, a loan — these look like fixed costs but they end. Storing
// the original balance and deriving what's left from the months ticked as paid
// means there's no running balance that can drift out of step with the ticks,
// and un-ticking a month corrects itself.
//
// Rows are matched by name across months, the same way a split row's parts are.
function debtBaseName(row) {
  return String(row.name || "").replace(/\s*\(\s*\d+\s*\/\s*\d+\s*\)\s*$/, "").trim();
}

// Every debt, keyed by name, computed over all months not just the visible one.
function debtSummaries() {
  const byName = {};
  for (const r of allDebtRows) {
    const key = debtBaseName(r);
    if (!key) continue;
    if (!byName[key]) byName[key] = { name: key, total: 0, paid: 0, monthly: 0, latestMonth: "" };
    const d = byName[key];
    // The most recently recorded total wins, so correcting it later sticks.
    if (r.month >= d.latestMonth) {
      d.latestMonth = r.month;
      d.total = Number(r.debt_total) || 0;
    }
    if (r.paid) d.paid += Number(r.amount);
  }

  // The monthly payment is whatever this month's rows for that debt add up to,
  // falling back to the newest month on record if this month has none.
  for (const d of Object.values(byName)) {
    const thisMonth = fixedExpenses.filter((f) => debtBaseName(f) === d.name);
    const source = thisMonth.length
      ? thisMonth
      : allDebtRows.filter((r) => debtBaseName(r) === d.name && r.month === d.latestMonth);
    d.monthly = source.reduce((s, r) => s + Number(r.amount), 0);
    d.remaining = Math.max(0, d.total - d.paid);
    d.monthsLeft = d.monthly > 0 ? Math.ceil(d.remaining / d.monthly) : null;
    d.clearedOn = null;
    if (d.monthsLeft !== null) {
      // Months still to pay counted from the current month.
      const base = firstOfMonth(new Date());
      d.clearedOn = new Date(base.getFullYear(), base.getMonth() + Math.max(0, d.monthsLeft - 1), 1);
    }
  }
  return Object.values(byName).filter((d) => d.total > 0);
}

function renderDebts() {
  const card = document.getElementById("debt-card");
  const list = document.getElementById("debt-list");
  const debts = debtSummaries();

  if (debts.length === 0) {
    card.hidden = true;
    return;
  }

  const totalLeft = debts.reduce((s, d) => s + d.remaining, 0);
  const totalOriginal = debts.reduce((s, d) => s + d.total, 0);
  document.getElementById("debt-total").textContent = fmt(totalLeft);
  document.getElementById("debt-progress").textContent = totalOriginal > 0
    ? `${fmt(totalOriginal - totalLeft)} of ${fmt(totalOriginal)} paid off`
    : "";

  list.innerHTML = "";
  // Closest to being cleared first — the finish line you'll reach soonest.
  const sorted = [...debts].sort((a, b) => a.remaining - b.remaining);
  for (const d of sorted) {
    const pct = d.total > 0 ? Math.min(100, ((d.total - d.remaining) / d.total) * 100) : 0;
    const done = d.remaining <= 0;
    const when = done
      ? "Cleared"
      : d.clearedOn
        ? "Clear by " + d.clearedOn.toLocaleDateString("en-AU", { month: "short", year: "numeric" })
        : "No payment set";

    const li = document.createElement("li");
    li.className = "budget-row";
    li.innerHTML = `
      <div class="budget-head">
        <span class="budget-name">${escapeHtml(d.name)}</span>
        <span class="budget-figures ${done ? "positive" : ""}">${done ? "Cleared" : fmt(d.remaining) + " left"}</span>
      </div>
      <div class="budget-track" aria-hidden="true"><div class="budget-fill ${done ? "is-done" : ""}" style="width:${pct}%"></div></div>
      <span class="item-sub">${when}${d.monthly > 0 && !done ? ` · ${fmt(d.monthly)}/month` : ""}</span>
    `;
    list.appendChild(li);
  }
  card.hidden = false;
}

// ---------- Paid status ----------
// Ticking something off is a record of what's actually left your account, not
// a change to the maths: rent has to be reserved for whether or not it's been
// transferred yet, so no total moves when this is toggled.
async function toggleFixedPaid(item) {
  const next = !item.paid;
  const patch = { paid: next, paid_on: next ? toDateStr(new Date()) : null };
  const { error } = await sb.from("fixed_expenses").update(patch).eq("id", item.id);
  if (error) {
    console.error(error);
    toast("Run the paid-status migration first");
    return;
  }
  item.paid = patch.paid;
  item.paid_on = patch.paid_on;
  renderFixedList();
  renderStillToPay();
  renderInsights();
  toast(next ? "Marked as paid" : "Marked as not paid");
}

async function toggleFamilyPaid() {
  const row = await ensureMonthlyRow();
  if (!row) return;
  const next = !row.family_paid;
  const patch = { family_paid: next, family_paid_on: next ? toDateStr(new Date()) : null };
  const { data, error } = await sb.from("monthly_data").update(patch).eq("id", row.id).select().single();
  if (error) {
    console.error(error);
    toast("Run the paid-status migration first");
    return;
  }
  monthlyRow = data;
  renderFamilyPaid();
  renderStillToPay();
  renderInsights();
  toast(next ? "Marked as paid" : "Marked as not paid");
}

document.getElementById("family-paid-btn").addEventListener("click", toggleFamilyPaid);

function renderFamilyPaid() {
  const family = monthlyRow ? Number(monthlyRow.family_maintenance) : 0;
  const row = document.getElementById("family-paid-row");
  const btn = document.getElementById("family-paid-btn");
  const label = document.getElementById("family-paid-label");

  const paid = !!(monthlyRow && monthlyRow.family_paid);

  // Reset the visible state before the early return below, otherwise a hidden
  // row keeps last month's text and shows it again the moment it reappears.
  row.classList.toggle("is-paid", paid);

  // Nothing to pay means nothing to tick off.
  row.hidden = family <= 0;
  if (family <= 0) {
    label.textContent = "Not paid yet";
    btn.textContent = "✓";
    return;
  }

  row.classList.toggle("is-paid", paid);
  btn.textContent = paid ? "↺" : "✓";
  btn.setAttribute("aria-label", paid ? "Mark family maintenance as not paid" : "Mark family maintenance as paid");
  label.textContent = paid
    ? "Paid" + (monthlyRow.family_paid_on
        ? " " + new Date(monthlyRow.family_paid_on + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" })
        : "")
    : "Not paid yet";
}

function unpaidCommitments() {
  const unpaidFixed = fixedExpenses.filter((f) => !f.paid).reduce((s, f) => s + Number(f.amount), 0);
  const family = monthlyRow ? Number(monthlyRow.family_maintenance) : 0;
  const unpaidFamily = monthlyRow && monthlyRow.family_paid ? 0 : family;
  return unpaidFixed + unpaidFamily;
}

function renderStillToPay() {
  const total = unpaidCommitments();
  const el = document.getElementById("still-to-pay");
  document.getElementById("still-to-pay-value").textContent = fmt(total);
  el.hidden = total <= 0;
}

function renderFixedList() {
  const ul = document.getElementById("fixed-list");
  ul.innerHTML = "";
  if (fixedExpenses.length === 0) {
    ul.innerHTML = '<li class="empty-state">No fixed expenses yet.</li>';
    return;
  }
  for (const f of fixedExpenses) {
    const li = document.createElement("li");
    if (f.paid) li.classList.add("is-paid");
    const describe = f.name + ", " + fmt(f.amount);
    const paidLabel = f.paid_on
      ? "paid " + new Date(f.paid_on + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" })
      : (f.paid ? "paid" : "");

    // What's left to spend is the number that actually guides a decision, so
    // that leads. Several rows can share a category, so this is the category
    // total rather than this row alone.
    let allowanceLabel = "";
    const cat = categoryOfFixed(f);
    if (cat) {
      const total = budgetFixedFor(cat);
      const left = total - spentInCategory(cat);
      allowanceLabel = left >= 0
        ? `<span class="item-sub">${fmt(left)} left of ${fmt(total)}</span>`
        : `<span class="item-sub negative">${fmt(-left)} over ${fmt(total)}</span>`;
    }

    li.innerHTML = `
      <div class="item-main">
        <span class="item-title">${escapeHtml(f.name)}</span>
        ${allowanceLabel}
        ${paidLabel ? `<span class="item-sub">${paidLabel}</span>` : ""}
      </div>
      <span class="item-amount">${fmt(f.amount)}</span>
      <span class="item-actions">
        <button class="settle-btn" aria-label="${escapeAttr((f.paid ? "Mark as not paid: " : "Mark as paid: ") + describe)}"
                title="${f.paid ? "Mark as not paid" : "Mark as paid"}">${f.paid ? "↺" : "✓"}</button>
        <button class="edit-btn" aria-label="${escapeAttr("Edit " + describe)}" title="Edit">✎</button>
        <button class="delete-btn" aria-label="${escapeAttr("Delete " + describe)}" title="Delete">✕</button>
      </span>
    `;
    li.querySelector(".settle-btn").addEventListener("click", () => toggleFixedPaid(f));
    li.querySelector(".delete-btn").addEventListener("click", () => deleteFixedExpense(f.id));
    attachEdit(li, f, [
      { key: "name", type: "text", required: true },
      { key: "amount", type: "number", required: true },
      // Setting this turns the row into a tracked debt; clearing it makes it an
      // ordinary recurring cost again.
      { key: "debt_total", type: "number", nullable: true, placeholder: "Total owed (debts only)" },
    ], "fixed_expenses", () => loadMonth());
    ul.appendChild(li);
  }
}

// ---------- Carrying a month forward ----------
// Family maintenance + fixed expenses carry over. Salary payments never do:
// they're dated real-world events. Paid ticks never do either, so the new
// month starts owing everything.
//
// debt_total DOES carry — without it, rolling into a new month would silently
// turn a tracked debt back into an ordinary recurring cost.
async function setUpMonthFrom(sourceMonth, { announce = true } = {}) {
  const sourceKey = monthKey(sourceMonth);
  const key = monthKey(currentMonth);

  const [prevMonthlyRes, prevFixedRes] = await Promise.all([
    sb.from("monthly_data").select("*").eq("user_id", currentUser.id).eq("month", sourceKey).maybeSingle(),
    sb.from("fixed_expenses").select("*").eq("user_id", currentUser.id).eq("month", sourceKey),
  ]);

  const prevFixed = prevFixedRes.data || [];
  // Nothing worth carrying — don't create an empty month for no reason.
  if (!prevMonthlyRes.data && prevFixed.length === 0) return false;

  const family = prevMonthlyRes.data ? prevMonthlyRes.data.family_maintenance : 0;

  const { data: newRow, error } = await sb.from("monthly_data")
    .insert({ user_id: currentUser.id, month: key, family_maintenance: family })
    .select().single();
  if (error) { console.error(error); if (announce) toast("Couldn't carry the month forward"); return false; }
  monthlyRow = newRow;

  if (prevFixed.length > 0) {
    const inserts = prevFixed.map((f) => ({
      user_id: currentUser.id,
      month: key,
      name: f.name,
      amount: f.amount,
      debt_total: f.debt_total ?? null,
    }));
    const { data: newFixed, error: fixedErr } = await sb.from("fixed_expenses").insert(inserts).select();
    if (fixedErr) console.error(fixedErr);
    fixedExpenses = newFixed || [];
  }

  document.getElementById("input-family").value = family;
  document.getElementById("copy-prompt").hidden = true;
  renderFixedList();
  // The new month starts unpaid, so the paid-status UI has to be redrawn too —
  // otherwise it keeps showing the previous month's ticks.
  renderFamilyPaid();
  renderStillToPay();
  renderDebts();
  renderSummary();
  if (announce) {
    toast(`${monthLabel(currentMonth)} set up from ${monthLabel(sourceMonth)}`);
  }
  return true;
}

document.getElementById("copy-prev-btn").addEventListener("click", () => {
  setUpMonthFrom(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
});

// ---------- Inline editing ----------
// Shared by every list. Swaps a row into a small form in place; on save it
// patches the row and reloads the month, which keeps lists and totals correct
// even when an edit moves an entry into a different month.
// escapeHtml leaves quotes alone, which is fine for text nodes but would break
// out of an attribute — so attribute values get the extra pass.
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

// `description` names the row, so a screen reader announces "Delete Rent"
// rather than eight identical "Delete" buttons.
// `extra` lets a row slot in its own buttons (the receipt 📎) ahead of the
// edit and delete pair every row shares.
function rowActions(description, extra) {
  const label = escapeAttr(description || "entry");
  return `
    <span class="item-actions">
      ${extra || ""}
      <button class="edit-btn" aria-label="Edit ${label}" title="Edit">✎</button>
      <button class="delete-btn" aria-label="Delete ${label}" title="Delete">✕</button>
    </span>
  `;
}

function attachEdit(li, item, spec, table, rerender) {
  const editBtn = li.querySelector(".edit-btn");
  if (!editBtn) return;

  editBtn.addEventListener("click", () => {
    const form = document.createElement("form");
    form.className = "edit-form";

    for (const field of spec) {
      let input;
      if (field.type === "select") {
        input = document.createElement("select");
        for (const opt of field.options) {
          const option = document.createElement("option");
          option.value = typeof opt === "string" ? opt : opt.value;
          option.textContent = typeof opt === "string" ? opt : opt.label;
          input.appendChild(option);
        }
      } else {
        input = document.createElement("input");
        input.type = field.type;
        if (field.type === "number") {
          input.step = "0.01";
          input.min = "0";
          input.inputMode = "decimal";
        }
        if (field.placeholder) input.placeholder = field.placeholder;
        if (field.required) input.required = true;
      }
      input.dataset.key = field.key;
      input.value = item[field.key] == null ? "" : item[field.key];
      form.appendChild(input);
    }

    const actions = document.createElement("div");
    actions.className = "edit-actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.className = "btn btn-primary";
    saveBtn.textContent = "Save";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-ghost";
    cancelBtn.textContent = "Cancel";
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    form.appendChild(actions);

    li.innerHTML = "";
    li.classList.add("editing");
    li.appendChild(form);
    form.querySelector("[data-key]").focus();

    cancelBtn.addEventListener("click", rerender);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      saveBtn.disabled = true;

      const patch = {};
      for (const el of form.querySelectorAll("[data-key]")) {
        const field = spec.find((f) => f.key === el.dataset.key);
        // A blank nullable number has to become null, not 0 — for a field like
        // "total owed" those mean different things: no debt vs a debt of zero.
        let value;
        if (field.type === "number") {
          const raw = el.value.trim();
          value = raw === "" && field.nullable ? null : (parseFloat(raw) || 0);
        } else {
          value = el.value.trim();
          if (field.nullable && value === "") value = null;
        }
        patch[field.key] = value;
      }

      const { error } = await sb.from(table).update(patch).eq("id", item.id);
      if (error) {
        console.error(error);
        toast("Failed to save");
        saveBtn.disabled = false;
        return;
      }
      toast("Saved");
      loadMonth();
    });
  });
}

// ---------- Salary payments ----------
onSubmitLocked("salary-form", async () => {
  const date = document.getElementById("salary-date").value;
  const amountInput = document.getElementById("salary-amount");
  const noteInput = document.getElementById("salary-note");
  const amount = parseFloat(amountInput.value);
  const note = noteInput.value.trim();
  if (!date || isNaN(amount)) return;

  const { data, error } = await sb.from("salary_payments")
    .insert({ user_id: currentUser.id, date, amount, note: note || null })
    .select().single();
  if (error) { console.error(error); toast("Failed to add payment"); return; }

  amountInput.value = "";
  noteInput.value = "";

  if (date >= toDateStr(currentMonth) && date < toDateStr(monthEndExclusive(currentMonth))) {
    salaryPayments.unshift(data);
    salaryPayments.sort((a, b) => (a.date < b.date ? 1 : -1));
    renderSalaryList();
    renderSummary();
  }
  toast("Payment added");
});

async function deleteSalaryPayment(id) {
  const { error } = await sb.from("salary_payments").delete().eq("id", id);
  if (error) { console.error(error); toast("Failed to delete"); return; }
  salaryPayments = salaryPayments.filter((p) => p.id !== id);
  renderSalaryList();
  renderSummary();
}

function renderSalaryList() {
  const ul = document.getElementById("salary-list");
  ul.innerHTML = "";
  if (salaryPayments.length === 0) {
    ul.innerHTML = '<li class="empty-state">No payments logged this month.</li>';
    return;
  }
  for (const p of salaryPayments) {
    const li = document.createElement("li");
    const dateLabel = new Date(p.date + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" });
    li.innerHTML = `
      <div class="item-main">
        <span class="item-title">${dateLabel}</span>
        ${p.note ? `<span class="item-sub">${escapeHtml(p.note)}</span>` : ""}
      </div>
      <span class="item-amount">${fmt(p.amount)}</span>
      ${rowActions("salary payment of " + fmt(p.amount) + " on " + dateLabel)}
    `;
    li.querySelector(".delete-btn").addEventListener("click", () => deleteSalaryPayment(p.id));
    attachEdit(li, p, [
      { key: "date", type: "date", required: true },
      { key: "amount", type: "number", required: true },
      { key: "note", type: "text", placeholder: "Note (optional)", nullable: true },
    ], "salary_payments", renderSalaryList);
    ul.appendChild(li);
  }
}

// ---------- Savings ----------
// savingsTransactions holds every transaction ever (for the all-time balance);
// "this month" is derived from it client-side rather than a second query.
function signedAmount(tx) {
  return tx.type === "withdrawal" ? -Number(tx.amount) : Number(tx.amount);
}

function savingsThisMonth() {
  const start = toDateStr(currentMonth);
  const end = toDateStr(monthEndExclusive(currentMonth));
  return savingsTransactions.filter((t) => t.date >= start && t.date < end);
}

onSubmitLocked("savings-form", async () => {
  const date = document.getElementById("savings-date").value;
  const type = document.getElementById("savings-type").value;
  const amountInput = document.getElementById("savings-amount");
  const noteInput = document.getElementById("savings-note");
  const amount = parseFloat(amountInput.value);
  const note = noteInput.value.trim();
  if (!date || isNaN(amount)) return;

  const { data, error } = await sb.from("savings_transactions")
    .insert({ user_id: currentUser.id, date, type, amount, note: note || null })
    .select().single();
  if (error) { console.error(error); toast("Failed to add"); return; }

  amountInput.value = "";
  noteInput.value = "";

  savingsTransactions.unshift(data);
  savingsTransactions.sort((a, b) => (a.date < b.date ? 1 : -1));
  renderSavingsList();
  renderSummary();
  toast(type === "deposit" ? "Added to savings" : "Taken from savings");
});

async function deleteSavingsTransaction(id) {
  const { error } = await sb.from("savings_transactions").delete().eq("id", id);
  if (error) { console.error(error); toast("Failed to delete"); return; }
  savingsTransactions = savingsTransactions.filter((t) => t.id !== id);
  renderSavingsList();
  renderSummary();
}

function renderSavingsList() {
  const balance = savingsTransactions.reduce((s, t) => s + signedAmount(t), 0);
  document.getElementById("savings-balance").textContent = fmt(balance);

  const ul = document.getElementById("savings-list");
  ul.innerHTML = "";
  const thisMonth = savingsThisMonth();
  if (thisMonth.length === 0) {
    ul.innerHTML = '<li class="empty-state">No savings activity this month.</li>';
    return;
  }
  for (const t of thisMonth) {
    const li = document.createElement("li");
    const dateLabel = new Date(t.date + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" });
    const label = t.type === "deposit" ? "Put in" : "Taken out";
    li.innerHTML = `
      <div class="item-main">
        <span class="item-title">${label} · ${dateLabel}</span>
        ${t.note ? `<span class="item-sub">${escapeHtml(t.note)}</span>` : ""}
      </div>
      <span class="item-amount">${t.type === "withdrawal" ? "-" : ""}${fmt(t.amount)}</span>
      ${rowActions("savings, " + label.toLowerCase() + " " + fmt(t.amount) + " on " + dateLabel)}
    `;
    li.querySelector(".delete-btn").addEventListener("click", () => deleteSavingsTransaction(t.id));
    attachEdit(li, t, [
      { key: "date", type: "date", required: true },
      { key: "type", type: "select", options: [{ value: "deposit", label: "Put money in" }, { value: "withdrawal", label: "Take money out" }] },
      { key: "amount", type: "number", required: true },
      { key: "note", type: "text", placeholder: "Note (optional)", nullable: true },
    ], "savings_transactions", renderSavingsList);
    ul.appendChild(li);
  }
}

// ---------- Quick add ----------
// The same few expenses get logged over and over. Offering them as one-tap
// buttons — built from what's actually been logged, not a list to maintain —
// turns the common case into a single tap. Undo makes that safe: a mistap
// costs one more tap, not a trip to the list to delete a row.
const QUICK_ADD_WINDOW_DAYS = 60;
const QUICK_ADD_MAX = 6;

function quickAddSuggestions() {
  const cutoff = toDateStr(addDays(new Date(), -QUICK_ADD_WINDOW_DAYS));
  const seen = {};
  for (const d of allDailyExpenses) {
    if (d.date < cutoff) continue;
    const note = String(d.note || "").trim();
    const amount = Number(d.amount);
    if (!(amount > 0)) continue;
    const key = `${d.category}|${amount.toFixed(2)}|${note.toLowerCase()}`;
    if (!seen[key]) seen[key] = { category: d.category, amount, note, count: 0 };
    seen[key].count++;
  }
  return Object.values(seen)
    // Something logged once is a one-off, not a habit worth a button.
    .filter((s) => s.count >= 2)
    .sort((a, b) => b.count - a.count || b.amount - a.amount)
    .slice(0, QUICK_ADD_MAX);
}

function renderQuickAdd() {
  const box = document.getElementById("quick-add");
  const today = new Date();
  const viewingCurrentMonth =
    today.getFullYear() === currentMonth.getFullYear() && today.getMonth() === currentMonth.getMonth();
  box.textContent = "";

  // A chip always logs to today, so outside the month containing today the tap
  // would file the expense somewhere the user can't see and read as a no-op.
  // A past month hides them anyway once it falls out of the 60-day window, but
  // a future month is still inside it — so the check has to be explicit.
  if (!viewingCurrentMonth) {
    box.hidden = true;
    return;
  }

  const suggestions = quickAddSuggestions();
  if (suggestions.length === 0) {
    box.hidden = true;
    return;
  }

  for (const s of suggestions) {
    const label = s.note || s.category;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quick-chip";
    btn.innerHTML = `<span class="quick-chip-label">${escapeHtml(label)}</span><span class="quick-chip-amount">${fmt(s.amount)}</span>`;
    btn.setAttribute("aria-label", `Log ${label}, ${fmt(s.amount)}, ${s.category}`);
    btn.addEventListener("click", () => quickAdd(s, btn));
    box.appendChild(btn);
  }
  box.hidden = false;
}

async function quickAdd(s, btn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const date = toDateStr(new Date());
    const { data, error } = await sb.from("daily_expenses")
      .insert({ user_id: currentUser.id, date, category: s.category, amount: s.amount, note: s.note || null })
      .select().single();
    if (error) { console.error(error); toast("Couldn't add that"); return; }

    if (date >= toDateStr(currentMonth) && date < toDateStr(monthEndExclusive(currentMonth))) {
      dailyExpenses.unshift(data);
      dailyExpenses.sort((a, b) => (a.date < b.date ? 1 : -1));
      allDailyExpenses.unshift(data);
      renderDailyList();
      renderCategoryBreakdown();
      renderFixedList();
      renderBudgets();
      renderSummary();
    }

    // Deliberately no renderQuickAdd() here, unlike the form path: this tap
    // just bumped the chip's own count, and re-sorting the row would move the
    // buttons under the user's finger mid-tap. They settle on the next load.
    toast(`Added ${s.note || s.category} ${fmt(s.amount)}`, {
      label: "Undo",
      onClick: () => deleteDailyExpense(data.id),
    });
  } finally {
    btn.disabled = false;
  }
}

// ---------- Daily expense date ----------
// Defaults to today so logging an expense is just amount + category. The
// picker stays available behind "Change" for back-dating something you forgot.
// Note: the input is deliberately not `required` — a hidden required field
// silently blocks form submission in browsers.
let dailyDateManual = false;

function setDailyDateLabel() {
  const input = document.getElementById("daily-date");
  const label = document.getElementById("daily-date-label");
  const todayStr = toDateStr(new Date());
  const asDate = new Date((input.value || todayStr) + "T00:00:00");
  label.textContent = (!input.value || input.value === todayStr)
    ? "Today, " + asDate.toLocaleDateString("en-AU", { day: "numeric", month: "short" })
    : asDate.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

function resetDailyDateToToday() {
  dailyDateManual = false;
  document.getElementById("daily-date").value = toDateStr(new Date());
  document.getElementById("daily-date").hidden = true;
  document.getElementById("daily-date-display").hidden = false;
  setDailyDateLabel();
}

document.getElementById("daily-date-change").addEventListener("click", () => {
  dailyDateManual = true;
  const input = document.getElementById("daily-date");
  input.hidden = false;
  document.getElementById("daily-date-display").hidden = true;
  input.focus();
  if (input.showPicker) {
    try { input.showPicker(); } catch (err) { /* not supported / not user-activated */ }
  }
});

document.getElementById("daily-date").addEventListener("change", setDailyDateLabel);

// ---------- Pay cycle ----------
// Pay lands fortnightly, but budgets are monthly, and the two never line up.
// The cycle is derived from the salary payments already logged rather than
// asking for a schedule to be configured: any real payment date anchors the
// fortnight, since every other payday is 14 days from it.
const PAY_INTERVAL_DAYS = 14;

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function payAnchorDate() {
  if (allSalaryPayments.length === 0) return null;
  // The latest real payment is the most trustworthy anchor — earlier ones may
  // predate a change of payday.
  const latest = allSalaryPayments.map((p) => p.date).sort().pop();
  return new Date(latest + "T00:00:00");
}

// The fortnight containing `date`, counted in whole 14-day steps from anchor.
function cycleContaining(date, anchor) {
  const steps = Math.floor((date - anchor) / 86400000 / PAY_INTERVAL_DAYS);
  const start = addDays(anchor, steps * PAY_INTERVAL_DAYS);
  return { start, end: addDays(start, PAY_INTERVAL_DAYS) };
}

// Pay dates landing inside a given calendar month.
function payDatesInMonth(monthStart, anchor) {
  const monthEnd = monthEndExclusive(monthStart);
  const first = cycleContaining(monthStart, anchor).start;
  const dates = [];
  for (let d = first; d < monthEnd; d = addDays(d, PAY_INTERVAL_DAYS)) {
    if (d >= monthStart) dates.push(new Date(d));
  }
  return dates;
}

function renderPayCycle() {
  const card = document.getElementById("cycle-card");
  const anchor = payAnchorDate();
  const today = new Date();
  const viewingCurrentMonth =
    today.getFullYear() === currentMonth.getFullYear() && today.getMonth() === currentMonth.getMonth();

  // The cycle is a "right now" tool, so it would only confuse things while
  // browsing a past month.
  if (!anchor || !viewingCurrentMonth) {
    card.hidden = true;
    return;
  }

  const { start, end } = cycleContaining(today, anchor);
  const startStr = toDateStr(start);
  const endStr = toDateStr(end);

  const income = allSalaryPayments
    .filter((p) => p.date >= startStr && p.date < endStr)
    .reduce((s, p) => s + Number(p.amount), 0);
  const spent = allDailyExpenses
    .filter((d) => d.date >= startStr && d.date < endStr)
    .reduce((s, d) => s + Number(d.amount), 0);
  const savedNet = savingsTransactions
    .filter((t) => t.date >= startStr && t.date < endStr)
    .reduce((s, t) => s + signedAmount(t), 0);

  // Fixed costs are monthly, so charge the cycle its share of them rather than
  // pretending a fortnight carries a whole month of rent.
  // Reserved, not committed: spending already logged against an allowance is
  // in `spent` below, so charging the full allowance here would double-count.
  const family = monthlyRow ? Number(monthlyRow.family_maintenance) : 0;
  const monthlyCommitments = family + fixedReserved();
  const share = monthlyCommitments * (PAY_INTERVAL_DAYS / daysInMonth(currentMonth));

  // Pay yourself first: the target is reserved before anything counts as
  // spendable. Money already moved to savings this cycle counts towards it —
  // subtracting both the actual transfer and the full target would double-count
  // it and understate what's genuinely available.
  const alreadySaved = Math.max(0, savedNet);
  const stillToSave = Math.max(0, savePerCycle - alreadySaved);
  const left = income - share - spent - savedNet - stillToSave;

  const daysLeft = Math.max(0, Math.ceil((end - today) / 86400000));
  const perDay = daysLeft > 0 ? left / daysLeft : left;

  const fmtDay = (d) => d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  document.getElementById("cycle-range").textContent =
    fmtDay(start) + " → " + fmtDay(addDays(end, -1)) + " · next pay " + fmtDay(end);

  document.getElementById("cycle-income").textContent = fmt(income);
  document.getElementById("cycle-spent").textContent = fmt(spent);

  const leftEl = document.getElementById("cycle-left");
  leftEl.textContent = fmt(left);
  leftEl.classList.toggle("negative", left < 0);

  document.getElementById("cycle-perday-label").textContent =
    daysLeft > 0 ? `Per day for ${daysLeft} more day${daysLeft === 1 ? "" : "s"}` : "Per day";
  const perDayEl = document.getElementById("cycle-perday");
  perDayEl.textContent = fmt(Math.max(0, perDay));
  perDayEl.classList.toggle("negative", perDay <= 0);

  // Headline: what's actually safe to spend today, savings already reserved.
  const spendToday = daysLeft > 0 ? Math.max(0, left) / daysLeft : Math.max(0, left);
  document.getElementById("spend-today").textContent = fmt(spendToday);

  const hero = document.getElementById("spend-hero");
  hero.classList.toggle("is-over", left < 0);
  document.getElementById("spend-hero-sub").textContent = left < 0
    ? `You're ${fmt(Math.abs(left))} beyond what's left this pay period.`
    : `${fmt(left)} left for ${daysLeft} more day${daysLeft === 1 ? "" : "s"}` +
      (savePerCycle > 0 ? `, after setting aside ${fmt(savePerCycle)}.` : ".");

  const progressEl = document.getElementById("save-progress");
  if (settingsUnavailable) {
    progressEl.textContent = "Run migration_user_settings.sql in Supabase to switch the savings target on.";
  } else if (savePerCycle <= 0) {
    progressEl.textContent = "Set an amount above and it's held back before anything counts as spendable — the surest way to actually save it.";
  } else if (stillToSave <= 0) {
    progressEl.textContent = `Target met — ${fmt(alreadySaved)} put aside this pay period.`;
  } else {
    progressEl.textContent = `${fmt(alreadySaved)} of ${fmt(savePerCycle)} put aside so far — ${fmt(stillToSave)} still reserved.`;
  }

  document.getElementById("cycle-note").textContent =
    `Includes ${fmt(share)} as this fortnight's share of your ${fmt(monthlyCommitments)} monthly fixed costs and family maintenance.`;

  card.hidden = false;
}

// Saving the target is debounced the same way the family maintenance field is.
let savePerCycleTimer;
document.getElementById("save-per-cycle").addEventListener("input", (e) => {
  clearTimeout(savePerCycleTimer);
  const value = e.target.value;
  savePerCycleTimer = setTimeout(async () => {
    const amount = parseFloat(value) || 0;
    const { error } = await sb.from("user_settings").upsert(
      { user_id: currentUser.id, save_per_cycle: amount, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    if (error) {
      console.error(error);
      toast(settingsUnavailable ? "Run the settings migration first" : "Failed to save target");
      return;
    }
    savePerCycle = amount;
    renderPayCycle();
    toast("Savings target saved");
  }, 600);
});

// ---------- Money owed back to you ----------
// Work purchases and money lent to a roommate. These are reminders, never
// spending: nothing here feeds Remaining, the trend chart, category budgets or
// any insight about what you've spent.
const OWED_KINDS = {
  work: { list: "work-list", total: "work-outstanding", form: "work-form", noun: "purchase" },
  roommate: { list: "roommate-list", total: "roommate-outstanding", form: "roommate-form", noun: "loan" },
};

function owedItems(kind) {
  return reimbursements.filter((r) => r.owed_by === kind);
}

function owedOutstanding(kind) {
  return owedItems(kind)
    .filter((r) => !r.settled)
    .reduce((sum, r) => sum + Number(r.amount), 0);
}

function renderOwed() {
  for (const kind of Object.keys(OWED_KINDS)) renderOwedList(kind);
}

function renderOwedList(kind) {
  const cfg = OWED_KINDS[kind];
  document.getElementById(cfg.total).textContent = fmt(owedOutstanding(kind));

  const ul = document.getElementById(cfg.list);
  ul.innerHTML = "";

  if (reimbursementsUnavailable) {
    ul.innerHTML = '<li class="empty-state">Run <code>migration_reimbursements.sql</code> in Supabase to switch this on.</li>';
    return;
  }

  const items = owedItems(kind);
  if (items.length === 0) {
    ul.innerHTML = '<li class="empty-state">Nothing recorded yet.</li>';
    return;
  }

  // Outstanding first — the whole point is seeing what you're still owed.
  const sorted = [...items].sort((a, b) => {
    if (a.settled !== b.settled) return a.settled ? 1 : -1;
    return a.date < b.date ? 1 : -1;
  });

  for (const r of sorted) {
    const li = document.createElement("li");
    if (r.settled) li.classList.add("is-settled");
    const dateLabel = new Date(r.date + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
    const describe = r.description + ", " + fmt(r.amount) + " on " + dateLabel;
    const clearedLabel = r.settled_on
      ? " · cleared " + new Date(r.settled_on + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" })
      : (r.settled ? " · cleared" : "");

    li.innerHTML = `
      <div class="item-main">
        <span class="item-title">${escapeHtml(r.description)}</span>
        <span class="item-sub">${dateLabel}${clearedLabel}</span>
      </div>
      <span class="item-amount">${fmt(r.amount)}</span>
      <span class="item-actions">
        ${receiptButton(r, describe)}
        <button class="settle-btn" aria-label="${escapeAttr((r.settled ? "Reopen, not actually cleared: " : "Mark as cleared: ") + describe)}"
                title="${r.settled ? "Reopen — not cleared after all" : "Mark as cleared"}">${r.settled ? "↺" : "✓"}</button>
        <button class="edit-btn" aria-label="${escapeAttr("Edit " + describe)}" title="Edit">✎</button>
        <button class="delete-btn" aria-label="${escapeAttr("Delete " + describe)}" title="Delete">✕</button>
      </span>
    `;

    wireReceiptButton(li, r);
    li.querySelector(".settle-btn").addEventListener("click", () => toggleOwedSettled(r));
    li.querySelector(".delete-btn").addEventListener("click", () => deleteOwed(r.id));
    attachEdit(li, r, [
      { key: "date", type: "date", required: true },
      { key: "description", type: "text", required: true },
      { key: "amount", type: "number", required: true },
    ], "reimbursements", () => renderOwedList(kind));

    ul.appendChild(li);
  }
}

async function toggleOwedSettled(item) {
  const next = !item.settled;
  // Record when it cleared, so the history shows how long you waited.
  const patch = { settled: next, settled_on: next ? toDateStr(new Date()) : null };
  // The receipt exists to get the money back. Once it's back, the photo is
  // just a bill sitting in storage, so clearing takes it with it. Reopening
  // can't bring it back, hence the toast says so plainly rather than letting
  // it vanish quietly.
  const droppingReceipt = next && !!item.receipt_path;
  if (droppingReceipt) patch.receipt_path = null;

  const { error } = await sb.from("reimbursements").update(patch).eq("id", item.id);
  if (error) { console.error(error); toast("Failed to update"); return; }

  if (droppingReceipt) {
    // Only after the row has let go of the path — if this ran first and the
    // update then failed, the row would point at a file that no longer exists.
    await deleteReceipt(item.receipt_path);
    item.receipt_path = null;
  }

  item.settled = patch.settled;
  item.settled_on = patch.settled_on;
  renderOwedList(item.owed_by);
  renderInsights();
  toast(next
    ? (droppingReceipt ? "Cleared — receipt deleted" : "Cleared")
    : "Reopened — still owed");
}

async function deleteOwed(id) {
  // Read the path before the row goes, or there's nothing left to clean up.
  const receiptPath = (reimbursements.find((r) => r.id === id) || {}).receipt_path;
  const { error } = await sb.from("reimbursements").delete().eq("id", id);
  if (error) { console.error(error); toast("Failed to delete"); return; }
  await deleteReceipt(receiptPath);
  const removed = reimbursements.find((r) => r.id === id);
  reimbursements = reimbursements.filter((r) => r.id !== id);
  if (removed) renderOwedList(removed.owed_by);
  renderInsights();
}

function wireOwedForm(kind) {
  const cfg = OWED_KINDS[kind];
  onSubmitLocked(cfg.form, async () => {
    const dateEl = document.getElementById(kind + "-date");
    const amountEl = document.getElementById(kind + "-amount");
    const descEl = document.getElementById(kind + "-desc");
    const amount = parseFloat(amountEl.value);
    const description = descEl.value.trim();
    if (!dateEl.value || isNaN(amount) || !description) return;

    const { data, error } = await sb.from("reimbursements")
      .insert({ user_id: currentUser.id, date: dateEl.value, owed_by: kind, description, amount, settled: false })
      .select().single();
    if (error) {
      console.error(error);
      toast(reimbursementsUnavailable ? "Run the reimbursements migration first" : "Failed to add");
      return;
    }

    // Only work purchases get a receipt picker — a roommate loan is a note to
    // yourself, not something you have to prove to anyone.
    const picker = kind === "work" ? workReceiptPicker : null;
    const receiptFile = picker && picker.file();
    const receiptOk = receiptFile ? await attachReceipt("reimbursements", data, receiptFile, picker) : true;

    reimbursements.unshift(data);
    amountEl.value = "";
    descEl.value = "";
    dateEl.value = toDateStr(new Date());
    renderOwedList(kind);
    renderInsights();
    // attachReceipt has already said what went wrong; don't paper over it.
    if (receiptOk) toast("Saved as a reminder — not counted as spending");
  });
}

for (const kind of Object.keys(OWED_KINDS)) wireOwedForm(kind);

// ---------- Money I owe ----------
// The mirror of reimbursements above, and the one place in the app where an
// "owed" row genuinely IS spending. Gotcha 11 says reimbursements must never
// enter a spending total; this is the deliberate opposite, so keep the two
// apart. The rule: an unpaid IOU costs you nothing yet — it only lands in
// Remaining in the month you actually hand the money over, which is why
// `repaid_on` decides the month rather than `date`.

function iouOutstanding() {
  return personalDebts.filter((d) => !d.repaid).reduce((sum, d) => sum + Number(d.amount), 0);
}

// What you paid back inside the month being viewed. This is the figure that
// leaves Remaining.
function repaidThisMonth() {
  const start = toDateStr(currentMonth);
  const end = toDateStr(monthEndExclusive(currentMonth));
  return personalDebts
    .filter((d) => d.repaid && d.repaid_on && d.repaid_on >= start && d.repaid_on < end)
    .reduce((sum, d) => sum + Number(d.amount), 0);
}

function renderIouList() {
  document.getElementById("iou-outstanding").textContent = fmt(iouOutstanding());

  const ul = document.getElementById("iou-list");
  ul.innerHTML = "";

  if (personalDebtsUnavailable) {
    ul.innerHTML = '<li class="empty-state">Run <code>migration_personal_debts.sql</code> in Supabase to switch this on.</li>';
    return;
  }

  if (personalDebts.length === 0) {
    ul.innerHTML = '<li class="empty-state">You don\'t owe anyone right now.</li>';
    return;
  }

  // Still-owed first: the whole point is seeing what you still have to pay.
  const sorted = [...personalDebts].sort((a, b) => {
    if (a.repaid !== b.repaid) return a.repaid ? 1 : -1;
    return a.date < b.date ? 1 : -1;
  });

  for (const d of sorted) {
    const li = document.createElement("li");
    if (d.repaid) li.classList.add("is-settled");
    const dateLabel = new Date(d.date + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
    const describe = `${d.person}, ${fmt(d.amount)} for ${d.description} on ${dateLabel}`;
    const paidLabel = d.repaid_on
      ? " · paid back " + new Date(d.repaid_on + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" })
      : (d.repaid ? " · paid back" : "");

    li.innerHTML = `
      <div class="item-main">
        <span class="item-title">${escapeHtml(d.person)}</span>
        <span class="item-sub">${escapeHtml(d.description)} · ${dateLabel}${paidLabel}</span>
      </div>
      <span class="item-amount">${fmt(d.amount)}</span>
      <span class="item-actions">
        <button class="settle-btn" aria-label="${escapeAttr((d.repaid ? "Reopen, not actually paid back: " : "Mark as paid back: ") + describe)}"
                title="${d.repaid ? "Reopen — not paid back after all" : "Mark as paid back"}">${d.repaid ? "↺" : "✓"}</button>
        <button class="edit-btn" aria-label="${escapeAttr("Edit " + describe)}" title="Edit">✎</button>
        <button class="delete-btn" aria-label="${escapeAttr("Delete " + describe)}" title="Delete">✕</button>
      </span>
    `;

    li.querySelector(".settle-btn").addEventListener("click", () => toggleIouRepaid(d));
    li.querySelector(".delete-btn").addEventListener("click", () => deleteIou(d.id));
    attachEdit(li, d, [
      { key: "date", type: "date", required: true },
      { key: "person", type: "text", required: true },
      { key: "description", type: "text", required: true },
      { key: "amount", type: "number", required: true },
    ], "personal_debts", renderAfterIouChange);
    ul.appendChild(li);
  }
}

// Editing an amount moves what Remaining subtracts, so the summary has to be
// redrawn too — not just the list.
function renderAfterIouChange() {
  renderIouList();
  renderSummary();
}

async function toggleIouRepaid(item) {
  const next = !item.repaid;
  // `repaid_on` is the date the money actually moved, so it decides which
  // month wears the cost. Today, because you tick it when you pay.
  const patch = { repaid: next, repaid_on: next ? toDateStr(new Date()) : null };
  const { error } = await sb.from("personal_debts").update(patch).eq("id", item.id);
  if (error) { console.error(error); toast("Failed to update"); return; }
  item.repaid = patch.repaid;
  item.repaid_on = patch.repaid_on;
  renderAfterIouChange();
  toast(next ? `Paid back — counts as spending this month` : "Reopened — still owed");
}

async function deleteIou(id) {
  const { error } = await sb.from("personal_debts").delete().eq("id", id);
  if (error) { console.error(error); toast("Failed to delete"); return; }
  personalDebts = personalDebts.filter((d) => d.id !== id);
  renderAfterIouChange();
}

onSubmitLocked("iou-form", async () => {
  const dateEl = document.getElementById("iou-date");
  const amountEl = document.getElementById("iou-amount");
  const personEl = document.getElementById("iou-person");
  const descEl = document.getElementById("iou-desc");
  const amount = parseFloat(amountEl.value);
  const person = personEl.value.trim();
  const description = descEl.value.trim();
  if (!dateEl.value || isNaN(amount) || !person || !description) return;

  const { data, error } = await sb.from("personal_debts")
    .insert({ user_id: currentUser.id, date: dateEl.value, person, description, amount, repaid: false })
    .select().single();
  if (error) {
    console.error(error);
    toast(personalDebtsUnavailable ? "Run the personal debts migration first" : "Failed to add");
    return;
  }

  personalDebts.unshift(data);
  amountEl.value = "";
  personEl.value = "";
  descEl.value = "";
  dateEl.value = toDateStr(new Date());
  renderAfterIouChange();
  toast("Saved — counts as spending when you pay it back");
});

// ---------- Receipts ----------
// Photos live in a private Storage bucket, one folder per user, and are only
// ever reached through a short-lived signed URL. The row holds the object
// path; a null path just means no photo, so a database that hasn't had
// migration_receipts.sql run yet simply never shows a receipt button.
const RECEIPT_BUCKET = "receipts";
const RECEIPT_MAX_PX = 1600;
const RECEIPT_QUALITY = 0.82;
// Below this, re-encoding tends to cost more quality than it saves bytes.
const RECEIPT_SKIP_BYTES = 700 * 1024;

// A phone camera produces 3-5 MB per shot, which is slow to send on mobile
// data and pointless for something that only has to be legible. Anything that
// won't decode (an unusual HEIC, say) falls through to the original file
// rather than failing the upload outright.
async function shrinkReceipt(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, RECEIPT_MAX_PX / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= RECEIPT_SKIP_BYTES) { bitmap.close(); return file; }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", RECEIPT_QUALITY));
    // Re-encoding can inflate an already-optimised file; keep whichever is smaller.
    return blob && blob.size < file.size ? blob : file;
  } catch (e) {
    console.error(e);
    return file;
  }
}

async function uploadReceipt(file) {
  const body = await shrinkReceipt(file);
  const type = body.type || file.type || "image/jpeg";
  const ext = type === "image/jpeg" ? "jpg" : (type.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5);
  // The uid folder is what the Storage policy checks, so it isn't cosmetic.
  const path = `${currentUser.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from(RECEIPT_BUCKET).upload(path, body, { contentType: type, upsert: false });
  if (error) { console.error(error); return null; }
  return path;
}

// Best-effort: a receipt that outlives its row is clutter, never a
// correctness problem, so a failure here must not block the caller.
async function deleteReceipt(path) {
  if (!path) return;
  const { error } = await sb.storage.from(RECEIPT_BUCKET).remove([path]);
  if (error) console.error(error);
}

// Called only after the row itself is safely saved, so a Storage or migration
// problem costs the photo and never the expense.
async function attachReceipt(table, row, file, picker) {
  toast("Uploading receipt…");
  const path = await uploadReceipt(file);
  if (!path) { toast("Saved — but the receipt didn't upload"); return false; }

  const { error } = await sb.from(table).update({ receipt_path: path }).eq("id", row.id);
  if (error) {
    console.error(error);
    // Nothing points at it now, so leaving it would orphan the object.
    await deleteReceipt(path);
    toast("Saved — but receipts need migration_receipts.sql run first");
    return false;
  }

  row.receipt_path = path;
  if (picker) picker.clear();
  return true;
}

async function openReceipt(path) {
  const { data, error } = await sb.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 60);
  if (error || !data) { console.error(error); toast("Couldn't open that receipt"); return; }
  showReceiptViewer(data.signedUrl);
}

// Markup for the 📎 button on a row that has a photo. Rendered inside
// .item-actions alongside edit and delete.
function receiptButton(row, description) {
  if (!row.receipt_path) return "";
  return `<button class="receipt-view-btn" aria-label="${escapeAttr("View receipt for " + description)}" title="View receipt">📎</button>`;
}

function wireReceiptButton(li, row) {
  const btn = li.querySelector(".receipt-view-btn");
  if (btn) btn.addEventListener("click", () => openReceipt(row.receipt_path));
}

// ---------- Receipt viewer ----------
// A plain overlay rather than a new tab: the app is usually running as an
// installed PWA, where opening a tab drops the user out into the browser.
function showReceiptViewer(url) {
  const box = document.getElementById("receipt-viewer");
  document.getElementById("receipt-image").src = url;
  box.hidden = false;
  document.getElementById("receipt-close").focus();
}

function hideReceiptViewer() {
  const box = document.getElementById("receipt-viewer");
  if (box.hidden) return;
  box.hidden = true;
  // Drop the signed URL so the image isn't held in memory after closing.
  document.getElementById("receipt-image").removeAttribute("src");
}

document.getElementById("receipt-close").addEventListener("click", hideReceiptViewer);
document.getElementById("receipt-viewer").addEventListener("click", (e) => {
  // Backdrop only — a tap on the photo itself shouldn't close it.
  if (e.target.id === "receipt-viewer") hideReceiptViewer();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideReceiptViewer();
});

// ---------- Receipt picker (the camera button on a form) ----------
function wireReceiptPicker(prefix) {
  const input = document.getElementById(prefix + "-receipt");
  const btn = document.getElementById(prefix + "-receipt-btn");
  const clearBtn = document.getElementById(prefix + "-receipt-clear");

  function refresh() {
    const file = (input.files && input.files[0]) || null;
    btn.textContent = file ? "📎 Photo attached" : "📷 Add receipt";
    btn.classList.toggle("has-file", !!file);
    clearBtn.hidden = !file;
  }

  btn.addEventListener("click", () => input.click());
  input.addEventListener("change", refresh);
  clearBtn.addEventListener("click", () => { input.value = ""; refresh(); });
  refresh();

  return {
    file: () => (input.files && input.files[0]) || null,
    clear: () => { input.value = ""; refresh(); },
  };
}

const dailyReceiptPicker = wireReceiptPicker("daily");
const workReceiptPicker = wireReceiptPicker("work");

// ---------- Daily expenses ----------
onSubmitLocked("daily-form", async () => {
  const date = document.getElementById("daily-date").value;
  const category = document.getElementById("daily-category").value;
  const amountInput = document.getElementById("daily-amount");
  const noteInput = document.getElementById("daily-note");
  const amount = parseFloat(amountInput.value);
  const note = noteInput.value.trim();
  if (!date || isNaN(amount)) return;

  const { data, error } = await sb.from("daily_expenses")
    .insert({ user_id: currentUser.id, date, category, amount, note: note || null })
    .select().single();
  if (error) { console.error(error); toast("Failed to add expense"); return; }

  const receiptFile = dailyReceiptPicker.file();
  // attachReceipt has already explained any failure; overwriting that with a
  // cheerful "Expense added" would hide the one thing worth reading.
  const receiptOk = receiptFile ? await attachReceipt("daily_expenses", data, receiptFile, dailyReceiptPicker) : true;

  amountInput.value = "";
  noteInput.value = "";
  resetDailyDateToToday();

  if (date >= toDateStr(currentMonth) && date < toDateStr(monthEndExclusive(currentMonth))) {
    dailyExpenses.unshift(data);
    dailyExpenses.sort((a, b) => (a.date < b.date ? 1 : -1));
    allDailyExpenses.unshift(data);
    renderDailyList();
    renderCategoryBreakdown();
    // Daily spending draws down allowances, so the fixed rows' "x of y used"
    // is stale until it's redrawn as well.
    renderFixedList();
    renderBudgets();
    renderQuickAdd();
    renderSummary();
  }
  if (receiptOk) toast(receiptFile ? "Expense added with receipt" : "Expense added");
});

async function deleteDailyExpense(id) {
  // Read the path before the row goes, or there's nothing left to clean up.
  const receiptPath = (allDailyExpenses.find((d) => d.id === id) || {}).receipt_path;
  const { error } = await sb.from("daily_expenses").delete().eq("id", id);
  if (error) { console.error(error); toast("Failed to delete"); return; }
  await deleteReceipt(receiptPath);
  dailyExpenses = dailyExpenses.filter((d) => d.id !== id);
  // The wide slice feeds the trend chart, the week-over-week insight and the
  // quick-add suggestions, so it has to lose the row too — otherwise a deleted
  // expense keeps influencing all three until the next reload.
  allDailyExpenses = allDailyExpenses.filter((d) => d.id !== id);
  renderDailyList();
  renderCategoryBreakdown();
  renderFixedList();
  renderBudgets();
  renderQuickAdd();
  renderSummary();
}

function renderDailyList() {
  const ul = document.getElementById("daily-list");
  ul.innerHTML = "";
  if (dailyExpenses.length === 0) {
    ul.innerHTML = '<li class="empty-state">No expenses logged this month.</li>';
    return;
  }
  for (const d of dailyExpenses) {
    const li = document.createElement("li");
    const dateLabel = new Date(d.date + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" });
    const describe = d.category + " " + fmt(d.amount) + " on " + dateLabel;
    li.innerHTML = `
      <div class="item-main">
        <span class="item-title">${escapeHtml(d.category)}</span>
        <span class="item-sub">${dateLabel}${d.note ? " · " + escapeHtml(d.note) : ""}</span>
      </div>
      <span class="item-amount">${fmt(d.amount)}</span>
      ${rowActions(describe, receiptButton(d, describe))}
    `;
    wireReceiptButton(li, d);
    li.querySelector(".delete-btn").addEventListener("click", () => deleteDailyExpense(d.id));
    attachEdit(li, d, [
      { key: "date", type: "date", required: true },
      { key: "category", type: "select", options: CATEGORIES },
      { key: "amount", type: "number", required: true },
      { key: "note", type: "text", placeholder: "Note (optional)", nullable: true },
    ], "daily_expenses", renderDailyList);
    ul.appendChild(li);
  }
}

function renderCategoryBreakdown() {
  const el = document.getElementById("category-breakdown");
  el.innerHTML = "";
  if (dailyExpenses.length === 0) return;

  const totals = {};
  for (const d of dailyExpenses) totals[d.category] = (totals[d.category] || 0) + Number(d.amount);
  const max = Math.max(...Object.values(totals));

  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  for (const [cat, amt] of sorted) {
    const row = document.createElement("div");
    row.className = "cat-row";
    row.innerHTML = `
      <span class="cat-name">${escapeHtml(cat)}</span>
      <span class="cat-bar-track"><span class="cat-bar-fill" style="width:${(amt / max) * 100}%"></span></span>
      <span class="cat-amount">${fmt(amt)}</span>
    `;
    el.appendChild(row);
  }
}

// ---------- Trend chart ----------
// Totals per month across the trend window. Spending counts everything that
// leaves the account: daily + fixed + family maintenance.
function buildTrend() {
  const months = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const m = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - i, 1);
    const start = toDateStr(m);
    const end = toDateStr(monthEndExclusive(m));
    const mKey = monthKey(m);

    const income = allSalaryPayments
      .filter((p) => p.date >= start && p.date < end)
      .reduce((s, p) => s + Number(p.amount), 0);
    const daily = allDailyExpenses
      .filter((d) => d.date >= start && d.date < end)
      .reduce((s, d) => s + Number(d.amount), 0);
    const fixed = allFixedRows
      .filter((f) => f.month === mKey)
      .reduce((s, f) => s + Number(f.amount), 0);
    const monthRow = allMonthlyRows.find((r) => r.month === mKey);
    const family = monthRow ? Number(monthRow.family_maintenance) : 0;
    // Paying someone back is real money leaving in that month, and Remaining
    // already treats it that way. Leaving it out here would make a month where
    // you cleared a big IOU look cheaper than it was.
    const repaid = personalDebts
      .filter((d) => d.repaid && d.repaid_on && d.repaid_on >= start && d.repaid_on < end)
      .reduce((s, d) => s + Number(d.amount), 0);

    months.push({
      label: m.toLocaleDateString("en-AU", { month: "short" }),
      income,
      spending: daily + fixed + family + repaid,
    });
  }
  return months;
}

function renderTrend() {
  const months = buildTrend();
  const chart = document.getElementById("trend-chart");
  const empty = document.getElementById("trend-empty");
  const max = Math.max(...months.map((m) => Math.max(m.income, m.spending)));

  if (max <= 0) {
    chart.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const W = 660;
  const H = 220;
  const bottom = 34;      // room for month labels
  const top = 18;         // room for the tallest bar
  const plot = H - top - bottom;
  const groupW = W / months.length;
  const barW = Math.min(30, groupW / 3);
  const gap = 6;

  let bars = "";
  months.forEach((m, i) => {
    const cx = i * groupW + groupW / 2;
    const incomeH = (m.income / max) * plot;
    const spendH = (m.spending / max) * plot;
    const incomeX = cx - barW - gap / 2;
    const spendX = cx + gap / 2;

    bars += `
      <rect class="trend-bar-income" x="${incomeX}" y="${top + plot - incomeH}" width="${barW}" height="${incomeH}" rx="4">
        <title>${m.label} income: ${fmt(m.income)}</title>
      </rect>
      <rect class="trend-bar-spending" x="${spendX}" y="${top + plot - spendH}" width="${barW}" height="${spendH}" rx="4">
        <title>${m.label} spending: ${fmt(m.spending)}</title>
      </rect>
      <text class="trend-label" x="${cx}" y="${H - 12}" text-anchor="middle">${m.label}</text>
    `;
  });

  // The <title> tooltips only surface on hover, so the chart also gets a
  // plain-text equivalent for screen readers (and anyone not using a mouse).
  const readout = months
    .map((m) => `<li>${m.label}: income ${fmt(m.income)}, spending ${fmt(m.spending)}</li>`)
    .join("");

  chart.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Income versus spending for the last ${months.length} months">
      <line class="trend-axis" x1="0" y1="${top + plot}" x2="${W}" y2="${top + plot}" />
      ${bars}
    </svg>
    <ul class="sr-only">${readout}</ul>
  `;
}

// ---------- Category budgets ----------
function budgetFor(category) {
  const row = categoryBudgets.find((b) => b.category === category);
  return row ? Number(row.amount) : 0;
}

function spentByCategoryThisMonth() {
  const totals = {};
  for (const d of dailyExpenses) {
    totals[d.category] = (totals[d.category] || 0) + Number(d.amount);
  }
  return totals;
}

async function saveBudget(category, value) {
  const amount = parseFloat(value) || 0;
  const { data, error } = await sb.from("category_budgets")
    .upsert(
      { user_id: currentUser.id, category, amount, updated_at: new Date().toISOString() },
      { onConflict: "user_id,category" }
    )
    .select().single();
  if (error) { console.error(error); toast("Failed to save budget"); return; }

  const existing = categoryBudgets.findIndex((b) => b.category === category);
  if (existing >= 0) categoryBudgets[existing] = data;
  else categoryBudgets.push(data);

  renderBudgets();
  renderSummary();
}

const budgetTimers = {};

function renderBudgets() {
  const ul = document.getElementById("budget-list");
  const spent = spentByCategoryThisMonth();
  ul.innerHTML = "";

  if (budgetsUnavailable) {
    document.getElementById("suggest-budgets-btn").hidden = true;
    ul.innerHTML = '<li class="empty-state">Budgets need one more setup step — run migration_category_budgets.sql in Supabase.</li>';
    return;
  }
  document.getElementById("suggest-budgets-btn").hidden = false;

  for (const cat of CATEGORIES) {
    const budget = budgetFor(cat);
    const used = spent[cat] || 0;
    const pct = budget > 0 ? Math.min(100, (used / budget) * 100) : 0;
    const over = budget > 0 && used > budget;
    const near = budget > 0 && !over && used >= budget * 0.8;

    const li = document.createElement("li");
    li.className = "budget-row";
    li.innerHTML = `
      <div class="budget-head">
        <span class="budget-name">${escapeHtml(cat)}</span>
        <span class="budget-figures ${over ? "negative" : ""}">${fmt(used)}${budget > 0 ? " / " + fmt(budget) : ""}${
          over ? '<span class="sr-only"> — over budget</span>'
               : near ? '<span class="sr-only"> — close to the limit</span>' : ""
        }</span>
        <input class="budget-input" type="number" inputmode="decimal" step="0.01" min="0"
               placeholder="No limit" aria-label="${escapeAttr(cat)} monthly budget"
               value="${budget > 0 ? budget : ""}" />
      </div>
      ${budget > 0 ? `<div class="budget-track" aria-hidden="true"><div class="budget-fill ${over ? "is-over" : near ? "is-near" : ""}" style="width:${pct}%"></div></div>` : ""}
    `;

    const input = li.querySelector(".budget-input");
    input.addEventListener("input", (e) => {
      clearTimeout(budgetTimers[cat]);
      budgetTimers[cat] = setTimeout(() => saveBudget(cat, e.target.value), 600);
    });

    ul.appendChild(li);
  }
}

// Suggests a cap per category from the user's own history: the leanest month
// they actually achieved (ignoring months with no spend in that category), so
// the target is something already proven doable rather than an invented number.
// If the suggestions together exceed what's actually available after fixed
// costs, they're scaled down proportionally to fit.
function suggestBudgets() {
  const perCategory = {};
  const monthsBack = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    monthsBack.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - i, 1));
  }

  for (const cat of CATEGORIES) {
    const monthlyTotals = monthsBack.map((m) => {
      const start = toDateStr(m);
      const end = toDateStr(monthEndExclusive(m));
      return allDailyExpenses
        .filter((d) => d.category === cat && d.date >= start && d.date < end)
        .reduce((s, d) => s + Number(d.amount), 0);
    }).filter((total) => total > 0);

    if (monthlyTotals.length === 0) continue; // no history — leave it unset
    perCategory[cat] = Math.min(...monthlyTotals);
  }

  const suggestedTotal = Object.values(perCategory).reduce((s, v) => s + v, 0);
  if (suggestedTotal === 0) return { perCategory, scaled: false };

  const income = salaryPayments.reduce((s, p) => s + Number(p.amount), 0);
  const family = monthlyRow ? Number(monthlyRow.family_maintenance) : 0;
  // Full commitments here, not the reserved figure: a suggestion baseline
  // shouldn't drift as the month's spending happens to land.
  const fixedTotal = fixedCommitted();
  const available = income - family - fixedTotal;

  let scaled = false;
  if (available > 0 && suggestedTotal > available) {
    const factor = available / suggestedTotal;
    for (const cat of Object.keys(perCategory)) perCategory[cat] *= factor;
    scaled = true;
  }

  for (const cat of Object.keys(perCategory)) {
    perCategory[cat] = Math.max(1, Math.round(perCategory[cat]));
  }
  return { perCategory, scaled };
}

document.getElementById("suggest-budgets-btn").addEventListener("click", async () => {
  const btn = document.getElementById("suggest-budgets-btn");
  const { perCategory, scaled } = suggestBudgets();
  const cats = Object.keys(perCategory);

  if (cats.length === 0) {
    toast("Not enough spending history yet");
    return;
  }
  if (categoryBudgets.some((b) => Number(b.amount) > 0)) {
    if (!window.confirm("This replaces your current budgets with amounts worked out from your last " + TREND_MONTHS + " months. Continue?")) return;
  }

  btn.disabled = true;
  try {
    const rows = cats.map((cat) => ({
      user_id: currentUser.id,
      category: cat,
      amount: perCategory[cat],
      updated_at: new Date().toISOString(),
    }));
    const { data, error } = await sb.from("category_budgets")
      .upsert(rows, { onConflict: "user_id,category" })
      .select();
    if (error) throw error;

    for (const row of data) {
      const i = categoryBudgets.findIndex((b) => b.category === row.category);
      if (i >= 0) categoryBudgets[i] = row;
      else categoryBudgets.push(row);
    }
    renderBudgets();
    renderSummary();
    toast(scaled ? "Budgets set and trimmed to fit your income" : "Budgets set from your history");
  } catch (err) {
    console.error(err);
    toast("Couldn't set budgets");
  } finally {
    btn.disabled = false;
  }
});

// ---------- Summary ----------
function renderSummary() {
  const salary = salaryPayments.reduce((s, p) => s + Number(p.amount), 0);
  const family = monthlyRow ? Number(monthlyRow.family_maintenance) : 0;
  // Reserved rather than committed, so an allowance already partly spent isn't
  // deducted twice. The Fixed card therefore shows money still held back, and
  // Fixed + Daily always adds up to what Remaining actually subtracts.
  const fixedTotal = fixedReserved();
  const dailyTotal = dailyExpenses.reduce((s, d) => s + Number(d.amount), 0);
  const netSavings = savingsThisMonth().reduce((s, t) => s + signedAmount(t), 0);
  // Money handed back to someone this month. An IOU still outstanding costs
  // nothing yet, so only what's actually been repaid lands here.
  const repaid = repaidThisMonth();
  const remaining = salary - family - fixedTotal - dailyTotal - netSavings - repaid;

  document.getElementById("sum-salary").textContent = fmt(salary);
  document.getElementById("sum-fixed").textContent = fmt(fixedTotal);
  document.getElementById("sum-family").textContent = fmt(family);
  document.getElementById("sum-daily").textContent = fmt(dailyTotal);
  document.getElementById("sum-savings").textContent = fmt(netSavings);
  // Hidden at zero: a tile reading $0 every month for something most months
  // don't involve is just noise in the grid.
  document.getElementById("sum-repaid").textContent = fmt(repaid);
  document.getElementById("sum-repaid-card").hidden = repaid <= 0;

  const remainingEl = document.getElementById("sum-remaining");
  remainingEl.textContent = fmt(remaining);
  remainingEl.classList.toggle("negative", remaining < 0);

  renderTodaySummary();
  renderInsights();
}

// ---------- Insights ----------
function daysInMonth(d) {
  return Math.round((monthEndExclusive(d) - firstOfMonth(d)) / 86400000);
}

function renderInsights() {
  const insights = generateInsights();
  const card = document.getElementById("insights-card");
  const list = document.getElementById("insights-list");

  if (insights.length === 0) {
    card.hidden = true;
    return;
  }

  list.innerHTML = "";
  for (const insight of insights) {
    const li = document.createElement("li");
    li.className = "insight-item insight-" + insight.tone;
    li.innerHTML = `<span class="insight-icon">${insight.icon}</span><span>${insight.text}</span>`;
    list.appendChild(li);
  }
  card.hidden = false;
}

function generateInsights() {
  const insights = [];

  const salary = salaryPayments.reduce((s, p) => s + Number(p.amount), 0);
  const family = monthlyRow ? Number(monthlyRow.family_maintenance) : 0;
  const fixedTotal = fixedReserved();
  const dailyTotal = dailyExpenses.reduce((s, d) => s + Number(d.amount), 0);
  const netSavings = savingsThisMonth().reduce((s, t) => s + signedAmount(t), 0);
  const remaining = salary - family - fixedTotal - dailyTotal - netSavings;
  const budgetForDaily = salary - family - fixedTotal - netSavings;

  const today = new Date();
  const viewingCurrentMonth = today.getFullYear() === currentMonth.getFullYear() && today.getMonth() === currentMonth.getMonth();
  const totalDays = daysInMonth(currentMonth);
  const daysElapsed = viewingCurrentMonth ? today.getDate() : (currentMonth < firstOfMonth(today) ? totalDays : 0);
  const daysRemaining = totalDays - daysElapsed;

  // 1. Already over budget — highest priority.
  if (remaining < 0 && salary > 0) {
    insights.push({
      tone: "warning",
      icon: "⚠️",
      text: `You're ${fmt(Math.abs(remaining))} over budget for ${monthLabel(currentMonth)} already.`,
    });
  }

  // 2. Spending pace vs budget for the rest of the month.
  if (viewingCurrentMonth && daysElapsed > 0 && dailyTotal > 0 && budgetForDaily > 0) {
    const avgPerDay = dailyTotal / daysElapsed;
    const projectedTotal = avgPerDay * totalDays;
    if (projectedTotal > budgetForDaily) {
      insights.push({
        tone: "warning",
        icon: "📈",
        text: `At your current pace (~${fmt(avgPerDay)}/day), you're on track to spend ${fmt(projectedTotal)} on daily expenses this month — about ${fmt(projectedTotal - budgetForDaily)} over budget.`,
      });
    } else if (daysRemaining > 0) {
      const suggestedPerDay = (budgetForDaily - dailyTotal) / daysRemaining;
      insights.push({
        tone: "positive",
        icon: "✅",
        text: `You're on track — keep daily spending under ~${fmt(suggestedPerDay)}/day for the rest of the month to stay within budget.`,
      });
    }
  }

  // 3. Biggest category spike vs the same point last month.
  const cutoffDay = viewingCurrentMonth ? daysElapsed : totalDays;
  const currentByCategory = {};
  for (const d of dailyExpenses) currentByCategory[d.category] = (currentByCategory[d.category] || 0) + Number(d.amount);

  const prevByCategory = {};
  for (const d of prevMonthDailyExpenses) {
    const day = Number(d.date.slice(8, 10));
    if (day <= cutoffDay) prevByCategory[d.category] = (prevByCategory[d.category] || 0) + Number(d.amount);
  }

  let biggestSpike = null;
  for (const cat of Object.keys(currentByCategory)) {
    const cur = currentByCategory[cat];
    const prev = prevByCategory[cat] || 0;
    if (prev < 20) continue; // avoid noise from tiny/one-off prior spend
    const pctChange = ((cur - prev) / prev) * 100;
    if (pctChange > 20 && (!biggestSpike || pctChange > biggestSpike.pctChange)) {
      biggestSpike = { cat, cur, prev, pctChange };
    }
  }
  if (biggestSpike) {
    insights.push({
      tone: "warning",
      icon: "🔎",
      text: `${biggestSpike.cat} spending is up ${Math.round(biggestSpike.pctChange)}% vs this point last month (${fmt(biggestSpike.cur)} vs ${fmt(biggestSpike.prev)}).`,
    });
  }

  // 3b. Categories against their budget — over first, then close to the line.
  const budgetBreaches = [];
  for (const cat of CATEGORIES) {
    const budget = budgetFor(cat);
    if (budget <= 0) continue;
    const used = currentByCategory[cat] || 0;
    if (used > budget) {
      budgetBreaches.push({ cat, used, budget, over: true, amount: used - budget });
    } else if (used >= budget * 0.8) {
      budgetBreaches.push({ cat, used, budget, over: false, amount: budget - used });
    }
  }
  budgetBreaches.sort((a, b) => (b.over ? 1 : 0) - (a.over ? 1 : 0) || b.amount - a.amount);
  if (budgetBreaches.length > 0) {
    const b = budgetBreaches[0];
    insights.push(b.over
      ? {
          tone: "warning",
          icon: "🎯",
          text: `${b.cat} is ${fmt(b.amount)} over its ${fmt(b.budget)} budget this month.`,
        }
      : {
          tone: "info",
          icon: "🎯",
          text: `${b.cat} is close to its budget — ${fmt(b.amount)} left of ${fmt(b.budget)}.`,
        });
  }

  // 4. Biggest category this month, if it clearly dominates.
  const catEntries = Object.entries(currentByCategory).sort((a, b) => b[1] - a[1]);
  if (catEntries.length > 0 && dailyTotal > 0) {
    const [topCat, topAmt] = catEntries[0];
    const share = (topAmt / dailyTotal) * 100;
    if (share >= 35) {
      insights.push({
        tone: "info",
        icon: "🏷️",
        text: `${topCat} is your biggest expense category this month at ${fmt(topAmt)} (${Math.round(share)}% of daily spending).`,
      });
    }
  }

  // 5. Fixed + family commitments vs salary.
  if (salary > 0) {
    // Full commitments, not the reserved figure — this is about how much of
    // the salary is spoken for, which shouldn't shrink just because some of an
    // allowance has now been spent.
    const committedShare = ((family + fixedCommitted()) / salary) * 100;
    if (committedShare >= 60) {
      insights.push({
        tone: "info",
        icon: "🔒",
        text: `Fixed expenses and family maintenance take up ${Math.round(committedShare)}% of your salary this month.`,
      });
    }
  }

  // 6. Money still owed back to you. Ranked near the top because it's the one
  // thing here that needs an action from someone else, and it's easy to forget.
  const owedWork = owedOutstanding("work");
  const owedRoommate = owedOutstanding("roommate");
  if (owedWork > 0) {
    const count = owedItems("work").filter((r) => !r.settled).length;
    insights.unshift({
      tone: "info",
      icon: "🧾",
      text: `${fmt(owedWork)} of work purchases still to claim back (${count} item${count === 1 ? "" : "s"}).`,
    });
  }
  if (owedRoommate > 0) {
    const count = owedItems("roommate").filter((r) => !r.settled).length;
    insights.unshift({
      tone: "info",
      icon: "🤝",
      text: `Your roommate still owes you ${fmt(owedRoommate)} across ${count} item${count === 1 ? "" : "s"}.`,
    });
  }

  // 7. Three-pay months. Fortnightly pay means 26 pays a year, not 24, so two
  // months each year carry a third payday. Budgeting as though every month has
  // two makes that third one a genuine windfall — but only if it's noticed
  // before it gets absorbed into ordinary spending.
  const anchor = payAnchorDate();
  if (anchor) {
    const payDates = payDatesInMonth(currentMonth, anchor);
    if (payDates.length >= 3) {
      const third = payDates[2].toLocaleDateString("en-AU", { day: "numeric", month: "short" });
      const typicalPay = salaryPayments.length
        ? salaryPayments.reduce((s, p) => s + Number(p.amount), 0) / salaryPayments.length
        : 0;
      insights.unshift({
        tone: "positive",
        icon: "🎁",
        text: typicalPay > 0
          ? `${monthLabel(currentMonth)} has three paydays (the third lands ${third}) — roughly ${fmt(typicalPay)} more than a normal month. A good month to save the extra.`
          : `${monthLabel(currentMonth)} has three paydays (the third lands ${third}) — a good month to save the extra.`,
      });
    }
  }

  // 8. Unpaid commitments, but only late in the month. Flagging them from the
  // 1st would just be noise — they're not overdue, they're simply not due yet.
  if (viewingCurrentMonth) {
    const outstanding = unpaidCommitments();
    const daysToMonthEnd = totalDays - daysElapsed;
    if (outstanding > 0 && daysToMonthEnd <= 7) {
      insights.unshift({
        tone: "warning",
        icon: "📌",
        text: `${fmt(outstanding)} of fixed costs and family maintenance still isn't ticked off, with ${daysToMonthEnd} day${daysToMonthEnd === 1 ? "" : "s"} left in the month.`,
      });
    }
  }

  // ---- Real-time rules: about today and the days just gone, not the month
  // in hindsight. These are ranked highest because they're the ones that can
  // still change a decision you're about to make.

  // 9. A category budget that won't last the month at the current rate. The
  // date it runs dry is more use than the balance on its own.
  if (viewingCurrentMonth && daysElapsed >= 3 && daysRemaining > 0) {
    let soonest = null;
    for (const cat of CATEGORIES) {
      // An allowance (a fixed expense named after the category) takes
      // precedence over a plain cap, since it's real reserved money.
      const cap = budgetFixedFor(cat) || budgetFor(cat);
      if (cap <= 0) continue;
      const spent = spentInCategory(cat);
      const left = cap - spent;
      if (left <= 0) continue; // already over — rule 5 covers that
      const perDay = spent / daysElapsed;
      if (perDay <= 0) continue;
      const daysOfCover = left / perDay;
      if (daysOfCover >= daysRemaining) continue; // it'll last, no need to say so
      if (!soonest || daysOfCover < soonest.daysOfCover) {
        soonest = { cat, left, perDay, daysOfCover };
      }
    }
    if (soonest) {
      const runOut = addDays(today, Math.floor(soonest.daysOfCover));
      const safePerDay = soonest.left / daysRemaining;
      insights.unshift({
        tone: "warning",
        icon: "⏳",
        text: `${soonest.cat} runs out around ${runOut.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} at ${fmt(soonest.perDay)}/day. ${fmt(soonest.left)} left — about ${fmt(safePerDay)}/day to reach month end.`,
      });
    }
  }

  // 10. Today standing out against a normal day. Compared against the days
  // before today, so a big purchase isn't diluted by its own inclusion.
  if (viewingCurrentMonth && daysElapsed >= 4) {
    const todayStr = toDateStr(today);
    const todaySpent = dailyExpenses
      .filter((d) => d.date === todayStr)
      .reduce((s, d) => s + Number(d.amount), 0);
    const priorDays = daysElapsed - 1;
    const priorAvg = priorDays > 0 ? (dailyTotal - todaySpent) / priorDays : 0;
    if (todaySpent > 0 && priorAvg > 0 && todaySpent >= priorAvg * 2) {
      insights.unshift({
        tone: "warning",
        icon: "📍",
        text: `${fmt(todaySpent)} spent today — about ${(todaySpent / priorAvg).toFixed(1)}× your usual ${fmt(priorAvg)} a day.`,
      });
    }
  }

  // 11. The last seven days against the seven before. A shorter horizon than
  // month-vs-month, so a change in habit shows up while it still matters.
  if (viewingCurrentMonth) {
    const inRange = (from, to) => allDailyExpenses
      .filter((d) => d.date >= toDateStr(from) && d.date < toDateStr(to))
      .reduce((s, d) => s + Number(d.amount), 0);
    const tomorrow = addDays(today, 1);
    const thisWeek = inRange(addDays(tomorrow, -7), tomorrow);
    const weekBefore = inRange(addDays(tomorrow, -14), addDays(tomorrow, -7));

    if (weekBefore >= 20 && thisWeek > 0) {
      const change = ((thisWeek - weekBefore) / weekBefore) * 100;
      if (change >= 25) {
        insights.push({
          tone: "warning",
          icon: "📈",
          text: `${fmt(thisWeek)} in the last 7 days, up ${Math.round(change)}% on the 7 before (${fmt(weekBefore)}).`,
        });
      } else if (change <= -25) {
        insights.push({
          tone: "positive",
          icon: "📉",
          text: `${fmt(thisWeek)} in the last 7 days, down ${Math.round(-change)}% on the 7 before (${fmt(weekBefore)}).`,
        });
      }
    }
  }

  // 12. Payday has been and gone without the pay being logged. Everything else
  // in the app is derived from salary payments, so a missed one quietly
  // distorts the whole month — this is ranked top for that reason.
  if (viewingCurrentMonth) {
    const anchor = payAnchorDate();
    if (anchor) {
      const { start } = cycleContaining(today, anchor);
      const daysSincePayday = Math.floor((today - start) / 86400000);
      const loggedThisCycle = allSalaryPayments.some(
        (p) => p.date >= toDateStr(start) && p.date <= toDateStr(today)
      );
      // A day's grace: pay often lands late in the day.
      if (!loggedThisCycle && daysSincePayday >= 1 && daysSincePayday <= 6) {
        insights.unshift({
          tone: "warning",
          icon: "💰",
          text: `Payday was ${start.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" })} and no pay is logged yet — the month's figures will be off until it is.`,
        });
      }
    }
  }

  return insights.slice(0, 6);
}

// ---------- Today's spending (auto-resets at midnight since it's date-filtered) ----------
let lastCheckedDate = toDateStr(new Date());

function renderTodaySummary() {
  const todayCard = document.getElementById("today-card");
  const todayStr = toDateStr(new Date());

  if (todayStr < toDateStr(currentMonth) || todayStr >= toDateStr(monthEndExclusive(currentMonth))) {
    todayCard.hidden = true;
    return;
  }

  const todayTotal = dailyExpenses
    .filter((d) => d.date === todayStr)
    .reduce((s, d) => s + Number(d.amount), 0);

  document.getElementById("sum-today").textContent = fmt(todayTotal);
  todayCard.hidden = false;
}

setInterval(() => {
  const nowStr = toDateStr(new Date());
  if (nowStr === lastCheckedDate) return;
  lastCheckedDate = nowStr;
  renderTodaySummary();
  // Roll the entry date over too, so an app left open overnight doesn't file
  // tomorrow's expenses under yesterday. A manual override is left alone.
  if (!dailyDateManual) resetDailyDateToToday();
}, 60000);

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- CSV export ----------
// Exports everything, not just the visible month — the point is a backup you
// can keep outside Supabase.
function csvCell(value) {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

document.getElementById("export-btn").addEventListener("click", async () => {
  const btn = document.getElementById("export-btn");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const results = await Promise.all([
      sb.from("salary_payments").select("*").eq("user_id", currentUser.id).order("date"),
      sb.from("monthly_data").select("*").eq("user_id", currentUser.id).order("month"),
      sb.from("fixed_expenses").select("*").eq("user_id", currentUser.id).order("month"),
      sb.from("daily_expenses").select("*").eq("user_id", currentUser.id).order("date"),
      sb.from("savings_transactions").select("*").eq("user_id", currentUser.id).order("date"),
      sb.from("personal_debts").select("*").eq("user_id", currentUser.id).order("date"),
    ]);
    // The money-you-owe table may not be migrated yet, and an export that
    // fails wholesale over a table you aren't using would be worse than one
    // that leaves it out.
    const failed = results.slice(0, 5).find((r) => r.error);
    if (failed) throw failed.error;

    const [salary, monthly, fixed, daily, savings, owing] = results;
    const rows = [["Type", "Date", "Detail", "Amount", "Note"]];
    for (const r of salary.data) rows.push(["Salary", r.date, "", r.amount, r.note]);
    for (const r of monthly.data) rows.push(["Family maintenance", r.month, "", r.family_maintenance, ""]);
    for (const r of fixed.data) rows.push(["Fixed expense", r.month, r.name, r.amount, ""]);
    for (const r of daily.data) rows.push(["Daily expense", r.date, r.category, r.amount, r.note]);
    for (const r of savings.data) {
      rows.push(["Savings", r.date, r.type === "deposit" ? "Put in" : "Taken out", r.amount, r.note]);
    }
    for (const r of (owing.data || [])) {
      // The repaid date, not the borrowed date, is the one that carries a cost,
      // so it belongs in the export rather than a bare "paid back".
      const status = r.repaid ? "Paid back" + (r.repaid_on ? " " + r.repaid_on : "") : "Still owed";
      rows.push(["Money I owe", r.date, r.person, r.amount, r.description + " — " + status]);
    }

    const csv = rows.map((cells) => cells.map(csvCell).join(",")).join("\r\n");
    // Leading BOM so Excel opens it as UTF-8 rather than mangling characters.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "expense-tracker-" + toDateStr(new Date()) + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast("Exported " + (rows.length - 1) + " rows");
  } catch (err) {
    console.error(err);
    toast("Export failed");
  } finally {
    btn.disabled = false;
  }
});

// ---------- Init ----------
(async function init() {
  const { data } = await sb.auth.getSession();
  if (!data.session || !data.session.user) {
    window.location.href = "index.html";
    return;
  }
  // Locked, or idle for too long since this tab was last used (e.g. the phone
  // was put down and picked up an hour later) — bounce to the PIN screen.
  if (localStorage.getItem(LOCK_KEY) === "1") {
    window.location.href = "index.html";
    return;
  }
  const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0);
  if (last && Date.now() - last > LOCK_AFTER_MS) {
    lockNow();
    return;
  }

  markActivity();
  currentUser = data.session.user;
  startApp();
})();
