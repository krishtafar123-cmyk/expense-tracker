const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

// EMAIL_KEY / LOCK_KEY / LAST_ACTIVITY_KEY come from shared.js.
const PIN_LENGTH = 6;

let mode = "login"; // "login" | "signup" — which action a completed PIN triggers
let pendingEmail = "";
let currentPin = "";
let firstPin = null; // holds the first entry during signup's confirm step
let pinStage = "enter"; // "enter" | "confirm"
let cameFromRememberedEmail = false;

// ---------- Greeting ----------
(function setGreeting() {
  const hour = new Date().getHours();
  let text, emoji;
  if (hour < 12) { text = "Good morning"; emoji = "🌅"; }
  else if (hour < 18) { text = "Good afternoon"; emoji = "☀️"; }
  else { text = "Good evening"; emoji = "🌙"; }
  document.getElementById("greeting-text").textContent = text;
  document.getElementById("greeting-emoji").textContent = emoji;
})();

// ---------- Elements ----------
const stepEmail = document.getElementById("step-email");
const stepPin = document.getElementById("step-pin");
const emailInput = document.getElementById("email-input");
const emailError = document.getElementById("email-error");
const emailToggleText = document.getElementById("email-toggle-text");
const emailToggleBtn = document.getElementById("email-toggle-btn");
const authSubtitle = document.getElementById("auth-subtitle");

const pinHeading = document.getElementById("pin-heading");
const pinSubheading = document.getElementById("pin-subheading");
const pinDots = document.getElementById("pin-dots").querySelectorAll(".pin-dot");
const pinError = document.getElementById("pin-error");
const pinInfo = document.getElementById("pin-info");

function showStep(step) {
  stepEmail.hidden = step !== "email";
  stepPin.hidden = step !== "pin";
}

function setMode(newMode) {
  mode = newMode;
  if (mode === "login") {
    authSubtitle.textContent = "Log in to Expense Tracker";
    emailToggleText.textContent = "Don't have an account?";
    emailToggleBtn.textContent = "Create one";
  } else {
    authSubtitle.textContent = "Create your Expense Tracker account";
    emailToggleText.textContent = "Already have an account?";
    emailToggleBtn.textContent = "Log in";
  }
}

emailToggleBtn.addEventListener("click", () => {
  setMode(mode === "login" ? "signup" : "login");
});

// ---------- Step: email ----------
document.getElementById("email-continue-btn").addEventListener("click", () => {
  const email = emailInput.value.trim();
  emailError.hidden = true;
  if (!email || !email.includes("@")) {
    emailError.textContent = "Enter a valid email address.";
    emailError.hidden = false;
    return;
  }
  pendingEmail = email;
  cameFromRememberedEmail = false;
  enterPinStep();
});

emailInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("email-continue-btn").click();
});

// ---------- Step: pin ----------
function enterPinStep() {
  currentPin = "";
  firstPin = null;
  pinStage = "enter";
  pinError.hidden = true;
  pinInfo.hidden = true;
  renderPinDots();

  if (mode === "signup") {
    pinHeading.textContent = "Choose a 6-digit PIN";
    pinSubheading.textContent = pendingEmail;
  } else {
    pinHeading.textContent = "Enter your PIN";
    pinSubheading.textContent = pendingEmail;
  }
  showStep("pin");
}

function renderPinDots() {
  const progress = document.getElementById("pin-progress");
  if (progress) progress.textContent = currentPin.length + " of " + PIN_LENGTH + " digits entered";
  pinDots.forEach((dot, i) => dot.classList.toggle("filled", i < currentPin.length));
}

function pressDigit(digit) {
  if (currentPin.length >= PIN_LENGTH) return;
  currentPin += digit;
  renderPinDots();
  if (currentPin.length === PIN_LENGTH) handlePinComplete();
}

function pressBackspace() {
  currentPin = currentPin.slice(0, -1);
  renderPinDots();
}

// Keys fire on pointerdown rather than click: mobile browsers hold a click
// back by up to ~300ms while they wait to see if it's a double-tap-to-zoom,
// which makes fast PIN entry feel laggy. Keyboard-generated clicks have
// detail === 0, so handling those separately keeps the pad accessible
// without any risk of a tap registering twice.
function bindPinKey(el, action) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    action();
  });
  el.addEventListener("click", (e) => {
    if (e.detail === 0) action();
  });
}

document.querySelectorAll(".pin-key[data-digit]").forEach((btn) => {
  bindPinKey(btn, () => pressDigit(btn.dataset.digit));
});

bindPinKey(document.getElementById("pin-backspace"), pressBackspace);

// Let a physical keyboard drive the pad too (desktop, and phones with one).
document.addEventListener("keydown", (e) => {
  if (document.getElementById("step-pin").hidden) return;
  if (e.key >= "0" && e.key <= "9") {
    e.preventDefault();
    pressDigit(e.key);
  } else if (e.key === "Backspace") {
    e.preventDefault();
    pressBackspace();
  }
});

document.getElementById("pin-back-btn").addEventListener("click", async () => {
  // Backing out of a locked session ends it, rather than leaving a live
  // session sitting behind a lock screen the user just walked away from.
  if (localStorage.getItem(LOCK_KEY) === "1") {
    localStorage.removeItem(LOCK_KEY);
    await sb.auth.signOut();
  }
  localStorage.removeItem(EMAIL_KEY);
  cameFromRememberedEmail = false;
  currentPin = "";
  renderPinDots();
  pinError.hidden = true;
  pinInfo.hidden = true;
  setMode("login");
  emailInput.value = "";
  showStep("email");
});

// ---------- Forgot PIN ----------
document.getElementById("forgot-pin-btn").addEventListener("click", async () => {
  const email = pendingEmail || emailInput.value.trim();
  pinError.hidden = true;
  pinInfo.hidden = true;
  if (!email) {
    pinError.textContent = "Enter your email first.";
    pinError.hidden = false;
    return;
  }
  const btn = document.getElementById("forgot-pin-btn");
  btn.disabled = true;
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: new URL("reset.html", window.location.href).href,
  });
  btn.disabled = false;
  if (error) {
    pinError.textContent = error.message;
    pinError.hidden = false;
    return;
  }
  pinInfo.textContent = "Reset link sent to " + email + ". Open it to choose a new PIN.";
  pinInfo.hidden = false;
});

async function handlePinComplete() {
  pinError.hidden = true;

  if (mode === "signup") {
    if (pinStage === "enter") {
      firstPin = currentPin;
      currentPin = "";
      pinStage = "confirm";
      pinHeading.textContent = "Confirm your PIN";
      renderPinDots();
      return;
    }
    // pinStage === "confirm"
    if (currentPin !== firstPin) {
      pinError.textContent = "PINs didn't match — try again.";
      pinError.hidden = false;
      currentPin = "";
      firstPin = null;
      pinStage = "enter";
      pinHeading.textContent = "Choose a 6-digit PIN";
      renderPinDots();
      return;
    }
    await doSignUp(pendingEmail, firstPin);
  } else {
    await doLogin(pendingEmail, currentPin);
  }
}

async function doSignUp(email, pin) {
  const { data, error } = await sb.auth.signUp({ email, password: pin });
  if (error) {
    pinError.textContent = error.message;
    pinError.hidden = false;
    currentPin = "";
    firstPin = null;
    pinStage = "enter";
    pinHeading.textContent = "Choose a 6-digit PIN";
    renderPinDots();
    return;
  }
  localStorage.setItem(EMAIL_KEY, email);
  if (data.session) {
    unlockAndGoToDashboard(email);
  } else {
    pinInfo.textContent = "Account created! Check your email to confirm it, then come back and enter your PIN to log in.";
    pinInfo.hidden = false;
    mode = "login";
    currentPin = "";
    pinHeading.textContent = "Enter your PIN";
    renderPinDots();
  }
}

async function doLogin(email, pin) {
  const { error } = await sb.auth.signInWithPassword({ email, password: pin });
  if (error) {
    pinError.textContent = error.message === "Invalid login credentials" ? "Incorrect PIN — try again." : error.message;
    pinError.hidden = false;
    currentPin = "";
    renderPinDots();
    return;
  }
  unlockAndGoToDashboard(email);
}

// Clearing the lock and stamping activity keeps the dashboard from
// immediately re-locking on arrival.
function unlockAndGoToDashboard(email) {
  localStorage.setItem(EMAIL_KEY, email);
  localStorage.removeItem(LOCK_KEY);
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  window.location.href = "dashboard.html";
}

// ---------- Init ----------
(async function init() {
  const { data } = await sb.auth.getSession();
  const isLocked = localStorage.getItem(LOCK_KEY) === "1";

  // A live session goes straight through — unless the dashboard locked itself
  // after being idle, in which case this page doubles as the lock screen.
  if (data.session && data.session.user && !isLocked) {
    window.location.href = "dashboard.html";
    return;
  }

  if (data.session && data.session.user && isLocked) {
    pendingEmail = localStorage.getItem(EMAIL_KEY) || data.session.user.email;
    mode = "login";
    cameFromRememberedEmail = true;
    document.getElementById("auth-subtitle").textContent = "Locked — enter your PIN to unlock";
    pinHeading.textContent = "🔒 Locked";
    pinSubheading.textContent = pendingEmail;
    showStep("pin");
    renderPinDots();
    return;
  }

  const rememberedEmail = localStorage.getItem(EMAIL_KEY);
  if (rememberedEmail) {
    pendingEmail = rememberedEmail;
    mode = "login";
    cameFromRememberedEmail = true;
    pinHeading.textContent = "Welcome back";
    pinSubheading.textContent = rememberedEmail;
    showStep("pin");
    renderPinDots();
  } else {
    setMode("login");
    showStep("email");
  }
})();
