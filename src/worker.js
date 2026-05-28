import {
  buildCallPayload,
  compactObject,
  normalizePhoneNumber,
  resolveAgentMapping
} from "./netsapiens-utils.mjs";

const tokenCache = {
  accessToken: "",
  expiresAt: 0
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Integration-Token"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "halo-netsapiens-click-to-call" });
      }

      if (url.pathname === "/api/click-to-call" && request.method === "POST") {
        const payload = await request.json();
        requireIntegrationAuth(request, env, payload);
        return json(await handleClickToCall(payload, env));
      }

      return json({ ok: false, error: "Not found" }, 404);
    } catch (error) {
      const status = error.status || 500;
      return json({ ok: false, error: error.message || String(error) }, status);
    }
  }
};

export async function handleClickToCall(payload, env) {
  const ticketId = Number(payload.ticketId || payload.haloTicketId);
  const haloAgentId = String(payload.haloAgentId || payload.agentId || payload.currentAgentId || "").trim();
  const phoneNumber = normalizePhoneNumber(payload.phoneNumber || payload.dialablePhone);

  if (!ticketId) throw new Error("ticketId is required.");
  if (!haloAgentId) throw new Error("haloAgentId is required.");
  if (!phoneNumber) throw new Error("phoneNumber is required.");

  const mapping = resolveAgentMapping(env, haloAgentId);
  const callId = generateCallId(ticketId);
  const netSapiensPath = `/ns-api/v2/domains/${encodeURIComponent(mapping.domain)}/users/${encodeURIComponent(mapping.user)}/calls`;
  const callPayload = buildCallPayload({ callId, phoneNumber, mapping, env });
  const callResult = await netSapiensRequest(env, netSapiensPath, {
    method: "POST",
    body: callPayload
  });

  const notePayload = buildHaloNotePayload({
    ticketId,
    haloAgentId,
    phoneNumber,
    callId,
    ticketTitle: payload.ticketTitle,
    contactName: payload.contactName,
    clientName: payload.clientName
  }, env);

  try {
    const noteResult = await haloRequest(env, "/api/Actions", {
      method: "POST",
      body: [notePayload]
    });
    return {
      ok: true,
      data: {
        callId,
        phoneNumber,
        netSapiens: callResult.data,
        haloNote: noteResult.data
      },
      meta: {
        noteLogged: true,
        netSapiensPath
      }
    };
  } catch (error) {
    return {
      ok: true,
      warning: `NetSapiens call was accepted, but Halo note logging failed: ${error.message}`,
      data: {
        callId,
        phoneNumber,
        netSapiens: callResult.data
      },
      meta: {
        noteLogged: false,
        netSapiensPath
      }
    };
  }
}

function requireIntegrationAuth(request, env, payload = {}) {
  if (!env.INTEGRATION_SHARED_TOKEN) return;
  const bearer = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const headerToken = String(request.headers.get("X-Integration-Token") || "").trim();
  const bodyToken = String(payload.integrationToken || payload.sharedToken || "").trim();
  if (
    bearer === env.INTEGRATION_SHARED_TOKEN ||
    headerToken === env.INTEGRATION_SHARED_TOKEN ||
    bodyToken === env.INTEGRATION_SHARED_TOKEN
  ) return;
  const error = new Error("Unauthorized.");
  error.status = 401;
  throw error;
}

function buildHaloNotePayload(details, env) {
  const now = new Date().toISOString();
  const lines = [
    `NetSapiens call attempt started by Halo agent ${details.haloAgentId} to ${details.phoneNumber}.`,
    `Call ID: ${details.callId}.`,
    details.contactName ? `Contact: ${details.contactName}.` : "",
    details.clientName ? `Client: ${details.clientName}.` : "",
    details.ticketTitle ? `Ticket: ${details.ticketTitle}.` : ""
  ].filter(Boolean);

  return compactObject({
    ticket_id: Number(details.ticketId),
    outcome: env.HALO_NETSAPIENS_CALL_OUTCOME || "Private Note",
    hiddenfromuser: true,
    important: false,
    datetime: now,
    actiondatecreated: now,
    who_agentid: /^\d+$/.test(String(details.haloAgentId)) ? Number(details.haloAgentId) : undefined,
    note: lines.join("\n"),
    note_html: lines.map(line => `<p>${escapeHtml(line)}</p>`).join("")
  });
}

async function haloRequest(env, path, options = {}) {
  const accessToken = await getHaloAccessToken(env);
  const response = await fetch(new URL(path, env.HALO_RESOURCE_SERVER).toString(), {
    method: options.method || "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return checkedJsonResponse(response, "HaloPSA");
}

async function getHaloAccessToken(env) {
  validateHaloEnv(env);
  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt > now + 60000) {
    return tokenCache.accessToken;
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.HALO_CLIENT_ID,
    client_secret: env.HALO_CLIENT_SECRET,
    scope: env.HALO_SCOPE || "all"
  });

  const response = await fetch(env.HALO_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  const result = await checkedJsonResponse(response, "HaloPSA auth");
  if (!result.data?.access_token) {
    throw new Error("Unable to authenticate with HaloPSA.");
  }
  tokenCache.accessToken = result.data.access_token;
  tokenCache.expiresAt = now + ((result.data.expires_in || 3600) * 1000);
  return tokenCache.accessToken;
}

async function netSapiensRequest(env, path, options = {}) {
  const missing = ["NETSAPIENS_BASE_URL", "NETSAPIENS_API_KEY"].filter(key => !env[key]);
  if (missing.length) {
    throw new Error(`Missing Worker secret/variable: ${missing.join(", ")}`);
  }
  const response = await fetch(new URL(path, env.NETSAPIENS_BASE_URL).toString(), {
    method: options.method || "GET",
    headers: {
      "Authorization": `Bearer ${env.NETSAPIENS_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return checkedJsonResponse(response, "NetSapiens");
}

async function checkedJsonResponse(response, label) {
  const text = await response.text();
  const data = text ? safeJson(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.error || data?.code || `${label} API returned ${response.status}`);
  }
  return { ok: true, status: response.status, data };
}

function validateHaloEnv(env) {
  const missing = ["HALO_AUTH_URL", "HALO_RESOURCE_SERVER", "HALO_CLIENT_ID", "HALO_CLIENT_SECRET"]
    .filter(key => !env[key]);
  if (missing.length) {
    throw new Error(`Missing Worker secret/variable: ${missing.join(", ")}`);
  }
}

function generateCallId(ticketId) {
  const random = crypto.randomUUID();
  return `halo-${ticketId}-${random}`.slice(0, 80);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
