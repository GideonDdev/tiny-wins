import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import {
  doc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const STORAGE_KEY = "tinywins-v1";
const authGate = document.querySelector("#auth-gate");
const onboardingScreen = document.querySelector("#onboarding-screen");
const appShell = document.querySelector("#app-shell");
const authStatus = document.querySelector("#auth-status");
const setupHelp = document.querySelector("#setup-help");
const googleSignInButton = document.querySelector("#google-signin");
const retryAccountSyncButton = document.querySelector("#retry-account-sync");
const recoverySignOutButton = document.querySelector("#recovery-signout-button");
const signOutButton = document.querySelector("#signout-button");
const habitList = document.querySelector("#habit-list");
const weekDays = document.querySelector("#week-days");
const habitForm = document.querySelector("#habit-form");
const habitNameInput = document.querySelector("#habit-name");
const toast = document.querySelector("#toast");
const storageNote = document.querySelector("#storage-note");
const syncStatus = document.querySelector("#sync-status");
const emptyState = document.querySelector("#empty-state");
const habitTitle = document.querySelector("#habits-title");
const profileForm = document.querySelector("#profile-form");
const profileError = document.querySelector("#onboarding-error");
const onboardingAccount = document.querySelector("#onboarding-account");
const profileSubmit = document.querySelector("#profile-submit");
const profileCancel = document.querySelector("#profile-cancel");
const reminderTimeInput = document.querySelector("#reminder-time");
const reminderSaveButton = document.querySelector("#reminder-save");
const reminderDisableButton = document.querySelector("#reminder-disable");
const reminderStatus = document.querySelector("#reminder-status");
const themeButtons = document.querySelectorAll("[data-theme-toggle]");
const installButtons = document.querySelectorAll("[data-install-app]");
const THEME_STORAGE_KEY = "tinywins-theme";
const REMINDER_STORAGE_PREFIX = "tinywins-reminder:";
let toastTimeout;
let dailyRefreshTimeout;
let reminderTimeout;
let renderedDateKey;
let deferredInstallPrompt = null;
let currentUser = null;
let currentProfile = null;
let firestoreDb = null;
let accountSyncGeneration = 0;
let accountSyncReady = false;
let accountSyncListener = null;
let accountSyncWrites = Promise.resolve();
let reminderEnabled = false;
let savedReminderTime = "18:00";
let reminderLastSentDate = null;
let reminderGeneration = 0;
let state;

const appIsInstalled = window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;
installButtons.forEach((button) => { button.hidden = appIsInstalled; });

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').content = isDark ? "#1d2420" : "#f6f5ef";
  themeButtons.forEach((button) => {
    const label = isDark ? "Light mode" : "Dark mode";
    button.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} theme`);
    button.querySelector(".theme-label").textContent = label;
    button.querySelector(".theme-icon").textContent = isDark ? "☀" : "☾";
  });
}

function loadTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch (error) {
    console.error("Could not load Tiny Wins theme preference:", error);
    return "light";
  }
}

applyTheme(loadTheme());
themeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      console.error("Could not save Tiny Wins theme preference:", error);
      showToast("Theme changed, but couldn't be saved in this browser.");
    }
  });
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButtons.forEach((button) => { button.hidden = false; });
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installButtons.forEach((button) => { button.hidden = true; });
});

installButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      showToast("To install Tiny Wins, open your browser menu and choose Install app or Add to Home Screen.");
      return;
    }

    try {
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === "accepted") {
        installButtons.forEach((installButton) => { installButton.hidden = true; });
      }
      deferredInstallPrompt = null;
    } catch (error) {
      console.error("Could not open the Tiny Wins install prompt:", error);
      showToast("To install Tiny Wins, open your browser menu and choose Install app or Add to Home Screen.");
    }
  });
});

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js")
      .then(() => console.info("Tiny Wins offline app shell is ready."))
      .catch((error) => console.error("Could not register the Tiny Wins service worker:", error));
  });
}

const starterHabitsByFocus = {
  movement: [
    { id: "starter-move", name: "Move your body for 20 minutes", category: "Move a little", emoji: "🌿" },
    { id: "starter-stretch", name: "Take a few minutes to stretch", category: "Find your movement", emoji: "🧘" },
    { id: "starter-water", name: "Drink a glass of water", category: "Care for yourself", emoji: "💧" },
    { id: "starter-walk", name: "Step outside for a short walk", category: "Get some fresh air", emoji: "👟" }
  ],
  learning: [
    { id: "starter-read", name: "Read a few pages", category: "Make time to learn", emoji: "📖" },
    { id: "starter-practice", name: "Practice a skill for 15 minutes", category: "Get a little better", emoji: "✏️" },
    { id: "starter-note", name: "Write down one thing you learned", category: "Keep what matters", emoji: "📝" },
    { id: "starter-curious", name: "Explore one thing that interests you", category: "Follow your curiosity", emoji: "🔎" }
  ],
  mindfulness: [
    { id: "starter-breathe", name: "Take five slow breaths", category: "Pause and reset", emoji: "☁️" },
    { id: "starter-journal", name: "Write down one good thing", category: "Make space to reflect", emoji: "✍️" },
    { id: "starter-quiet", name: "Take five quiet minutes", category: "Be here now", emoji: "🕯️" },
    { id: "starter-outside", name: "Spend a few minutes outside", category: "Notice the moment", emoji: "🌱" }
  ],
  wellbeing: [
    { id: "starter-water", name: "Drink a glass of water", category: "Care for yourself", emoji: "💧" },
    { id: "starter-gratitude", name: "Write down one good thing", category: "Notice what feels good", emoji: "💛" },
    { id: "starter-move", name: "Move your body for 20 minutes", category: "A little energy", emoji: "🌿" },
    { id: "starter-rest", name: "Make time to unwind", category: "Rest is productive too", emoji: "🌙" }
  ],
  creativity: [
    { id: "starter-create", name: "Create something for 15 minutes", category: "Make a little something", emoji: "🎨" },
    { id: "starter-read", name: "Read or listen to something inspiring", category: "Collect new ideas", emoji: "📖" },
    { id: "starter-journal", name: "Write down an idea", category: "Keep your sparks", emoji: "✍️" },
    { id: "starter-walk", name: "Take a short inspiration walk", category: "Look around you", emoji: "✨" }
  ]
};

const focusLabels = {
  movement: "moving more",
  learning: "learning",
  mindfulness: "mindfulness",
  wellbeing: "wellbeing",
  creativity: "creativity"
};

const dailyNotes = [
  "You don't have to be perfect. Just keep showing up.",
  "Small steps still move you forward.",
  "You are allowed to begin again, as many times as you need.",
  "Progress can be quiet. It still counts.",
  "A little care for yourself is time well spent.",
  "Today is a chance, not a test.",
  "Keep it simple. One small win is enough to start.",
  "Your pace is a perfectly good pace.",
  "You can do hard things one tiny step at a time.",
  "Rest is part of the rhythm, too.",
  "Notice how far you've come, not just how far there is to go.",
  "Showing up imperfectly is better than waiting for perfect.",
  "Make room for the things that help you feel like you.",
  "You deserve the patience you give to others."
];

function dailyNote(date) {
  const dayNumber = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  const index = ((dayNumber % dailyNotes.length) + dailyNotes.length) % dailyNotes.length;
  return dailyNotes[index];
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function shiftDate(date, amount) {
  const shifted = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  shifted.setDate(shifted.getDate() + amount);
  return shifted;
}

function startOfWeek(date) {
  const monday = shiftDate(date, -((date.getDay() + 6) % 7));
  return monday;
}

function createDefaultState(focus = "movement") {
  const habits = starterHabitsByFocus[focus] || starterHabitsByFocus.movement;
  return {
    habits: habits.map((habit) => ({ ...habit, daysPerWeek: currentProfile?.weeklyTarget || 5 })),
    completions: {}
  };
}

state = createDefaultState();

function isValidState(value) {
  return value !== null &&
    typeof value === "object" &&
    Array.isArray(value.habits) &&
    new Set(value.habits.map((habit) => habit && habit.id)).size === value.habits.length &&
    value.habits.every((habit) =>
      habit &&
      typeof habit.id === "string" &&
      typeof habit.name === "string" &&
      typeof habit.category === "string" &&
      typeof habit.emoji === "string" &&
      (habit.daysPerWeek === undefined || Number.isInteger(habit.daysPerWeek) && habit.daysPerWeek >= 1 && habit.daysPerWeek <= 7)
    ) &&
    value.completions !== null &&
    typeof value.completions === "object" &&
    !Array.isArray(value.completions) &&
    Object.values(value.completions).every((day) =>
      day !== null &&
      typeof day === "object" &&
      !Array.isArray(day) &&
      Object.values(day).every((completed) => typeof completed === "boolean")
    );
}

function showStorageWarning(message) {
  storageNote.textContent = message;
  storageNote.classList.add("is-warning");
}

function userStorageKey() {
  if (!currentUser) throw new Error("Cannot access habit data without a signed-in profile.");
  return `${STORAGE_KEY}:${currentUser.uid}`;
}

function profileStorageKey() {
  if (!currentUser) throw new Error("Cannot access profile preferences without a signed-in profile.");
  return `${STORAGE_KEY}:profile:${currentUser.uid}`;
}

function isValidProfile(value) {
  return value !== null &&
    typeof value === "object" &&
    typeof value.displayName === "string" &&
    Object.hasOwn(focusLabels, value.focus) &&
    [3, 5, 7].includes(value.weeklyTarget) &&
    ["flexible", "morning", "afternoon", "evening"].includes(value.routineTime);
}

function loadProfile() {
  try {
    const saved = localStorage.getItem(profileStorageKey());
    if (saved === null) return null;

    const parsed = JSON.parse(saved);
    if (isValidProfile(parsed)) return parsed;
    throw new Error("Saved profile preferences have an unexpected format.");
  } catch (error) {
    console.error("Could not load Tiny Wins profile preferences:", error);
    return null;
  }
}

function saveProfile(profile) {
  try {
    localStorage.setItem(profileStorageKey(), JSON.stringify(profile));
    currentProfile = profile;
    syncAccountData();
    return true;
  } catch (error) {
    console.error("Could not save Tiny Wins profile preferences:", error);
    profileError.textContent = "We couldn't save your preferences in this browser. Check your storage settings and try again.";
    profileError.hidden = false;
    return false;
  }
}

function loadState(fallbackFocus = currentProfile?.focus, emptyWhenUnconfigured = false) {
  try {
    const saved = localStorage.getItem(userStorageKey());
    if (saved === null) {
      return emptyWhenUnconfigured
        ? { habits: [], completions: {} }
        : createDefaultState(fallbackFocus);
    }

    const parsed = JSON.parse(saved);
    if (isValidState(parsed)) return parsed;

    throw new Error("Saved Tiny Wins data has an unexpected format.");
  } catch (error) {
    console.error("Could not load Tiny Wins data:", error);
    showStorageWarning("Saved data couldn't be read. Your new progress may not be saved.");
    return emptyWhenUnconfigured
      ? { habits: [], completions: {} }
      : createDefaultState(fallbackFocus);
  }
}

function loadLegacyState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === null) return null;

    const parsed = JSON.parse(saved);
    if (isValidState(parsed)) return parsed;
    throw new Error("Legacy Tiny Wins data has an unexpected format.");
  } catch (error) {
    console.error("Could not read legacy Tiny Wins progress:", error);
    showStorageWarning("Older device-saved progress couldn't be checked. It hasn't been deleted.");
    return null;
  }
}

let selectedDate = new Date();
selectedDate.setHours(0, 0, 0, 0);
let displayedWeek = startOfWeek(selectedDate);

function saveState() {
  try {
    localStorage.setItem(userStorageKey(), JSON.stringify(state));
    storageNote.textContent = "Your habits are saved on this device.";
    storageNote.classList.remove("is-warning");
    syncAccountData();
    return true;
  } catch (error) {
    console.error("Could not save Tiny Wins data:", error);
    showStorageWarning("Couldn't save changes on this device. Check your browser storage settings.");
    showToast("Your change could not be saved.");
    return false;
  }
}

function mergeStates(cloudState, deviceState) {
  const habits = new Map(cloudState.habits.map((habit) => [habit.id, habit]));
  deviceState.habits.forEach((habit) => {
    if (!habits.has(habit.id)) habits.set(habit.id, habit);
  });

  const completions = {};
  [deviceState.completions, cloudState.completions].forEach((source) => {
    Object.entries(source).forEach(([date, day]) => {
      if (!completions[date]) completions[date] = {};
      Object.entries(day).forEach(([habitId, completed]) => {
        if (completed) completions[date][habitId] = true;
      });
      if (Object.keys(completions[date]).length === 0) delete completions[date];
    });
  });

  return { habits: [...habits.values()], completions };
}

function setSyncStatus(message, isWarning = false) {
  syncStatus.textContent = message;
  syncStatus.hidden = !message;
  syncStatus.classList.toggle("is-warning", isWarning);
}

function isValidSyncedData(value) {
  return value !== null &&
    typeof value === "object" &&
    (value.profile === null || isValidProfile(value.profile)) &&
    isValidState(value.state);
}

function persistSyncedData(profile, syncedState) {
  if (profile === null) {
    localStorage.removeItem(profileStorageKey());
  } else {
    localStorage.setItem(profileStorageKey(), JSON.stringify(profile));
  }
  localStorage.setItem(userStorageKey(), JSON.stringify(syncedState));
}

function applySyncedData(profile, syncedState) {
  currentProfile = profile;
  state = syncedState;
  try {
    persistSyncedData(profile, syncedState);
  } catch (error) {
    console.error("Could not save synced Tiny Wins data on this device:", error);
    showStorageWarning("Cloud data is available, but couldn't be saved on this device.");
  }

  if (currentProfile) {
    showDashboard();
  } else {
    showOnboarding();
  }
}

function syncAccountData() {
  if (!accountSyncReady || !currentUser || !currentProfile) return;

  const uid = currentUser.uid;
  const generation = accountSyncGeneration;
  const reference = doc(firestoreDb, "users", uid, "appData", "main");
  const profile = { ...currentProfile };
  const syncedState = JSON.parse(JSON.stringify(state));
  accountSyncWrites = accountSyncWrites
    .catch(() => {})
    .then(() => {
      if (generation !== accountSyncGeneration || currentUser?.uid !== uid) return;
      return setDoc(reference, {
        profile,
        state: syncedState,
        updatedAt: serverTimestamp()
      });
    })
    .then(() => {
      if (generation === accountSyncGeneration && currentUser?.uid === uid) {
        setSyncStatus("Synced across your devices.");
      }
    })
    .catch((error) => {
      console.error("Could not sync Tiny Wins data:", error);
      if (generation === accountSyncGeneration && currentUser?.uid === uid) {
        setSyncStatus("Cloud sync failed. Your changes are saved on this device.", true);
      }
    });
}

async function initializeAccountSync(user) {
  const generation = ++accountSyncGeneration;
  accountSyncReady = false;
  profileSubmit.disabled = !currentProfile;
  if (!currentProfile) {
    appShell.hidden = true;
    onboardingScreen.hidden = true;
    authGate.hidden = false;
    googleSignInButton.hidden = true;
    retryAccountSyncButton.hidden = true;
    recoverySignOutButton.hidden = true;
    retryAccountSyncButton.disabled = true;
    authStatus.classList.remove("is-error");
    authStatus.textContent = "Checking your saved progress…";
  }
  if (accountSyncListener) accountSyncListener();
  accountSyncListener = null;
  setSyncStatus("Syncing your account data…");

  const reference = doc(firestoreDb, "users", user.uid, "appData", "main");
  try {
    const snapshot = await getDocFromServer(reference);
    if (generation !== accountSyncGeneration || currentUser?.uid !== user.uid) return;

    let profile = currentProfile;
    let syncedState = state;
    if (snapshot.exists()) {
      const cloudData = snapshot.data();
      if (!isValidSyncedData(cloudData)) {
        throw new Error("Cloud data has an unexpected format; local data was left unchanged.");
      }
      profile = cloudData.profile || profile;
      syncedState = mergeStates(cloudData.state, syncedState);
    } else {
      const legacyState = loadLegacyState();
      const hasLegacyProgress = legacyState &&
        (legacyState.habits.length > 0 || Object.keys(legacyState.completions).length > 0);
      if (hasLegacyProgress && window.confirm(
        `Tiny Wins found progress saved on this device. Restore it to ${user.email || "this Google account"}?`
      )) {
        syncedState = mergeStates(syncedState, legacyState);
      }
    }

    applySyncedData(profile, syncedState);
    await setDoc(reference, {
      profile,
      state: syncedState,
      updatedAt: serverTimestamp()
    });
    if (generation !== accountSyncGeneration || currentUser?.uid !== user.uid) return;

    accountSyncReady = true;
    profileSubmit.disabled = false;
    retryAccountSyncButton.hidden = true;
    recoverySignOutButton.hidden = true;
    setSyncStatus("Synced across your devices.");
    accountSyncListener = onSnapshot(reference, (remoteSnapshot) => {
      if (generation !== accountSyncGeneration || currentUser?.uid !== user.uid ||
          remoteSnapshot.metadata.hasPendingWrites || remoteSnapshot.metadata.fromCache ||
          !remoteSnapshot.exists()) return;

      const cloudData = remoteSnapshot.data();
      if (!isValidSyncedData(cloudData)) {
        console.error("Cloud data has an unexpected format; keeping the local copy.");
        setSyncStatus("Cloud data couldn't be read. Your local copy is unchanged.", true);
        return;
      }
      applySyncedData(cloudData.profile, cloudData.state);
      setSyncStatus("Synced across your devices.");
    }, (error) => {
      console.error("Could not listen for Tiny Wins updates:", error);
      if (generation === accountSyncGeneration) {
        setSyncStatus("Live sync stopped. Your changes are saved on this device.", true);
      }
    });
    syncAccountData();
  } catch (error) {
    console.error("Could not sync Tiny Wins account data:", error);
    if (generation === accountSyncGeneration && currentUser?.uid === user.uid) {
      profileSubmit.disabled = false;
      if (currentProfile) {
        setSyncStatus("Cloud sync unavailable. Your data is saved on this device.", true);
      } else {
        authGate.hidden = false;
        appShell.hidden = true;
        onboardingScreen.hidden = true;
        googleSignInButton.hidden = true;
        retryAccountSyncButton.disabled = false;
        retryAccountSyncButton.hidden = false;
        recoverySignOutButton.hidden = false;
        const accountLabel = user.email ? `Signed in as ${user.email}. ` : "";
        showAuthError(`${accountLabel}We couldn't load this account's saved progress, so we haven't started a new profile. Check your connection and retry. (${error.message})`);
      }
    }
  }
}

window.addEventListener("online", () => {
  if (currentUser && firestoreDb) initializeAccountSync(currentUser);
});

retryAccountSyncButton.addEventListener("click", () => {
  if (currentUser && firestoreDb) initializeAccountSync(currentUser);
});

function completionFor(key) {
  return state.completions[key] || {};
}

function hasWinOn(key) {
  const day = completionFor(key);
  return state.habits.some((habit) => day[habit.id] === true);
}

function currentStreak() {
  if (state.habits.length === 0) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let cursor = hasWinOn(dateKey(today)) ? today : shiftDate(today, -1);
  if (!hasWinOn(dateKey(cursor))) return 0;

  let streak = 0;
  while (hasWinOn(dateKey(cursor))) {
    streak += 1;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}

function streakLevel(streak) {
  const levels = [
    { days: 1, name: "Seedling" },
    { days: 3, name: "Sprout" },
    { days: 7, name: "Bloom" },
    { days: 14, name: "Flourish" },
    { days: 30, name: "Evergreen" }
  ];
  let current = null;
  let next = levels[0];

  for (let index = 0; index < levels.length; index += 1) {
    if (streak < levels[index].days) {
      next = levels[index];
      break;
    }
    current = levels[index];
    next = levels[index + 1] || null;
  }

  const levelNumber = current ? levels.indexOf(current) + 1 : 0;
  const progressStart = current ? current.days : 0;
  const progress = next
    ? Math.round(((streak - progressStart) / (next.days - progressStart)) * 100)
    : 100;

  return {
    label: `Level ${levelNumber} · ${current ? current.name : "Starting"}`,
    progress: Math.max(0, Math.min(100, progress)),
    next
  };
}

function showToast(message) {
  window.clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimeout = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function renderDailyNote(date) {
  document.querySelector("#quote-text").textContent = dailyNote(date);
  const label = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(date);
  document.querySelector("#current-date").textContent = `YOUR DAILY RESET · ${label.toUpperCase()}`;
  renderedDateKey = dateKey(date);

  window.clearTimeout(dailyRefreshTimeout);
  if (!appShell.hidden) {
    const nextMidnight = new Date(date);
    nextMidnight.setHours(24, 0, 0, 50);
    dailyRefreshTimeout = window.setTimeout(
      () => renderDailyNote(new Date()),
      Math.max(0, nextMidnight.getTime() - Date.now())
    );
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !appShell.hidden && renderedDateKey !== dateKey(new Date())) {
    renderDailyNote(new Date());
  }
});

function renderHeader() {
  const today = new Date();
  renderDailyNote(today);

  const selectedLabel = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(selectedDate);
  const isToday = dateKey(selectedDate) === dateKey(today);
  habitTitle.firstChild.textContent = isToday ? "Today's habits" : `${selectedLabel}'s habits`;
  const displayName = currentProfile.displayName || currentUser.displayName || currentUser.email || "Your profile";
  document.querySelector("#profile-name").textContent = displayName;
  document.querySelector("#personalized-copy").textContent = `A little ${focusLabels[currentProfile.focus]} goes a long way. Your goal: ${currentProfile.weeklyTarget} days a week.`;
  const timeLabels = {
    flexible: "whenever it fits",
    morning: "in the morning",
    afternoon: "in the afternoon",
    evening: "in the evening"
  };
  document.querySelector("#weekly-target-caption").textContent = `${currentProfile.weeklyTarget} days/week · ${timeLabels[currentProfile.routineTime]}`;
}

function renderWeek() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentWeekStart = startOfWeek(today);
  weekDays.replaceChildren();

  for (let offset = 0; offset < 7; offset += 1) {
    const date = shiftDate(displayedWeek, offset);
    const key = dateKey(date);
    const selected = key === dateKey(selectedDate);
    const isToday = key === dateKey(today);
    const future = date > today;
    const button = document.createElement("button");
    button.className = "day-button";
    if (selected) button.classList.add("is-selected");
    if (isToday) button.classList.add("is-today");
    button.type = "button";
    button.disabled = future;
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("aria-label", new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric"
    }).format(date));

    const name = document.createElement("span");
    name.className = "day-name";
    name.textContent = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
    const number = document.createElement("span");
    number.className = "day-number";
    number.textContent = String(date.getDate());
    const marker = document.createElement("span");
    marker.className = hasWinOn(key) ? "day-dot" : "day-dot-placeholder";
    marker.setAttribute("aria-hidden", "true");
    button.append(name, number, marker);
    button.addEventListener("click", () => {
      selectedDate = date;
      render();
    });
    weekDays.append(button);
  }

  document.querySelector("#previous-week").disabled = false;
  document.querySelector("#next-week").disabled = displayedWeek >= currentWeekStart;
}

function renderHabits() {
  const key = dateKey(selectedDate);
  const completed = completionFor(key);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  habitList.replaceChildren();
  emptyState.hidden = state.habits.length > 0;
  habitList.hidden = state.habits.length === 0;

  state.habits.forEach((habit) => {
    const isComplete = completed[habit.id] === true;
    const row = document.createElement("article");
    row.className = `habit-row${isComplete ? " is-complete" : ""}`;

    const check = document.createElement("button");
    check.className = "habit-check";
    check.type = "button";
    check.textContent = isComplete ? "✓" : "";
    check.setAttribute("aria-label", `${isComplete ? "Mark incomplete" : "Mark complete"}: ${habit.name}`);
    check.setAttribute("aria-pressed", String(isComplete));
    check.addEventListener("click", () => toggleHabit(habit.id));

    const main = document.createElement("div");
    main.className = "habit-main";
    const name = document.createElement("span");
    name.className = "habit-name";
    name.textContent = habit.name;
    const category = document.createElement("span");
    category.className = "habit-category";
    let completedDaysThisWeek = 0;
    for (let offset = 0; offset < 7; offset += 1) {
      const date = shiftDate(displayedWeek, offset);
      if (date > today) continue;
      if (completionFor(dateKey(date))[habit.id] === true) completedDaysThisWeek += 1;
    }
    const targetDays = habit.daysPerWeek || currentProfile.weeklyTarget;
    category.textContent = `${habit.category} · ${completedDaysThisWeek}/${targetDays} days this week`;
    main.append(name, category);

    const emoji = document.createElement("span");
    emoji.className = "habit-emoji";
    emoji.setAttribute("aria-hidden", "true");
    emoji.textContent = habit.emoji;

    const remove = document.createElement("button");
    remove.className = "habit-delete";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${habit.name}`);
    remove.addEventListener("click", () => removeHabit(habit));

    row.append(check, main, emoji, remove);
    habitList.append(row);
  });
}

function renderProgress() {
  const completions = completionFor(dateKey(selectedDate));
  const done = state.habits.filter((habit) => completions[habit.id] === true).length;
  const total = state.habits.length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const progressCount = document.querySelector("#progress-count");
  progressCount.firstChild.textContent = `${done} `;
  progressCount.querySelector("span").textContent = `/ ${total}`;
  document.querySelector("#progress-percent").textContent = `${percent}%`;
  document.querySelector("#progress-ring").style.background = `conic-gradient(var(--green) ${percent}%, var(--ring-track) ${percent}% 100%)`;
  document.querySelector("#progress-ring").setAttribute("aria-label", `${percent} percent complete`);

  const caption = total === 0
    ? "Add one small habit to begin"
    : done === total
      ? "You showed up for yourself today"
      : done === 0
        ? "Your day is just getting started"
        : "One step at a time";
  document.querySelector("#progress-caption").textContent = caption;
  const streakCount = document.querySelector("#streak-count");
  const streak = currentStreak();
  const level = streakLevel(streak);
  streakCount.firstChild.textContent = `${streak} `;
  document.querySelector("#streak-level").textContent = level.label;
  const levelMeter = document.querySelector("#streak-level-meter");
  levelMeter.setAttribute("aria-valuenow", String(level.progress));
  levelMeter.setAttribute("aria-valuemax", "100");
  levelMeter.setAttribute("aria-valuetext", level.next
    ? `${streak} of ${level.next.days} days toward ${level.next.name}`
    : `${streak}-day streak; highest level reached`);
  levelMeter.setAttribute("aria-label", level.next
    ? `Progress toward ${level.next.name}`
    : "Evergreen level complete");
  document.querySelector("#streak-level-progress").style.width = `${level.progress}%`;

  const weekEnd = shiftDate(displayedWeek, 6);
  let winsThisWeek = 0;
  for (let date = new Date(displayedWeek); date <= weekEnd; date = shiftDate(date, 1)) {
    const day = completionFor(dateKey(date));
    winsThisWeek += state.habits.filter((habit) => day[habit.id] === true).length;
  }
  const weeklySummary = state.habits.length === 0
    ? "Add a habit to start your week."
    : winsThisWeek === 0
      ? "A new week is a fresh start."
      : `${winsThisWeek} ${winsThisWeek === 1 ? "win" : "wins"} this week`;
  document.querySelector("#weekly-summary").textContent = weeklySummary;
}

function renderWeeklyRecap() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekEnd = shiftDate(displayedWeek, 6);
  const rangeFormat = { month: "short", day: "numeric" };
  document.querySelector("#recap-date-range").textContent =
    `${new Intl.DateTimeFormat(undefined, rangeFormat).format(displayedWeek)} – ${new Intl.DateTimeFormat(undefined, { ...rangeFormat, year: "numeric" }).format(weekEnd)}`;

  const days = [];
  let totalCheckins = 0;
  let daysWithWins = 0;
  let bestDay = null;
  let chartMax = 1;

  for (let offset = 0; offset < 7; offset += 1) {
    const date = shiftDate(displayedWeek, offset);
    const key = dateKey(date);
    const future = date > today;
    const completions = completionFor(key);
    const count = future ? 0 : state.habits.filter((habit) => completions[habit.id] === true).length;
    days.push({ date, count, future });
    chartMax = Math.max(chartMax, count);
    totalCheckins += count;
    if (count > 0) {
      daysWithWins += 1;
      if (!bestDay || count > bestDay.count) bestDay = { date, count };
    }
  }

  const goal = currentProfile.weeklyTarget;
  const goalPercent = Math.min(100, Math.round((daysWithWins / goal) * 100));
  document.querySelector("#recap-goal").textContent = `${daysWithWins} / ${goal}`;
  document.querySelector("#recap-goal-note").textContent = daysWithWins === 1 ? "day with a win" : "days with a win";
  document.querySelector("#recap-goal-fill").style.width = `${goalPercent}%`;
  document.querySelector("#recap-goal-track").setAttribute("aria-label", `${goalPercent} percent of weekly goal`);
  document.querySelector("#recap-checkins").textContent = String(totalCheckins);
  document.querySelector("#recap-best-day").textContent = bestDay
    ? new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(bestDay.date)
    : "—";
  document.querySelector("#recap-best-note").textContent = bestDay
    ? `${bestDay.count} ${bestDay.count === 1 ? "habit" : "habits"} completed`
    : "Your next win could be it.";

  const chart = document.querySelector("#recap-chart");
  chart.replaceChildren();
  days.forEach(({ date, count, future }) => {
    const column = document.createElement("div");
    column.className = "recap-day";
    if (dateKey(date) === dateKey(today)) column.classList.add("is-today");
    if (future) column.classList.add("is-future");
    const label = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
    column.setAttribute("aria-label", future ? `${label}: upcoming` : `${label}: ${count} ${count === 1 ? "habit" : "habits"} completed`);

    const countLabel = document.createElement("span");
    countLabel.className = "recap-day-count";
    countLabel.textContent = future ? "" : String(count);
    const barTrack = document.createElement("span");
    barTrack.className = "recap-bar-track";
    const bar = document.createElement("span");
    bar.className = "recap-bar";
    bar.style.height = future ? "0%" : `${Math.max(count > 0 ? 14 : 0, Math.round((count / chartMax) * 100))}%`;
    barTrack.append(bar);
    const dayLabel = document.createElement("span");
    dayLabel.className = "recap-day-label";
    dayLabel.textContent = label;
    column.append(countLabel, barTrack, dayLabel);
    chart.append(column);
  });

  let message;
  if (state.habits.length === 0) {
    message = "Add a habit and your weekly wins will show up here.";
  } else if (daysWithWins === 0) {
    message = "A fresh week is a fresh start. Your first small win will count.";
  } else if (daysWithWins >= goal) {
    message = `You reached your ${goal}-day goal. Look at you showing up!`;
  } else {
    const remaining = goal - daysWithWins;
    message = `${remaining} ${remaining === 1 ? "more day" : "more days"} with a win to reach your weekly goal.`;
  }
  document.querySelector("#recap-message").textContent = message;
}

function render() {
  renderHeader();
  renderWeek();
  renderHabits();
  renderProgress();
  renderWeeklyRecap();
  scheduleReminder();
}

function toggleHabit(id) {
  const key = dateKey(selectedDate);
  const day = completionFor(key);
  if (day[id]) {
    delete day[id];
    if (Object.keys(day).length === 0) delete state.completions[key];
    showToast("Habit unchecked. You can try again anytime.");
  } else {
    if (!state.completions[key]) state.completions[key] = {};
    state.completions[key][id] = true;
    showToast("A tiny win, and it counts.");
  }
  saveState();
  render();
}

function removeHabit(habit) {
  const shouldRemove = window.confirm(`Remove "${habit.name}" and its past check-ins?`);
  if (!shouldRemove) return;

  state.habits = state.habits.filter((item) => item.id !== habit.id);
  Object.keys(state.completions).forEach((key) => {
    delete state.completions[key][habit.id];
    if (Object.keys(state.completions[key]).length === 0) delete state.completions[key];
  });
  saveState();
  render();
  showToast("Habit removed.");
}

function openHabitForm() {
  habitForm.reset();
  document.querySelector("#habit-target").value = String(currentProfile.weeklyTarget);
  habitForm.hidden = false;
  habitNameInput.focus();
}

document.querySelector("#add-habit-button").addEventListener("click", openHabitForm);
document.querySelector("#empty-add-button").addEventListener("click", openHabitForm);
document.querySelector("#cancel-add").addEventListener("click", () => {
  habitForm.reset();
  habitForm.hidden = true;
});

habitForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = habitNameInput.value.trim();
  const categoryInput = document.querySelector("#habit-category");
  const category = categoryInput.value.trim();
  if (!name) {
    habitNameInput.focus();
    return;
  }
  if (!category) {
    categoryInput.focus();
    return;
  }

  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `habit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  state.habits.push({
    id,
    name,
    category,
    emoji: document.querySelector("#habit-icon").value,
    daysPerWeek: Number(document.querySelector("#habit-target").value)
  });
  saveState();
  habitForm.reset();
  habitForm.hidden = true;
  render();
  showToast("Your new habit is ready.");
});

document.querySelector("#previous-week").addEventListener("click", () => {
  displayedWeek = shiftDate(displayedWeek, -7);
  selectedDate = shiftDate(selectedDate, -7);
  render();
});

document.querySelector("#next-week").addEventListener("click", () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (displayedWeek >= startOfWeek(today)) return;
  displayedWeek = shiftDate(displayedWeek, 7);
  selectedDate = shiftDate(selectedDate, 7);
  render();
});

function hasFirebaseConfig() {
  return Boolean(
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith("YOUR_") &&
    firebaseConfig.authDomain &&
    !firebaseConfig.authDomain.startsWith("YOUR_") &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.startsWith("YOUR_") &&
    firebaseConfig.appId &&
    !firebaseConfig.appId.startsWith("YOUR_")
  );
}

function showAuthError(message) {
  authStatus.textContent = message;
  authStatus.classList.add("is-error");
}

function showOnboarding() {
  authGate.hidden = true;
  appShell.hidden = true;
  onboardingScreen.hidden = false;
  profileForm.reset();
  document.querySelector("#onboarding-profile-name").textContent =
    currentUser.displayName || currentUser.email || "Your profile";
  onboardingAccount.textContent = currentUser.email
    ? `Signed in as ${currentUser.email}. If this isn't the account where you saved progress, sign out and choose your usual Google account.`
    : "If this isn't the account where you saved progress, sign out and choose your usual Google account.";

  profileForm.elements.namedItem("displayName").value =
    currentProfile?.displayName || currentUser.displayName || "";
  profileForm.elements.namedItem("weeklyTarget").value =
    String(currentProfile?.weeklyTarget || 5);
  profileForm.elements.namedItem("routineTime").value =
    currentProfile?.routineTime || "flexible";
  profileForm.querySelectorAll('input[name="focus"]').forEach((input) => {
    input.checked = input.value === currentProfile?.focus;
  });
  profileCancel.hidden = !currentProfile;
  profileSubmit.firstChild.textContent = currentProfile ? "Save my preferences " : "Build my routine ";
  profileError.hidden = true;
  profileError.textContent = "";
}

function showDashboard() {
  authGate.hidden = true;
  onboardingScreen.hidden = true;
  appShell.hidden = false;
  render();
  loadReminderSettings();
}

function reminderStorageKey() {
  if (!currentUser) throw new Error("Sign in before changing reminder settings.");
  return `${REMINDER_STORAGE_PREFIX}${currentUser.uid}`;
}

function setReminderBusy(isBusy) {
  reminderTimeInput.disabled = isBusy;
  reminderSaveButton.disabled = isBusy;
  reminderDisableButton.disabled = isBusy || !reminderEnabled;
}

function saveReminderSettings() {
  localStorage.setItem(reminderStorageKey(), JSON.stringify({
    enabled: reminderEnabled,
    time: reminderTimeInput.value,
    lastSentDate: reminderLastSentDate
  }));
}

function loadReminderSettings() {
  window.clearTimeout(reminderTimeout);
  reminderEnabled = false;
  savedReminderTime = "18:00";
  reminderLastSentDate = null;
  reminderTimeInput.value = "18:00";
  reminderDisableButton.hidden = true;
  reminderSaveButton.textContent = "Enable reminder";

  if (!window.isSecureContext || !("Notification" in window) || !("serviceWorker" in navigator)) {
    reminderStatus.textContent = "Browser notifications aren’t supported here.";
    reminderTimeInput.disabled = true;
    reminderSaveButton.disabled = true;
    return;
  }

  try {
    const saved = localStorage.getItem(reminderStorageKey());
    if (saved !== null) {
      const settings = JSON.parse(saved);
      if (settings === null || typeof settings !== "object" ||
          typeof settings.enabled !== "boolean" ||
          !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(settings.time || "") ||
          (settings.lastSentDate !== null &&
            !/^\d{4}-\d{2}-\d{2}$/.test(settings.lastSentDate))) {
        throw new Error("Saved reminder settings have an unexpected format.");
      }
      reminderEnabled = settings.enabled;
      savedReminderTime = settings.time;
      reminderTimeInput.value = savedReminderTime;
      reminderLastSentDate = settings.lastSentDate;
    }

    reminderSaveButton.textContent = reminderEnabled ? "Save reminder" : "Enable reminder";
    reminderDisableButton.hidden = !reminderEnabled;
    reminderTimeInput.disabled = false;
    reminderSaveButton.disabled = false;
    reminderDisableButton.disabled = !reminderEnabled;

    if (reminderEnabled && Notification.permission !== "granted") {
      reminderStatus.textContent = "Reminders are on, but notifications are blocked in your browser settings.";
    } else {
      reminderStatus.textContent = reminderEnabled
        ? `Your daily reminder is set for ${reminderTimeInput.value}.`
        : "Reminders are off.";
    }
  } catch (error) {
    console.error("Could not load reminder settings:", error);
    reminderStatus.textContent = `Couldn’t read saved reminder settings: ${error.message}`;
    reminderTimeInput.disabled = false;
    reminderSaveButton.disabled = false;
  }

  scheduleReminder();
}

function scheduleReminder() {
  window.clearTimeout(reminderTimeout);
  reminderTimeout = null;
  const generation = ++reminderGeneration;
  if (!reminderEnabled || appShell.hidden || !currentUser) return;

  const now = new Date();
  const today = dateKey(now);
  const [hours, minutes] = savedReminderTime.split(":").map(Number);
  const dueAt = new Date(now);
  dueAt.setHours(hours, minutes, 0, 0);
  const dueToday = reminderLastSentDate !== today &&
    !hasWinOn(today) &&
    (now < dueAt || now.getTime() - dueAt.getTime() <= 5 * 60 * 1000);

  if (!dueToday) dueAt.setDate(dueAt.getDate() + 1);
  reminderTimeout = window.setTimeout(
    () => showDailyReminder(dateKey(dueAt), generation),
    Math.max(0, dueAt.getTime() - now.getTime())
  );
}

async function showDailyReminder(expectedDate, generation) {
  reminderTimeout = null;
  if (generation !== reminderGeneration || !reminderEnabled || appShell.hidden || !currentUser) return;

  const now = new Date();
  const today = dateKey(now);
  const [hours, minutes] = savedReminderTime.split(":").map(Number);
  const dueAt = new Date(now);
  dueAt.setHours(hours, minutes, 0, 0);
  const minutesLate = Math.floor((now.getTime() - dueAt.getTime()) / 60000);

  if (expectedDate !== today || reminderLastSentDate === today || hasWinOn(today) ||
      minutesLate < 0 || minutesLate > 5) {
    scheduleReminder();
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    if (generation !== reminderGeneration || !reminderEnabled || appShell.hidden) return;
    await registration.showNotification("A little reminder for you", {
      body: "Your tiny wins are waiting. One small step is enough.",
      icon: "./icons/tinywins-192.png",
      tag: "tinywins-daily-reminder",
      data: { url: "./" }
    });
    reminderLastSentDate = today;
    try {
      saveReminderSettings();
      reminderStatus.textContent = "Your gentle reminder was sent.";
    } catch (error) {
      console.error("Could not save the reminder delivery date:", error);
      reminderStatus.textContent = "Reminder sent, but its delivery couldn’t be recorded in this browser.";
    }
  } catch (error) {
    console.error("Could not show the Tiny Wins reminder:", error);
    reminderStatus.textContent = `Couldn’t show your reminder: ${error.message}`;
  } finally {
    scheduleReminder();
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !appShell.hidden) scheduleReminder();
});

window.addEventListener("focus", () => {
  if (!appShell.hidden) scheduleReminder();
});

reminderSaveButton.addEventListener("click", async () => {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(reminderTimeInput.value)) {
    reminderStatus.textContent = "Choose a valid reminder time.";
    return;
  }

  setReminderBusy(true);
  reminderStatus.textContent = "Setting up your daily reminder…";
  const wasEnabled = reminderEnabled;
  const previousTime = savedReminderTime;
  try {
    const permission = Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission !== "granted") {
      throw new Error(permission === "denied"
        ? "Notifications are blocked. Allow them in your browser settings and try again."
        : "Notification permission wasn’t granted.");
    }

    await navigator.serviceWorker.ready;
    reminderEnabled = true;
    savedReminderTime = reminderTimeInput.value;
    saveReminderSettings();
    reminderSaveButton.textContent = "Save reminder";
    reminderDisableButton.hidden = false;
    reminderStatus.textContent = `Your daily reminder is set for ${savedReminderTime} while Tiny Wins is open.`;
    scheduleReminder();
  } catch (error) {
    reminderEnabled = wasEnabled;
    savedReminderTime = previousTime;
    reminderTimeInput.value = previousTime;
    scheduleReminder();
    console.error("Could not enable the daily reminder:", error);
    reminderStatus.textContent = `Couldn’t set up reminders: ${error.message}`;
  } finally {
    setReminderBusy(false);
  }
});

reminderDisableButton.addEventListener("click", () => {
  const previousTime = savedReminderTime;
  const previousLastSentDate = reminderLastSentDate;
  reminderEnabled = false;
  reminderLastSentDate = null;
  scheduleReminder();
  try {
    localStorage.removeItem(reminderStorageKey());
    savedReminderTime = "18:00";
    reminderTimeInput.value = "18:00";
    reminderSaveButton.textContent = "Enable reminder";
    reminderDisableButton.hidden = true;
    reminderStatus.textContent = "Reminders are off.";
  } catch (error) {
    reminderEnabled = true;
    reminderLastSentDate = previousLastSentDate;
    savedReminderTime = previousTime;
    reminderTimeInput.value = previousTime;
    scheduleReminder();
    console.error("Could not turn off the daily reminder:", error);
    reminderStatus.textContent = `Couldn’t turn off reminders: ${error.message}`;
  }
  setReminderBusy(false);
});

profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const isEditing = currentProfile !== null;
  const formData = new FormData(profileForm);
  const focus = formData.get("focus");
  if (!Object.hasOwn(focusLabels, focus)) {
    profileError.textContent = "Choose a focus so we can suggest a routine that fits you.";
    profileError.hidden = false;
    return;
  }

  const profile = {
    displayName: String(formData.get("displayName") || "").trim(),
    focus,
    weeklyTarget: Number(formData.get("weeklyTarget")),
    routineTime: String(formData.get("routineTime"))
  };
  if (!isValidProfile(profile) || !saveProfile(profile)) return;

  state = loadState();
  if (!isEditing && state.habits.length === 0) state = createDefaultState(profile.focus);
  saveState();
  profileError.hidden = true;
  showDashboard();
  showToast(isEditing ? "Your routine is personalized." : "Your routine is ready.");
});

profileCancel.addEventListener("click", showDashboard);
document.querySelector("#edit-profile-button").addEventListener("click", showOnboarding);

function startGoogleSignIn() {
  if (!hasFirebaseConfig()) return;

  try {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    firestoreDb = getFirestore(app);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    googleSignInButton.addEventListener("click", async () => {
      googleSignInButton.disabled = true;
      authStatus.classList.remove("is-error");
      authStatus.textContent = "Opening Google sign-in…";
      try {
        await signInWithPopup(auth, provider);
      } catch (error) {
        console.error("Google sign-in failed:", error);
        if (error.code === "auth/popup-blocked") {
          authStatus.classList.remove("is-error");
          authStatus.textContent = "The pop-up was blocked. Continuing with Google in this tab…";
          try {
            await signInWithRedirect(auth, provider);
            return;
          } catch (redirectError) {
            console.error("Google redirect sign-in failed:", redirectError);
            showAuthError(`Sign-in failed: ${redirectError.message}`);
            googleSignInButton.disabled = false;
            return;
          }
        }
        showAuthError(`Sign-in failed: ${error.message}`);
        googleSignInButton.disabled = false;
      }
    });

    const signOutProfile = async () => {
      if (!window.confirm("Are you sure you want to sign out?")) return;

      signOutButton.disabled = true;
      document.querySelector("#onboarding-signout-button").disabled = true;
      recoverySignOutButton.disabled = true;
      try {
        await signOut(auth);
      } catch (error) {
        console.error("Sign-out failed:", error);
        if (onboardingScreen.hidden) {
          showToast(`Could not sign out: ${error.message}`);
        } else {
          profileError.textContent = `Could not sign out: ${error.message}`;
          profileError.hidden = false;
        }
      } finally {
        signOutButton.disabled = false;
        document.querySelector("#onboarding-signout-button").disabled = false;
        recoverySignOutButton.disabled = false;
      }
    };
    signOutButton.addEventListener("click", signOutProfile);
    document.querySelector("#onboarding-signout-button").addEventListener("click", signOutProfile);
    recoverySignOutButton.addEventListener("click", signOutProfile);

    authStatus.textContent = "Checking your profile…";
    onAuthStateChanged(auth, (user) => {
      accountSyncGeneration += 1;
      accountSyncReady = false;
      if (accountSyncListener) accountSyncListener();
      accountSyncListener = null;
      profileSubmit.disabled = false;
      setSyncStatus("");
      window.clearTimeout(reminderTimeout);
      reminderTimeout = null;
      reminderGeneration += 1;
      reminderEnabled = false;
      savedReminderTime = "18:00";
      reminderLastSentDate = null;
      currentUser = user;
      if (!user) {
        currentProfile = null;
        state = createDefaultState();
        appShell.hidden = true;
        onboardingScreen.hidden = true;
        authGate.hidden = false;
        googleSignInButton.disabled = false;
        googleSignInButton.hidden = false;
        retryAccountSyncButton.hidden = true;
        recoverySignOutButton.hidden = true;
        authStatus.classList.remove("is-error");
        authStatus.textContent = "Sign in with Google to continue.";
        return;
      }

      currentProfile = loadProfile();
      if (!currentProfile) {
        state = loadState(undefined, true);
      } else {
        state = loadState();
        selectedDate = new Date();
        selectedDate.setHours(0, 0, 0, 0);
        displayedWeek = startOfWeek(selectedDate);
        showDashboard();
      }
      initializeAccountSync(user);
    }, (error) => {
      console.error("Could not check the signed-in profile:", error);
      showAuthError(`Couldn't check your profile: ${error.message}`);
      googleSignInButton.disabled = false;
    });
  } catch (error) {
    console.error("Could not initialize Firebase Authentication:", error);
    showAuthError(`Firebase setup error: ${error.message}`);
  }
}

if (hasFirebaseConfig()) {
  setupHelp.hidden = true;
  googleSignInButton.disabled = true;
  startGoogleSignIn();
} else {
  googleSignInButton.disabled = true;
  authStatus.textContent = "Google sign-in is not connected yet.";
}
