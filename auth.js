const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const EMAIL_KEY = "expensetracker_email";
const PIN_LENGTH = 4;

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
    pinHeading.textContent = "Choose a 4-digit PIN";
    pinSubheading.textContent = pendingEmail;
  } else {
    pinHeading.textContent = "Enter your PIN";
    pinSubheading.textContent = pendingEmail;
  }
  showStep("pin");
}

function renderPinDots() {
  pinDots.forEach((dot, i) => dot.classList.toggle("filled", i < currentPin.length));
}

document.querySelectorAll(".pin-key[data-digit]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (currentPin.length >= PIN_LENGTH) return;
    currentPin += btn.dataset.digit;
    renderPinDots();
    if (currentPin.length === PIN_LENGTH) handlePinComplete();
  });
});

document.getElementById("pin-backspace").addEventListener("click", () => {
  currentPin = currentPin.slice(0, -1);
  renderPinDots();
});

document.getElementById("pin-back-btn").addEventListener("click", () => {
  localStorage.removeItem(EMAIL_KEY);
  cameFromRememberedEmail = false;
  setMode("login");
  emailInput.value = "";
  showStep("email");
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
      pinHeading.textContent = "Choose a 4-digit PIN";
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
    pinHeading.textContent = "Choose a 4-digit PIN";
    renderPinDots();
    return;
  }
  localStorage.setItem(EMAIL_KEY, email);
  if (data.session) {
    window.location.href = "dashboard.html";
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
  localStorage.setItem(EMAIL_KEY, email);
  window.location.href = "dashboard.html";
}

// ---------- Init ----------
(async function init() {
  const { data } = await sb.auth.getSession();
  if (data.session && data.session.user) {
    window.location.href = "dashboard.html";
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
