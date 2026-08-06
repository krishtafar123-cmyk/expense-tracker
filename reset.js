// Read the hash BEFORE creating the client: supabase-js consumes the recovery
// token out of the URL as soon as createClient runs, so checking afterwards
// would always look like a normal visit.
const isRecoveryLink = window.location.hash.includes("type=recovery");

const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const PIN_LENGTH = 6;

let currentPin = "";
let firstPin = null;
let pinStage = "enter"; // "enter" | "confirm"
let userEmail = "";

const pinHeading = document.getElementById("pin-heading");
const pinSubheading = document.getElementById("pin-subheading");
const pinDots = document.getElementById("pin-dots").querySelectorAll(".pin-dot");
const pinError = document.getElementById("pin-error");
const pinInfo = document.getElementById("pin-info");

function showStep(step) {
  document.getElementById("step-checking").hidden = step !== "checking";
  document.getElementById("step-pin").hidden = step !== "pin";
  document.getElementById("step-invalid").hidden = step !== "invalid";
}

function renderPinDots() {
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

// Same pointerdown handling as the login pad — click is delayed on mobile.
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

function restartEntry(message) {
  if (message) {
    pinError.textContent = message;
    pinError.hidden = false;
  }
  currentPin = "";
  firstPin = null;
  pinStage = "enter";
  pinHeading.textContent = "Choose a 6-digit PIN";
  renderPinDots();
}

async function handlePinComplete() {
  pinError.hidden = true;

  if (pinStage === "enter") {
    firstPin = currentPin;
    currentPin = "";
    pinStage = "confirm";
    pinHeading.textContent = "Confirm your new PIN";
    renderPinDots();
    return;
  }

  if (currentPin !== firstPin) {
    restartEntry("PINs didn't match — try again.");
    return;
  }

  const newPin = firstPin;
  const { error } = await sb.auth.updateUser({ password: newPin });
  if (error) {
    restartEntry(error.message);
    return;
  }

  // Proving control of the email clears any lock left on this device.
  localStorage.removeItem(LOCK_KEY);
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  if (userEmail) localStorage.setItem(EMAIL_KEY, userEmail);

  pinInfo.textContent = "PIN updated. Taking you to your dashboard…";
  pinInfo.hidden = false;
  setTimeout(() => { window.location.href = "dashboard.html"; }, 1200);
}

function showInvalid(message) {
  if (message) document.getElementById("invalid-text").textContent = message;
  document.getElementById("reset-subtitle").textContent = "Something went wrong";
  showStep("invalid");
}

// ---------- Init ----------
(async function init() {
  showStep("checking");

  // Recovery links land here with the token in the URL hash; supabase-js needs
  // a moment to exchange it for a session.
  if (isRecoveryLink) {
    await new Promise((resolve) => {
      const { data: sub } = sb.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
          sub.subscription.unsubscribe();
          resolve();
        }
      });
      setTimeout(() => {
        sub.subscription.unsubscribe();
        resolve();
      }, 4000);
    });
  }

  const { data } = await sb.auth.getSession();

  if (!data.session || !data.session.user) {
    showInvalid("This reset link is invalid or has expired. Request a new one from the log in page.");
    return;
  }

  // A locked session must not be able to set a new PIN without proving
  // identity — otherwise the idle lock could be bypassed just by opening this
  // page. Only a genuine emailed recovery link overrides the lock.
  if (!isRecoveryLink && localStorage.getItem(LOCK_KEY) === "1") {
    window.location.href = "index.html";
    return;
  }

  userEmail = data.session.user.email || "";
  document.getElementById("reset-subtitle").textContent = isRecoveryLink
    ? "Choose a new PIN for your account"
    : "Change the PIN for your account";
  pinSubheading.textContent = userEmail;
  showStep("pin");
  renderPinDots();
})();
