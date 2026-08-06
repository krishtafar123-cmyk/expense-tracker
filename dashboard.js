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
let monthlyRow = null; // { id, family_maintenance } or null
let fixedExpenses = [];
let dailyExpenses = [];
let salaryPayments = [];
let prevMonthDailyExpenses = [];
let savingsTransactions = []; // all-time, for the running balance

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
  resetDailyDateToToday();
  document.getElementById("salary-date").value = toDateStr(new Date());
  document.getElementById("savings-date").value = toDateStr(new Date());
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

  const prevMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);

  const [monthlyRes, fixedRes, dailyRes, salaryRes, prevDailyRes, savingsRes] = await Promise.all([
    sb.from("monthly_data").select("*").eq("user_id", currentUser.id).eq("month", key).maybeSingle(),
    sb.from("fixed_expenses").select("*").eq("user_id", currentUser.id).eq("month", key).order("created_at"),
    sb.from("daily_expenses").select("*").eq("user_id", currentUser.id)
      .gte("date", toDateStr(currentMonth)).lt("date", toDateStr(monthEndExclusive(currentMonth)))
      .order("date", { ascending: false }),
    sb.from("salary_payments").select("*").eq("user_id", currentUser.id)
      .gte("date", toDateStr(currentMonth)).lt("date", toDateStr(monthEndExclusive(currentMonth)))
      .order("date", { ascending: false }),
    sb.from("daily_expenses").select("*").eq("user_id", currentUser.id)
      .gte("date", toDateStr(prevMonth)).lt("date", toDateStr(monthEndExclusive(prevMonth))),
    sb.from("savings_transactions").select("*").eq("user_id", currentUser.id).order("date", { ascending: false }),
  ]);

  if (monthlyRes.error) console.error(monthlyRes.error);
  if (fixedRes.error) console.error(fixedRes.error);
  if (dailyRes.error) console.error(dailyRes.error);
  if (salaryRes.error) console.error(salaryRes.error);
  if (prevDailyRes.error) console.error(prevDailyRes.error);
  if (savingsRes.error) console.error(savingsRes.error);

  monthlyRow = monthlyRes.data || null;
  fixedExpenses = fixedRes.data || [];
  dailyExpenses = dailyRes.data || [];
  salaryPayments = salaryRes.data || [];
  prevMonthDailyExpenses = prevDailyRes.data || [];
  savingsTransactions = savingsRes.data || [];

  document.getElementById("input-family").value = monthlyRow ? monthlyRow.family_maintenance : "";

  document.getElementById("copy-prompt").hidden = !!monthlyRow;

  renderSalaryList();
  renderSavingsList();
  renderFixedList();
  renderDailyList();
  renderCategoryBreakdown();
  renderSummary();
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
  renderSummary();
}

let familyTimer;
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
      ${rowActions()}
    `;
    li.querySelector(".delete-btn").addEventListener("click", () => deleteFixedExpense(f.id));
    attachEdit(li, f, [
      { key: "name", type: "text", required: true },
      { key: "amount", type: "number", required: true },
    ], "fixed_expenses", renderFixedList);
    ul.appendChild(li);
  }
}

// ---------- Copy from previous month ----------
// Only family maintenance + fixed expenses carry over — salary payments are
// dated real-world events, so they never make sense to copy between months.
document.getElementById("copy-prev-btn").addEventListener("click", async () => {
  const prevMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
  const prevKey = monthKey(prevMonth);

  const [prevMonthlyRes, prevFixedRes] = await Promise.all([
    sb.from("monthly_data").select("*").eq("user_id", currentUser.id).eq("month", prevKey).maybeSingle(),
    sb.from("fixed_expenses").select("*").eq("user_id", currentUser.id).eq("month", prevKey),
  ]);

  const key = monthKey(currentMonth);
  const family = prevMonthlyRes.data ? prevMonthlyRes.data.family_maintenance : 0;

  const { data: newRow, error } = await sb.from("monthly_data")
    .insert({ user_id: currentUser.id, month: key, family_maintenance: family })
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

  document.getElementById("input-family").value = family;
  document.getElementById("copy-prompt").hidden = true;
  renderFixedList();
  renderSummary();
  toast("Copied from previous month");
});

// ---------- Inline editing ----------
// Shared by every list. Swaps a row into a small form in place; on save it
// patches the row and reloads the month, which keeps lists and totals correct
// even when an edit moves an entry into a different month.
function rowActions() {
  return `
    <span class="item-actions">
      <button class="edit-btn" aria-label="Edit" title="Edit">✎</button>
      <button class="delete-btn" aria-label="Delete" title="Delete">✕</button>
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
        let value = field.type === "number" ? parseFloat(el.value) || 0 : el.value.trim();
        if (field.nullable && value === "") value = null;
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
document.getElementById("salary-form").addEventListener("submit", async (e) => {
  e.preventDefault();
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
      ${rowActions()}
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

document.getElementById("savings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
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
  toast(type === "deposit" ? "Deposit added" : "Withdrawal added");
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
    const label = t.type === "deposit" ? "Deposit" : "Withdrawal";
    li.innerHTML = `
      <div class="item-main">
        <span class="item-title">${label} · ${dateLabel}</span>
        ${t.note ? `<span class="item-sub">${escapeHtml(t.note)}</span>` : ""}
      </div>
      <span class="item-amount">${t.type === "withdrawal" ? "-" : ""}${fmt(t.amount)}</span>
      ${rowActions()}
    `;
    li.querySelector(".delete-btn").addEventListener("click", () => deleteSavingsTransaction(t.id));
    attachEdit(li, t, [
      { key: "date", type: "date", required: true },
      { key: "type", type: "select", options: [{ value: "deposit", label: "Deposit" }, { value: "withdrawal", label: "Withdrawal" }] },
      { key: "amount", type: "number", required: true },
      { key: "note", type: "text", placeholder: "Note (optional)", nullable: true },
    ], "savings_transactions", renderSavingsList);
    ul.appendChild(li);
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
  resetDailyDateToToday();

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
      ${rowActions()}
    `;
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

// ---------- Summary ----------
function renderSummary() {
  const salary = salaryPayments.reduce((s, p) => s + Number(p.amount), 0);
  const family = monthlyRow ? Number(monthlyRow.family_maintenance) : 0;
  const fixedTotal = fixedExpenses.reduce((s, f) => s + Number(f.amount), 0);
  const dailyTotal = dailyExpenses.reduce((s, d) => s + Number(d.amount), 0);
  const netSavings = savingsThisMonth().reduce((s, t) => s + signedAmount(t), 0);
  const remaining = salary - family - fixedTotal - dailyTotal - netSavings;

  document.getElementById("sum-salary").textContent = fmt(salary);
  document.getElementById("sum-fixed").textContent = fmt(fixedTotal);
  document.getElementById("sum-family").textContent = fmt(family);
  document.getElementById("sum-daily").textContent = fmt(dailyTotal);
  document.getElementById("sum-savings").textContent = fmt(netSavings);

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
  const fixedTotal = fixedExpenses.reduce((s, f) => s + Number(f.amount), 0);
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
    const committedShare = ((family + fixedTotal) / salary) * 100;
    if (committedShare >= 60) {
      insights.push({
        tone: "info",
        icon: "🔒",
        text: `Fixed expenses and family maintenance take up ${Math.round(committedShare)}% of your salary this month.`,
      });
    }
  }

  return insights.slice(0, 4);
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
