// ---------- Setup ----------
const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const CATEGORIES = ["Food", "Groceries", "Transport", "Shopping", "Bills", "Health", "Entertainment", "Other"];

const currencyFmt = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
function fmt(n) { return currencyFmt.format(n || 0); }

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2500);
}

// ---------- State ----------
let currentUser = null;
let currentMonth = firstOfMonth(new Date());
let monthlyRow = null; // { id, salary, family_maintenance } or null
let fixedExpenses = [];
let dailyExpenses = [];

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
  await sb.auth.signOut();
  window.location.href = "index.html";
});

sb.auth.onAuthStateChange((_event, session) => {
  if (!session || !session.user) {
    window.location.href = "index.html";
  }
});

function startApp() {
  document.getElementById("user-email").textContent = currentUser.email;
  document.getElementById("daily-date").value = toDateStr(new Date());
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

// ---------- Data loading ----------
async function loadMonth() {
  document.getElementById("month-label").textContent = monthLabel(currentMonth);
  const key = monthKey(currentMonth);

  const [monthlyRes, fixedRes, dailyRes] = await Promise.all([
    sb.from("monthly_data").select("*").eq("user_id", currentUser.id).eq("month", key).maybeSingle(),
    sb.from("fixed_expenses").select("*").eq("user_id", currentUser.id).eq("month", key).order("created_at"),
    sb.from("daily_expenses").select("*").eq("user_id", currentUser.id)
      .gte("date", toDateStr(currentMonth)).lt("date", toDateStr(monthEndExclusive(currentMonth)))
      .order("date", { ascending: false }),
  ]);

  if (monthlyRes.error) console.error(monthlyRes.error);
  if (fixedRes.error) console.error(fixedRes.error);
  if (dailyRes.error) console.error(dailyRes.error);

  monthlyRow = monthlyRes.data || null;
  fixedExpenses = fixedRes.data || [];
  dailyExpenses = dailyRes.data || [];

  document.getElementById("input-salary").value = monthlyRow ? monthlyRow.salary : "";
  document.getElementById("input-family").value = monthlyRow ? monthlyRow.family_maintenance : "";

  document.getElementById("copy-prompt").hidden = !!monthlyRow;

  renderFixedList();
  renderDailyList();
  renderCategoryBreakdown();
  renderSummary();
}

// ---------- Monthly setup: salary / family maintenance ----------
async function ensureMonthlyRow() {
  if (monthlyRow) return monthlyRow;
  const key = monthKey(currentMonth);
  const { data, error } = await sb.from("monthly_data")
    .insert({ user_id: currentUser.id, month: key, salary: 0, family_maintenance: 0 })
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
  renderSummary();
}

let salaryTimer, familyTimer;
document.getElementById("input-salary").addEventListener("input", (e) => {
  clearTimeout(salaryTimer);
  salaryTimer = setTimeout(() => saveField("salary", e.target.value), 500);
});
document.getElementById("input-family").addEventListener("input", (e) => {
  clearTimeout(familyTimer);
  familyTimer = setTimeout(() => saveField("family_maintenance", e.target.value), 500);
});

// ---------- Fixed expenses ----------
document.getElementById("fixed-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("fixed-name");
  const amountInput = document.getElementById("fixed-amount");
  const name = nameInput.value.trim();
  const amount = parseFloat(amountInput.value);
  if (!name || isNaN(amount)) return;

  await ensureMonthlyRow();
  const key = monthKey(currentMonth);
  const { data, error } = await sb.from("fixed_expenses")
    .insert({ user_id: currentUser.id, month: key, name, amount })
    .select().single();
  if (error) { console.error(error); toast("Failed to add"); return; }

  fixedExpenses.push(data);
  nameInput.value = "";
  amountInput.value = "";
  renderFixedList();
  renderSummary();
});

async function deleteFixedExpense(id) {
  const { error } = await sb.from("fixed_expenses").delete().eq("id", id);
  if (error) { console.error(error); toast("Failed to delete"); return; }
  fixedExpenses = fixedExpenses.filter((f) => f.id !== id);
  renderFixedList();
  renderSummary();
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
    li.innerHTML = `
      <div class="item-main"><span class="item-title">${escapeHtml(f.name)}</span></div>
      <span class="item-amount">${fmt(f.amount)}</span>
      <button class="delete-btn" aria-label="Delete">✕</button>
    `;
    li.querySelector(".delete-btn").addEventListener("click", () => deleteFixedExpense(f.id));
    ul.appendChild(li);
  }
}

// ---------- Copy from previous month ----------
document.getElementById("copy-prev-btn").addEventListener("click", async () => {
  const prevMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
  const prevKey = monthKey(prevMonth);

  const [prevMonthlyRes, prevFixedRes] = await Promise.all([
    sb.from("monthly_data").select("*").eq("user_id", currentUser.id).eq("month", prevKey).maybeSingle(),
    sb.from("fixed_expenses").select("*").eq("user_id", currentUser.id).eq("month", prevKey),
  ]);

  const key = monthKey(currentMonth);
  const salary = prevMonthlyRes.data ? prevMonthlyRes.data.salary : 0;
  const family = prevMonthlyRes.data ? prevMonthlyRes.data.family_maintenance : 0;

  const { data: newRow, error } = await sb.from("monthly_data")
    .insert({ user_id: currentUser.id, month: key, salary, family_maintenance: family })
    .select().single();
  if (error) { console.error(error); toast("Failed to copy"); return; }
  monthlyRow = newRow;

  const prevFixed = prevFixedRes.data || [];
  if (prevFixed.length > 0) {
    const inserts = prevFixed.map((f) => ({ user_id: currentUser.id, month: key, name: f.name, amount: f.amount }));
    const { data: newFixed, error: fixedErr } = await sb.from("fixed_expenses").insert(inserts).select();
    if (fixedErr) console.error(fixedErr);
    fixedExpenses = newFixed || [];
  }

  document.getElementById("input-salary").value = salary;
  document.getElementById("input-family").value = family;
  document.getElementById("copy-prompt").hidden = true;
  renderFixedList();
  renderSummary();
  toast("Copied from previous month");
});

// ---------- Daily expenses ----------
document.getElementById("daily-form").addEventListener("submit", async (e) => {
  e.preventDefault();
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

  amountInput.value = "";
  noteInput.value = "";

  if (date >= toDateStr(currentMonth) && date < toDateStr(monthEndExclusive(currentMonth))) {
    dailyExpenses.unshift(data);
    dailyExpenses.sort((a, b) => (a.date < b.date ? 1 : -1));
    renderDailyList();
    renderCategoryBreakdown();
    renderSummary();
  }
  toast("Expense added");
});

async function deleteDailyExpense(id) {
  const { error } = await sb.from("daily_expenses").delete().eq("id", id);
  if (error) { console.error(error); toast("Failed to delete"); return; }
  dailyExpenses = dailyExpenses.filter((d) => d.id !== id);
  renderDailyList();
  renderCategoryBreakdown();
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
    li.innerHTML = `
      <div class="item-main">
        <span class="item-title">${escapeHtml(d.category)}</span>
        <span class="item-sub">${dateLabel}${d.note ? " · " + escapeHtml(d.note) : ""}</span>
      </div>
      <span class="item-amount">${fmt(d.amount)}</span>
      <button class="delete-btn" aria-label="Delete">✕</button>
    `;
    li.querySelector(".delete-btn").addEventListener("click", () => deleteDailyExpense(d.id));
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

// ---------- Summary ----------
function renderSummary() {
  const salary = monthlyRow ? Number(monthlyRow.salary) : 0;
  const family = monthlyRow ? Number(monthlyRow.family_maintenance) : 0;
  const fixedTotal = fixedExpenses.reduce((s, f) => s + Number(f.amount), 0);
  const dailyTotal = dailyExpenses.reduce((s, d) => s + Number(d.amount), 0);
  const remaining = salary - family - fixedTotal - dailyTotal;

  document.getElementById("sum-salary").textContent = fmt(salary);
  document.getElementById("sum-fixed").textContent = fmt(fixedTotal);
  document.getElementById("sum-family").textContent = fmt(family);
  document.getElementById("sum-daily").textContent = fmt(dailyTotal);

  const remainingEl = document.getElementById("sum-remaining");
  remainingEl.textContent = fmt(remaining);
  remainingEl.classList.toggle("negative", remaining < 0);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Init ----------
(async function init() {
  const { data } = await sb.auth.getSession();
  if (!data.session || !data.session.user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = data.session.user;
  startApp();
})();
