import assert from "node:assert/strict";
import worker from "../src/worker.js";

const baseEnv = {
  HALO_AUTH_URL: "https://halo.example.test/auth/token",
  HALO_RESOURCE_SERVER: "https://halo.example.test",
  HALO_CLIENT_ID: "halo-client",
  HALO_CLIENT_SECRET: "halo-secret",
  HALO_SCOPE: "all",
  NETSAPIENS_BASE_URL: "https://voice.example.test",
  NETSAPIENS_API_KEY: "voice-key",
  NETSAPIENS_AGENT_MAP_JSON: JSON.stringify({
    4: {
      domain: "example.com",
      user: "1004",
      callOrigUser: "1004@example.com",
      callerIdNumber: "15550001111"
    }
  }),
  INTEGRATION_SHARED_TOKEN: "test-token"
};

function clickRequest(payload, token = "test-token") {
  return new Request("https://worker.example.test/api/click-to-call", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
}

async function runClick(payload, env = baseEnv, token = "test-token") {
  const response = await worker.fetch(clickRequest(payload, token), env);
  return {
    status: response.status,
    body: await response.json()
  };
}

{
  const result = await runClick({ ticketId: 123, haloAgentId: "4" });
  assert.equal(result.status, 500);
  assert.match(result.body.error, /phoneNumber is required/);
}

{
  const result = await runClick({ ticketId: 123, phoneNumber: "5551234567", haloAgentId: "9" });
  assert.equal(result.status, 500);
  assert.match(result.body.error, /No NetSapiens mapping/);
}

{
  const result = await runClick({ ticketId: 123, phoneNumber: "5551234567", haloAgentId: "4" }, baseEnv, "wrong-token");
  assert.equal(result.status, 401);
}

{
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      body: typeof options.body === "string" ? JSON.parse(options.body) : null
    });
    if (String(url).includes("/ns-api/v2/")) {
      return Response.json({ accepted: true }, { status: 202 });
    }
    if (String(url).includes("/auth/token")) {
      return Response.json({ access_token: "halo-token", expires_in: 3600 });
    }
    if (String(url).includes("/api/Actions")) {
      return Response.json({ id: 77 });
    }
    return Response.json({ error: "unexpected" }, { status: 500 });
  };

  const result = await runClick({
    ticketId: 123,
    phoneNumber: "5551234567",
    haloAgentId: "4",
    ticketTitle: "Printer issue",
    contactName: "A. Customer",
    clientName: "Example Co"
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.meta.noteLogged, true);
  assert.equal(calls[0].body["call-term-user"], "+15551234567");
  assert.equal(calls[0].body["call-orig-user"], "1004@example.com");
  assert.match(calls.at(-1).body[0].note, /NetSapiens call attempt started/);
}

{
  let haloActionCalled = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/ns-api/v2/")) {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    if (String(url).includes("/api/Actions")) haloActionCalled = true;
    return Response.json({ access_token: "halo-token", expires_in: 3600 });
  };

  const result = await runClick({ ticketId: 123, phoneNumber: "5551234567", haloAgentId: "4" });
  assert.equal(result.status, 500);
  assert.match(result.body.error, /bad request/);
  assert.equal(haloActionCalled, false);
}

{
  globalThis.fetch = async (url) => {
    if (String(url).includes("/ns-api/v2/")) {
      return Response.json({ accepted: true }, { status: 202 });
    }
    if (String(url).includes("/auth/token")) {
      return Response.json({ access_token: "halo-token", expires_in: 3600 });
    }
    if (String(url).includes("/api/Actions")) {
      return Response.json({ error: "note failed" }, { status: 500 });
    }
    return Response.json({ error: "unexpected" }, { status: 500 });
  };

  const result = await runClick({ ticketId: 123, phoneNumber: "5551234567", haloAgentId: "4" });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.meta.noteLogged, false);
  assert.match(result.body.warning, /Halo note logging failed/);
}

console.log("worker tests passed");
