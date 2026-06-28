import { describe, test, expect } from "bun:test";
import { lookupCreds } from "./creds.ts";
import type { Provider } from "./providers/types.ts";

const singleKeyProvider: Provider = {
  name: "Test",
  envKey: "TEST_API_KEY",
  domains: [],
};

const dualKeyProvider: Provider = {
  name: "VolcengineTest",
  envKeys: ["TEST_AK", "TEST_SK"],
  domains: [],
};

const noopProvider: Provider = {
  name: "Noop",
  domains: [],
};

describe("lookupCreds", () => {
  describe("单 Key (envKey)", () => {
    test("envKey 已设置，fallback=true → 返回该值", () => {
      const creds = lookupCreds(singleKeyProvider, { TEST_API_KEY: "real-key", ANTHROPIC_AUTH_TOKEN: "fallback" }, true);
      expect(creds).toBe("real-key");
    });

    test("envKey 已设置，fallback=false → 返回该值", () => {
      const creds = lookupCreds(singleKeyProvider, { TEST_API_KEY: "real-key", ANTHROPIC_AUTH_TOKEN: "fallback" }, false);
      expect(creds).toBe("real-key");
    });

    test("envKey 缺失但 ANTHROPIC_AUTH_TOKEN 存在，fallback=true → 用 fallback", () => {
      const creds = lookupCreds(singleKeyProvider, { ANTHROPIC_AUTH_TOKEN: "fallback" }, true);
      expect(creds).toBe("fallback");
    });

    test("envKey 缺失且 ANTHROPIC_AUTH_TOKEN 缺失 → null", () => {
      const creds = lookupCreds(singleKeyProvider, {}, true);
      expect(creds).toBe(null);
    });

    test("envKey 缺失，fallback=false → null（即使 ANTHROPIC_AUTH_TOKEN 在）", () => {
      const creds = lookupCreds(singleKeyProvider, { ANTHROPIC_AUTH_TOKEN: "x" }, false);
      expect(creds).toBe(null);
    });
  });

  describe("双 Key (envKeys)", () => {
    test("两个都在 → 返回 tuple", () => {
      const creds = lookupCreds(dualKeyProvider, { TEST_AK: "ak", TEST_SK: "sk" }, true);
      expect(creds).toEqual(["ak", "sk"]);
    });

    test("AK 缺失 → null（双 Key 模式）", () => {
      const creds = lookupCreds(dualKeyProvider, { TEST_SK: "sk" }, true);
      expect(creds).toBe(null);
    });

    test("SK 缺失 → null（双 Key 模式）", () => {
      const creds = lookupCreds(dualKeyProvider, { TEST_AK: "ak" }, true);
      expect(creds).toBe(null);
    });

    test("双 Key 模式不对 ANTHROPIC_AUTH_TOKEN fallback", () => {
      // SK 缺失 → null（即使 ANTHROPIC_AUTH_TOKEN 存在也不补）
      const creds = lookupCreds(dualKeyProvider, { TEST_AK: "ak", ANTHROPIC_AUTH_TOKEN: "x" }, true);
      expect(creds).toBe(null);
    });

    test("双 Key 都不在 → null", () => {
      const creds = lookupCreds(dualKeyProvider, {}, true);
      expect(creds).toBe(null);
    });
  });

  describe("Noop (无 envKey/envKeys)", () => {
    test("无任何凭据配置 → null", () => {
      const creds = lookupCreds(noopProvider, { ANTHROPIC_AUTH_TOKEN: "x" }, true);
      expect(creds).toBe(null);
    });
  });
});