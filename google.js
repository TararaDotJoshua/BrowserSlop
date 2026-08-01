/* ============================================================
   BrowserSlop — Google Calendar / Tasks sync
   Uses chrome.identity.launchWebAuthFlow (works in Edge and
   Chrome) with an OAuth client ID the user supplies in
   Settings. See README for the one-time Google Cloud setup.
   ============================================================ */
"use strict";

const GoogleSync = (() => {
  const SCOPES =
    "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/tasks";
  const LS_KEY = "browserslop.v1.gauth";

  const available =
    typeof chrome !== "undefined" && !!(chrome.identity && chrome.identity.launchWebAuthFlow);

  let auth = null;
  try { auth = JSON.parse(localStorage.getItem(LS_KEY)); } catch { auth = null; }

  function save(a) {
    auth = a;
    if (a) localStorage.setItem(LS_KEY, JSON.stringify(a));
    else localStorage.removeItem(LS_KEY);
  }

  const connected = () => !!(auth && auth.token);

  function flow(clientId, interactive) {
    const redirect = chrome.identity.getRedirectURL();
    const url =
      "https://accounts.google.com/o/oauth2/v2/auth" +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirect)}` +
      "&response_type=token" +
      `&scope=${encodeURIComponent(SCOPES)}` +
      (interactive ? "&prompt=select_account" : "&prompt=none");
    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url, interactive }, (resp) => {
        if (chrome.runtime.lastError || !resp) {
          return reject(new Error(chrome.runtime.lastError?.message || "Sign-in was cancelled"));
        }
        const frag = new URLSearchParams(new URL(resp).hash.slice(1));
        const token = frag.get("access_token");
        if (!token) return reject(new Error(frag.get("error") || "No token returned"));
        const expires = Number(frag.get("expires_in") || 3600);
        save({ token, exp: Date.now() + (expires - 90) * 1000, clientId });
        resolve();
      });
    });
  }

  async function ensureToken() {
    if (auth && auth.token && auth.exp > Date.now()) return;
    if (!available || !auth || !auth.clientId) throw new Error("Not signed in");
    await flow(auth.clientId, false); // silent refresh via prompt=none
  }

  async function api(path, opts = {}) {
    await ensureToken();
    const resp = await fetch("https://www.googleapis.com" + path, {
      ...opts,
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
        ...(opts.headers || {})
      }
    });
    if (resp.status === 401) {
      save(null);
      throw new Error("Google session expired — reconnect in Settings");
    }
    if (!resp.ok) throw new Error(`Google API error ${resp.status}`);
    return resp.status === 204 ? null : resp.json();
  }

  return {
    available,
    connected,

    signIn(clientId) {
      if (!available) {
        return Promise.reject(
          new Error("Google sign-in only works when BrowserSlop is loaded as a browser extension")
        );
      }
      return flow(clientId, true);
    },

    async signOut() {
      if (auth && auth.token) {
        try {
          await fetch(`https://oauth2.googleapis.com/revoke?token=${auth.token}`, { method: "POST" });
        } catch { /* revoke is best-effort */ }
      }
      save(null);
    },

    async events(dayStart, dayEnd) {
      const q = new URLSearchParams({
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "50"
      });
      const data = await api(`/calendar/v3/calendars/primary/events?${q}`);
      return data.items || [];
    },

    async tasks() {
      const data = await api(
        "/tasks/v1/lists/@default/tasks?showCompleted=true&showHidden=true&maxResults=100"
      );
      return data.items || [];
    },

    addTask(title) {
      return api("/tasks/v1/lists/@default/tasks", {
        method: "POST",
        body: JSON.stringify({ title })
      });
    },

    setTaskDone(id, done) {
      return api(`/tasks/v1/lists/@default/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(done ? { status: "completed" } : { status: "needsAction", completed: null })
      });
    },

    deleteTask(id) {
      return api(`/tasks/v1/lists/@default/tasks/${id}`, { method: "DELETE" });
    }
  };
})();
