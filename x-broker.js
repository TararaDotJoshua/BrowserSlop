/*
 * BrowserSlop X OAuth loopback broker.
 *
 * X rejects confidential token exchanges made from a browser-extension
 * origin. This process forwards only the OAuth token request from localhost.
 * It binds to loopback, stores nothing, and never logs credentials or tokens.
 */
"use strict";

const http = require("node:http");

const HOST = "127.0.0.1";
const PORT = Number(process.env.BROWSERSLOP_X_BROKER_PORT || 8766);
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const MAX_BODY_BYTES = 64 * 1024;

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Max-Age", "600");
}

function sendJson(response, status, value) {
  setCors(response);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function isLoopback(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("Request body must be valid JSON")); }
    });
    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  if (!isLoopback(request.socket.remoteAddress)) {
    sendJson(response, 403, { ok: false, error: "Loopback connections only" });
    return;
  }

  if (request.method === "OPTIONS") {
    setCors(response);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { ok: true, service: "browserslop-x-broker" });
    return;
  }

  if (request.method === "POST" && request.url === "/x-api") {
    try {
      const { accessToken, path, method = "GET", body } = await readJson(request);
      const normalizedMethod = String(method).toUpperCase();
      if (
        typeof accessToken !== "string" || !accessToken || accessToken.length > 2048 ||
        typeof path !== "string" || !path.startsWith("/2/") || path.includes("://") || path.length > 8192 ||
        !["GET", "POST", "DELETE"].includes(normalizedMethod)
      ) {
        sendJson(response, 400, {
          ok: false,
          status: 400,
          context: "local_node_broker_validation",
          data: { error: "invalid_request" }
        });
        return;
      }

      const headers = {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`
      };
      const fetchOptions = { method: normalizedMethod, headers };
      if (body !== undefined && normalizedMethod !== "GET") {
        headers["Content-Type"] = "application/json";
        fetchOptions.body = JSON.stringify(body);
      }

      const apiResponse = await fetch(`https://api.x.com${path}`, fetchOptions);
      const data = await apiResponse.json().catch(() => null);
      sendJson(response, 200, {
        ok: apiResponse.ok,
        status: apiResponse.status,
        data,
        context: "local_node_broker",
        wwwAuthenticate: apiResponse.headers.get("www-authenticate")
      });
    } catch (error) {
      sendJson(response, 502, {
        ok: false,
        status: 0,
        context: "local_node_broker",
        data: { error: "network_error", error_description: error?.message || String(error) }
      });
    }
    return;
  }

  if (request.method !== "POST" || request.url !== "/x-token") {
    sendJson(response, 404, { ok: false, error: "Not found" });
    return;
  }

  try {
    const { clientId, clientSecret, params } = await readJson(request);
    if (
      typeof clientId !== "string" || !clientId || clientId.length > 256 ||
      typeof clientSecret !== "string" || !clientSecret || clientSecret.length > 512 ||
      !params || typeof params !== "object" || Array.isArray(params)
    ) {
      sendJson(response, 400, { ok: false, status: 400, data: { error: "invalid_request" } });
      return;
    }

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`
      },
      body: new URLSearchParams(params)
    });
    const data = await tokenResponse.json().catch(() => null);
    sendJson(response, 200, {
      ok: tokenResponse.ok,
      status: tokenResponse.status,
      data,
      context: "local_node_broker"
    });
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      status: 0,
      context: "local_node_broker",
      data: { error: "network_error", error_description: error?.message || String(error) }
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`BrowserSlop X broker listening on http://${HOST}:${PORT}`);
});

server.on("error", (error) => {
  console.error(`BrowserSlop X broker failed: ${error.message}`);
  process.exitCode = 1;
});
