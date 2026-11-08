// Shared by the login page, the dashboard, and the PIN reset page.
// Loaded before each of those scripts.

const EMAIL_KEY = "expensetracker_email";
const LOCK_KEY = "expensetracker_locked";
const LAST_ACTIVITY_KEY = "expensetracker_last_activity";

// How long the dashboard can sit idle before it locks and asks for the PIN
// again. Change this number to make locking more or less aggressive.
const LOCK_AFTER_MS = 15 * 60 * 1000; // 15 minutes

// ---------- Face ID / fingerprint unlock ----------
// Unlocks the LOCK SCREEN only, never a full login. The PIN is the Supabase
// password, so signing in from scratch still needs it; this just replaces
// typing it while the session is still alive behind the lock.
//
// There is no server to verify a WebAuthn assertion against (and the app
// deliberately has none), so the check is local: the phone confirms it's you
// and we clear the lock flag. That is the same strength as the lock itself,
// which is already a localStorage flag in front of a live session.
const BIO_KEY = "expensetracker_biometric"; // {email, credId} once set up
const BIO_DECLINED_KEY = "expensetracker_biometric_declined"; // email, after "Not now"

// What to call it on buttons. iPads report themselves as Macs, so a Mac
// with touch is treated as an iPad.
function bioLabel() {
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && "ontouchend" in document;
  if (/iPhone|iPad|iPod/.test(ua) || touchMac) return "Face ID";
  if (/Macintosh/.test(ua)) return "Touch ID";
  return "fingerprint or face";
}

// For a label that starts a sentence ("Fingerprint or face wasn't set up").
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function bioSupported() {
  try {
    return !!(window.PublicKeyCredential && window.isSecureContext &&
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

function bioEnrollment(email) {
  try {
    const e = JSON.parse(localStorage.getItem(BIO_KEY) || "null");
    return e && e.email === email && e.credId ? e : null;
  } catch {
    return null;
  }
}

function bioClear() {
  localStorage.removeItem(BIO_KEY);
}

function toB64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

// Creates a passkey on this device (iOS offers to save it to Passwords) and
// remembers its id. Throws if the user cancels; callers show their own message.
async function bioEnroll(email) {
  // A stable user handle per account, so setting up twice replaces the
  // passkey rather than piling up duplicates in the Passwords app.
  const userId = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.toLowerCase()));
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: "Expense Tracker" },
      user: { id: userId, name: email, displayName: email },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      attestation: "none",
      timeout: 60000,
    },
  });
  localStorage.setItem(BIO_KEY, JSON.stringify({ email, credId: toB64url(cred.rawId) }));
  localStorage.removeItem(BIO_DECLINED_KEY);
}

// Resolves true only when the device confirmed the user with Face ID,
// fingerprint or the device passcode; false if they cancelled or it failed.
async function bioVerify(enrollment) {
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: "public-key", id: fromB64url(enrollment.credId) }],
        userVerification: "required",
        timeout: 60000,
      },
    });
    // Byte 32 of authenticatorData is the flags byte; 0x04 is "user verified".
    // userVerification: "required" should guarantee it, but check anyway.
    const flags = new Uint8Array(assertion.response.authenticatorData)[32];
    return (flags & 0x04) !== 0;
  } catch {
    return false;
  }
}
