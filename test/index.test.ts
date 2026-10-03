import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import brokeredAuth, { EXPIRY_MARGIN_MS, SENTINEL, load, oauthFor, providers } from "../src/index.ts";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const HOUR = 3_600_000;
let dir: string;
let file: string;

const write = (data: unknown) => writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-brokered-auth-"));
  file = join(dir, "brokered-auth.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function fakePi() {
  const registered: Record<string, any> = {};
  return { registered, api: { registerProvider: (name: string, config: unknown) => (registered[name] = config) } as any };
}

describe("activation", () => {
  test("inert without PI_BROKERED_AUTH_FILE", () => {
    const pi = fakePi();
    brokeredAuth(pi.api, {});
    expect(pi.registered).toEqual({});
    expect(providers({})).toEqual([]);
  });

  test("takes over every provider in the file", () => {
    write({ "openai-codex": { access: "a", expires: NOW + HOUR }, radius: { access: "r", expires: NOW + HOUR } });
    const pi = fakePi();
    brokeredAuth(pi.api, { PI_BROKERED_AUTH_FILE: file });
    expect(Object.keys(pi.registered).sort()).toEqual(["openai-codex", "radius"]);
    expect(pi.registered["openai-codex"].oauth.isSubscription).toBe(true);
    expect(pi.registered.radius.oauth.isSubscription).toBe(false);
  });

  test("falls back to PI_BROKERED_AUTH_PROVIDERS before the first push", () => {
    expect(providers({ PI_BROKERED_AUTH_FILE: file, PI_BROKERED_AUTH_PROVIDERS: "openai-codex, radius" }))
      .toEqual(["openai-codex", "radius"]);
  });

  test("ignores metadata keys", () => {
    write({ _pushed_at: NOW, radius: { access: "r", expires: NOW + HOUR } });
    expect(providers({ PI_BROKERED_AUTH_FILE: file })).toEqual(["radius"]);
  });
});

describe("credentials", () => {
  test("never carries a real refresh token", () => {
    write({ "openai-codex": { access: "a", refresh: "real-refresh", expires: NOW + HOUR, accountId: "acct" } });
    const cred = load(file, "openai-codex", NOW);
    expect(cred).toEqual({ access: "a", refresh: SENTINEL, expires: NOW + HOUR, accountId: "acct" });
  });

  test("refresh re-reads the file", async () => {
    write({ radius: { access: "old", expires: NOW + HOUR } });
    const oauth = oauthFor("radius", file, () => NOW);
    expect((await oauth.login({} as any)).access).toBe("old");
    write({ radius: { access: "new", expires: NOW + 2 * HOUR } });
    const fresh = await oauth.refreshToken({ access: "old", refresh: SENTINEL, expires: NOW } as any, new AbortController().signal);
    expect(fresh.access).toBe("new");
    expect(fresh.refresh).toBe(SENTINEL);
    expect(oauth.getApiKey(fresh)).toBe("new");
  });

  test("an expired push is an error that names the hub", () => {
    write({ radius: { access: "r", expires: NOW + EXPIRY_MARGIN_MS - 1 } });
    expect(() => load(file, "radius", NOW)).toThrow(/expired; the hub has not pushed a fresh one/);
  });

  test("a missing entry or file is an error", () => {
    expect(() => load(file, "radius", NOW)).toThrow(/has not pushed one yet/);
    write("not json");
    expect(() => load(file, "radius", NOW)).toThrow(/has not pushed one yet/);
  });
});
