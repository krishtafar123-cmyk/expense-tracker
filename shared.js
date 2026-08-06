// Shared by the login page, the dashboard, and the PIN reset page.
// Loaded before each of those scripts.

const EMAIL_KEY = "expensetracker_email";
const LOCK_KEY = "expensetracker_locked";
const LAST_ACTIVITY_KEY = "expensetracker_last_activity";

// How long the dashboard can sit idle before it locks and asks for the PIN
// again. Change this number to make locking more or less aggressive.
const LOCK_AFTER_MS = 15 * 60 * 1000; // 15 minutes
