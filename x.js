/* ============================================================
   BrowserSlop — X home timeline sync
   Uses OAuth 2.0 Authorization Code + PKCE with chrome.identity.
   Tokens remain in the browser's local extension storage.
   ============================================================ */
"use strict";

const XSync = (() => {
  const SCOPES = "tweet.read users.read offline.access";
  const LS_KEY = "browserslop.v1.xauth";
  const API = "https://api.x.com/2";
  const EDGE_CAL_X_USER = {
    id: "1505165148062900226",
    username: "TararaDotJoshua",
    name: "Joshua T"
  };
  const available =
    typeof chrome !== "undefined" && !!(chrome.identity && chrome.identity.launchWebAuthFlow);

  let auth = null;
  let cachedTimeline = null;
  try { auth = JSON.parse(localStorage.getItem(LS_KEY)); } catch { auth = null; }
  // Authentication records are versioned so changes to X's broken user lookup
  // workarounds always force a clean authorization rather than reusing a token
  // saved by an incompatible flow.
  if (auth && auth.authVersion !== 5) {
    localStorage.removeItem(LS_KEY);
    auth = null;
  }

  function save(value) {
    auth = value;
    cachedTimeline = null;
    if (value) localStorage.setItem(LS_KEY, JSON.stringify(value));
    else localStorage.removeItem(LS_KEY);
  }

  function randomUrlSafe(bytes = 32) {
    const data = new Uint8Array(bytes);
    crypto.getRandomValues(data);
    return btoa(String.fromCharCode(...data))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function sha256UrlSafe(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function credentialFingerprint(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12);
  }

  function opaqueTokenKind(value) {
    try {
      const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
      if (/:at:\d+$/.test(decoded)) return "access";
      if (/:rt:\d+$/.test(decoded)) return "refresh";
    } catch { /* invalid or non-X token */ }
    return "unknown";
  }

  function parseError(response, data) {
    const nested = Array.isArray(data?.errors)
      ? data.errors.flatMap((item) => [item?.detail, item?.title, item?.message, item?.code])
      : [];
    const parts = [
      data?.detail,
      data?.title,
      data?.error_description,
      data?.error,
      data?.message,
      data?.code,
      ...nested
    ].filter((value) => value !== undefined && value !== null && String(value).trim());
    return [...new Set(parts.map(String))].join(" — ") || `X API error ${response.status}`;
  }

  async function tokenRequest(params, clientId, clientSecret) {
    if (!clientId || !clientSecret) {
      throw new Error("Enter the X OAuth 2.0 Client ID and Client Secret in Settings");
    }
    let result;
    try {
      const brokerResponse = await fetch("http://127.0.0.1:8766/x-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret, params })
      });
      result = await brokerResponse.json();
    } catch {
      throw new Error("The local X broker is not running. Start Start-X-Broker.ps1, then try again.");
    }
    const response = {
      ok: !!result?.ok,
      status: Number(result?.status || 0)
    };
    const data = result?.data || null;
    const message = [data?.detail, data?.title, data?.error_description, data?.error]
      .filter(Boolean).join(" — ");
    const credentialDiagnostic = [
      `exchange_context=${result?.context || "unknown"}`,
      `client_id=${clientId}`,
      `secret_length=${clientSecret.length}`,
      `secret_fingerprint=${await credentialFingerprint(clientSecret)}`
    ].join("; ");
    if (/missing valid authorization header/i.test(message)) {
      throw new Error(`X rejected the confidential-client credentials (${credentialDiagnostic}).`);
    }
    if (!response.ok) throw new Error(`${parseError(response, data)} (${credentialDiagnostic})`);
    if (!data?.access_token) {
      throw new Error("X completed the token exchange but did not return an access token");
    }
    return data;
  }

  function launch(url) {
    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url, interactive: true }, (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          reject(new Error(chrome.runtime.lastError?.message || "Sign-in was cancelled"));
          return;
        }
        resolve(responseUrl);
      });
    });
  }

  async function refresh() {
    if (!auth?.refresh || !auth?.clientId || !auth?.clientSecret) {
      throw new Error("Your X sign-in has ended — reconnect in Settings");
    }
    const tokens = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: auth.refresh,
      client_id: auth.clientId
    }, auth.clientId, auth.clientSecret);
    save({
      ...auth,
      token: tokens.access_token,
      refresh: tokens.refresh_token || auth.refresh,
      tokenType: tokens.token_type || auth.tokenType || "unknown",
      grantedScope: tokens.scope || auth.grantedScope || "unknown",
      tokenShape: /^AAAA/.test(tokens.access_token) ? "app-only-looking" : "user-looking",
      exp: Date.now() + (Number(tokens.expires_in || 7200) - 90) * 1000
    });
  }

  async function ensureToken() {
    if (!auth?.token) throw new Error("Connect X in Settings first");
    if (auth.exp > Date.now()) return;
    await refresh();
  }

  async function api(path) {
    await ensureToken();
    let result;
    try {
      const brokerPath = path.startsWith("/2/") ? path : `/2${path}`;
      const brokerResponse = await fetch("http://127.0.0.1:8766/x-api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: auth.token, path: brokerPath, method: "GET" })
      });
      result = await brokerResponse.json();
    } catch {
      throw new Error("The local X broker is not running. Start Start-X-Broker.ps1, then try again.");
    }
    const response = {
      ok: !!result?.ok,
      status: Number(result?.status || 0),
      headers: {
        get: (name) => name.toLowerCase() === "www-authenticate" ? result?.wwwAuthenticate : null
      }
    };
    const data = result?.data || null;
    if (response.status === 401) {
      const reason = parseError(response, data);
      const endpoint = path.split("?")[0];
      const challenge = response.headers?.get?.("www-authenticate");
      const diagnostic = [
        `endpoint=${endpoint}`,
        `api_context=${result?.context || "unknown"}`,
        `client_id=${auth?.clientId || "unknown"}`,
        `token_type=${auth?.tokenType || "unknown"}`,
        `token_shape=${auth?.tokenShape || "unknown"}`,
        `scopes=${auth?.grantedScope || "unknown"}`,
        challenge ? `www-authenticate=${challenge}` : null
      ].filter(Boolean).join("; ");
      save(null);
      throw new Error(
        `X rejected the user token (${reason}; ${diagnostic}). Check that this Client ID belongs to a Web App/confidential client, ` +
        "OAuth 2.0 is enabled, the app is in the Pay-per-use Production environment, and the saved redirect URL, credentials, and scopes exactly match BrowserSlop."
      );
    }
    if (!response.ok) {
      throw new Error(
        `${parseError(response, data)} (endpoint=${path.split("?")[0]}; ` +
        `api_context=${result?.context || "unknown"}; status=${response.status})`
      );
    }
    return data;
  }

  return {
    available,
    connected: () => !!(auth?.token),

    async importConsoleTokens(clientId, clientSecret, accessToken, refreshToken) {
      if (!clientId || !clientSecret || !accessToken || !refreshToken) {
        throw new Error("Enter the Client ID, Client Secret, Access Token, and Refresh Token");
      }
      let importedAccessToken = accessToken;
      let importedRefreshToken = refreshToken;
      const firstKind = opaqueTokenKind(importedAccessToken);
      const secondKind = opaqueTokenKind(importedRefreshToken);
      if (firstKind === "refresh" && secondKind === "access") {
        [importedAccessToken, importedRefreshToken] = [importedRefreshToken, importedAccessToken];
      } else if (firstKind !== "access" || secondKind !== "refresh") {
        throw new Error(
          `The console token values are not a valid access/refresh pair ` +
          `(first=${firstKind}, length=${accessToken.length}; second=${secondKind}, length=${refreshToken.length})`
        );
      }
      save({
        authVersion: 5,
        token: importedAccessToken,
        refresh: importedRefreshToken,
        tokenType: "bearer",
        grantedScope: "users.read tweet.read offline.access",
        tokenShape: /^AAAA/.test(importedAccessToken) ? "app-only-looking" : "user-looking",
        exp: Date.now() + (2 * 60 * 60 - 90) * 1000,
        clientId,
        clientSecret,
        user: EDGE_CAL_X_USER
      });

      // Validate the exact endpoint BrowserSlop needs. Console-issued tokens have
      // succeeded here even while Authorization Code tokens from the same app
      // are rejected by X's resource server.
      const params = new URLSearchParams({ max_results: "10" });
      const value = await api(
        `/users/${EDGE_CAL_X_USER.id}/timelines/reverse_chronological?${params}`
      );
      // This request only verifies the token. Let timeline() fetch the richer
      // post, metrics, author, and media fields used by the widget.
      cachedTimeline = null;
    },

    async signIn(clientId, clientSecret) {
      if (!available) {
        throw new Error("X sign-in only works when BrowserSlop is loaded as a browser extension");
      }
      const redirect = chrome.identity.getRedirectURL();
      const state = randomUrlSafe();
      const verifier = randomUrlSafe(64);
      const challenge = await sha256UrlSafe(verifier);
      const query = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirect,
        scope: SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256"
      });
      const responseUrl = await launch(`https://x.com/i/oauth2/authorize?${query}`);
      const response = new URL(responseUrl);
      if (response.searchParams.get("state") !== state) throw new Error("X sign-in state did not match");
      const code = response.searchParams.get("code");
      if (!code) throw new Error(response.searchParams.get("error") || "No authorization code returned");

      const tokens = await tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
        client_id: clientId,
        code_verifier: verifier
      }, clientId, clientSecret);
      save({
        authVersion: 4,
        token: tokens.access_token,
        refresh: tokens.refresh_token || null,
        tokenType: tokens.token_type || "unknown",
        grantedScope: tokens.scope || "unknown",
        tokenShape: /^AAAA/.test(tokens.access_token) ? "app-only-looking" : "user-looking",
        exp: Date.now() + (Number(tokens.expires_in || 7200) - 90) * 1000,
        clientId,
        clientSecret,
        user: EDGE_CAL_X_USER
      });
      // X's /2/users/me lookup currently rejects some otherwise usable OAuth
      // 2.0 user tokens. The official xurl client works around this by keeping
      // the explicitly supplied identity instead of making lookup a login gate.
    },

    signOut() { save(null); },

    async timeline(force = false) {
      if (!force && cachedTimeline && cachedTimeline.at > Date.now() - 5 * 60 * 1000) {
        return cachedTimeline.value;
      }
      const id = auth?.user?.id;
      if (!id) throw new Error("Reconnect X so BrowserSlop can identify the authorized account");
      const params = new URLSearchParams({
        max_results: "10",
        "tweet.fields": "author_id,created_at,public_metrics,attachments,conversation_id,referenced_tweets,entities,possibly_sensitive",
        expansions: "author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id",
        "user.fields": "name,username,profile_image_url,verified",
        "media.fields": "type,url,preview_image_url,width,height,alt_text,variants"
      });
      const value = await api(`/users/${encodeURIComponent(id)}/timelines/reverse_chronological?${params}`);
      cachedTimeline = { at: Date.now(), value };
      return value;
    }
  };
})();
