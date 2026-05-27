export function normalizePhoneNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutUri = raw.replace(/^tel:/i, "");
  const withoutExtension = withoutUri
    .replace(/\s*(?:ext\.?|x|extension)\s*\d+$/i, "")
    .trim();
  const hasPlus = withoutExtension.startsWith("+");
  const digits = withoutExtension.replace(/\D/g, "");
  if (!digits) return "";
  if (hasPlus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

export function parseAgentMap(value) {
  const text = String(value || "").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("NETSAPIENS_AGENT_MAP_JSON is not valid JSON.");
  }
}

export function resolveAgentMapping(env = {}, haloAgentId = "") {
  const agentId = String(haloAgentId || "").trim();
  if (!agentId) {
    throw new Error("haloAgentId is required.");
  }

  const map = parseAgentMap(env.NETSAPIENS_AGENT_MAP_JSON);
  const mapping = map[agentId] || map.default;
  if (!mapping || typeof mapping !== "object") {
    throw new Error(`No NetSapiens mapping configured for Halo agent ${agentId}.`);
  }

  const normalized = {
    domain: String(mapping.domain || "").trim(),
    user: String(mapping.user || mapping.extension || "").trim(),
    callOrigUser: String(mapping.callOrigUser || mapping.origUser || "").trim(),
    callerIdNumber: String(mapping.callerIdNumber || mapping.callerId || env.NETSAPIENS_DEFAULT_CALLER_ID || "").trim(),
    callbackCallerIdNumber: String(mapping.callbackCallerIdNumber || mapping.callbackCallerId || env.NETSAPIENS_DEFAULT_CALLBACK_CALLER_ID || "").trim()
  };

  if (!normalized.domain || !normalized.user) {
    throw new Error(`NetSapiens mapping for Halo agent ${agentId} must include domain and user.`);
  }
  if (!normalized.callOrigUser) {
    normalized.callOrigUser = `${normalized.user}@${normalized.domain}`;
  }
  return normalized;
}

export function buildCallPayload({ callId, phoneNumber, mapping, env = {} }) {
  const dialable = normalizePhoneNumber(phoneNumber);
  if (!callId) throw new Error("callId is required.");
  if (!dialable) throw new Error("phoneNumber is required.");

  return compactObject({
    synchronous: "no",
    "call-id": callId,
    "dial-rule-application": env.NETSAPIENS_DIAL_RULE_APPLICATION || "call",
    "call-term-user": dialable,
    "call-orig-user": mapping.callOrigUser,
    "caller-id-number": mapping.callerIdNumber || env.NETSAPIENS_DEFAULT_CALLER_ID || "",
    "callback-caller-id-number": mapping.callbackCallerIdNumber || env.NETSAPIENS_DEFAULT_CALLBACK_CALLER_ID || ""
  });
}

export function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}
