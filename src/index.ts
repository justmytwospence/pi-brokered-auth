// pi-brokered-auth: OAuth providers whose credentials come from a file that a
// hub keeps fresh.
//
// Subscription logins (OpenAI Codex, Radius, ...) rotate their refresh token on
// every refresh, so a refresh token can only live in one place. When several
// machines share one login, a broker on a hub owns the refresh token, refreshes
// it, and pushes short-lived access tokens to each machine as a JSON file:
//
//   { "openai-codex": { "access": "...", "expires": 1767225600000, ... },
//     "radius":       { "access": "...", "expires": 1767225600000 } }
//
// With PI_BROKERED_AUTH_FILE pointing at that file, this extension re-registers
// each listed provider's OAuth so that login and refresh read the file instead
// of calling upstream. The refresh token pi stores is a sentinel that is never
// sent anywhere. Without the variable it does nothing, so it is safe to load on
// every machine.
import { readFileSync } from "node:fs";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";

type OAuth = NonNullable<ProviderConfig["oauth"]>;

export const SENTINEL = "brokered";
/** A pushed token closer than this to expiry counts as expired. */
export const EXPIRY_MARGIN_MS = 60_000;

const NAMES: Record<string, string> = {
  "openai-codex": "OpenAI (ChatGPT Plus/Pro), brokered",
  anthropic: "Anthropic (Claude Pro/Max), brokered",
  radius: "Radius, brokered",
};
const SUBSCRIPTION = new Set(["openai-codex", "anthropic"]);

export type Credentials = { access: string; refresh: string; expires: number; [key: string]: unknown };
type Entry = { access?: unknown; expires?: unknown; [key: string]: unknown };

/** The file's provider entries; {} when it is missing or unreadable. */
export function readFile(path: string): Record<string, Entry> {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** Providers to take over: the file's keys, else PI_BROKERED_AUTH_PROVIDERS. */
export function providers(env: NodeJS.ProcessEnv = process.env): string[] {
  const path = env.PI_BROKERED_AUTH_FILE;
  if (!path) return [];
  const fromFile = Object.keys(readFile(path)).filter((k) => !k.startsWith("_"));
  if (fromFile.length) return fromFile;
  return (env.PI_BROKERED_AUTH_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A fresh credential for provider from the file, or an error that says why not. */
export function load(path: string, provider: string, now: number = Date.now()): Credentials {
  const entry = readFile(path)[provider];
  if (!entry || typeof entry.access !== "string" || !entry.access) {
    throw new Error(`${provider}: no brokered credential in ${path}; the hub has not pushed one yet`);
  }
  const expires = Number(entry.expires);
  if (!Number.isFinite(expires) || expires - EXPIRY_MARGIN_MS <= now) {
    throw new Error(`${provider}: the brokered credential in ${path} has expired; the hub has not pushed a fresh one`);
  }
  // The refresh token never leaves the hub; pi stores the sentinel in its place.
  const { refresh: _ignored, ...rest } = entry;
  return { ...rest, access: entry.access, expires, refresh: SENTINEL };
}

export function oauthFor(provider: string, path: string, now: () => number = Date.now): OAuth {
  const fetch = async (): Promise<Credentials> => load(path, provider, now());
  return {
    name: NAMES[provider] ?? `${provider}, brokered`,
    isSubscription: SUBSCRIPTION.has(provider),
    login: fetch,
    refreshToken: fetch,
    getApiKey: (credentials) => String(credentials.access),
  };
}

export default function brokeredAuth(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env) {
  const path = env.PI_BROKERED_AUTH_FILE;
  if (!path) return;
  for (const provider of providers(env)) {
    pi.registerProvider(provider, { oauth: oauthFor(provider, path) });
  }
}
