import assert from "node:assert/strict";
import {
  buildCallPayload,
  normalizePhoneNumber,
  resolveAgentMapping
} from "../src/netsapiens-utils.mjs";

assert.equal(normalizePhoneNumber("(555) 123-4567"), "+15551234567");
assert.equal(normalizePhoneNumber("+44 20 7123 4567"), "+442071234567");
assert.equal(normalizePhoneNumber("tel:18585551212 x77"), "+18585551212");
assert.equal(normalizePhoneNumber(""), "");

const env = {
  NETSAPIENS_AGENT_MAP_JSON: JSON.stringify({
    4: {
      domain: "example.com",
      user: "1004",
      callerIdNumber: "15550001111"
    }
  })
};
const mapping = resolveAgentMapping(env, "4");
assert.deepEqual(mapping, {
  domain: "example.com",
  user: "1004",
  callOrigUser: "1004@example.com",
  callerIdNumber: "15550001111",
  callbackCallerIdNumber: ""
});

assert.throws(
  () => resolveAgentMapping({ NETSAPIENS_AGENT_MAP_JSON: "{}" }, "9"),
  /No NetSapiens mapping/
);

assert.deepEqual(
  buildCallPayload({
    callId: "halo-123-test",
    phoneNumber: "5551234567",
    mapping,
    env: {}
  }),
  {
    synchronous: "no",
    "call-id": "halo-123-test",
    "dial-rule-application": "call",
    "call-term-user": "+15551234567",
    "call-orig-user": "1004@example.com",
    "caller-id-number": "15550001111"
  }
);

console.log("netsapiens-utils tests passed");
