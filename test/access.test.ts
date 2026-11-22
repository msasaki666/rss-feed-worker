import { createLocalJWKSet } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  authorizeMcpRequest,
  normalizeTeamDomain,
  resolveAccessGate,
  verifyAccessJwt,
} from "../src/access";
import {
  type AccessSigner,
  createAccessSigner,
  TEST_AUD,
  TEST_TEAM_DOMAIN,
} from "./access-fixture";

describe("resolveAccessGate", () => {
  it("disables validation when both values are empty", () => {
    expect(resolveAccessGate({})).toEqual({ enabled: false });
    expect(
      resolveAccessGate({ ACCESS_TEAM_DOMAIN: "  ", ACCESS_AUD: "" }),
    ).toEqual({ enabled: false });
  });

  it("rejects a partial configuration", () => {
    expect(() => {
      resolveAccessGate({ ACCESS_AUD: TEST_AUD });
    }).toThrow(/both/i);
    expect(() => {
      resolveAccessGate({ ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN });
    }).toThrow(/both/i);
  });

  it("normalizes a bare team host to the issuer origin", () => {
    expect(normalizeTeamDomain("team.cloudflareaccess.com")).toBe(
      "https://team.cloudflareaccess.com",
    );
    expect(normalizeTeamDomain("https://team.cloudflareaccess.com/")).toBe(
      "https://team.cloudflareaccess.com",
    );
    expect(() => {
      normalizeTeamDomain("http://team.cloudflareaccess.com");
    }).toThrow(/https/);
    expect(() => {
      normalizeTeamDomain("https://team.cloudflareaccess.com/cdn-cgi");
    }).toThrow(/origin/);
  });
});

describe("verifyAccessJwt", () => {
  let signer: AccessSigner;

  beforeAll(async () => {
    signer = await createAccessSigner();
  });

  const gate = { teamDomain: TEST_TEAM_DOMAIN, audience: TEST_AUD };

  it("accepts a token signed by the team key for the configured audience", async () => {
    const token = await signer.sign();
    const payload = await verifyAccessJwt(
      token,
      gate,
      createLocalJWKSet({ keys: [signer.jwk] }),
    );
    expect(payload.email).toBe("reader@example.com");
  });

  it("accepts an audience array that contains the configured tag", async () => {
    const token = await signer.sign({ aud: ["other", TEST_AUD] });
    await expect(
      verifyAccessJwt(token, gate, createLocalJWKSet({ keys: [signer.jwk] })),
    ).resolves.toMatchObject({ iss: TEST_TEAM_DOMAIN });
  });

  it("rejects a token for another application", async () => {
    const token = await signer.sign({ aud: "someone-else" });
    await expect(
      verifyAccessJwt(token, gate, createLocalJWKSet({ keys: [signer.jwk] })),
    ).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const token = await signer.sign({
      exp: Math.floor(Date.now() / 1000) - 120,
    });
    await expect(
      verifyAccessJwt(token, gate, createLocalJWKSet({ keys: [signer.jwk] })),
    ).rejects.toThrow();
  });

  it("does not trust the issuer claimed by the token", async () => {
    const token = await signer.sign({
      iss: "https://evil.cloudflareaccess.com",
    });
    await expect(
      verifyAccessJwt(token, gate, createLocalJWKSet({ keys: [signer.jwk] })),
    ).rejects.toThrow();
  });
});

describe("authorizeMcpRequest", () => {
  it("fetches the team certs and allows a valid assertion", async () => {
    const signer = await createAccessSigner("remote-key");
    const teamDomain = "https://access-unit.cloudflareaccess.com";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === `${teamDomain}/cdn-cgi/access/certs`) {
          return new Response(JSON.stringify({ keys: [signer.jwk] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("unexpected", { status: 500 });
      });

    const token = await signer.sign({ iss: teamDomain });
    const response = await authorizeMcpRequest(
      new Request("https://worker.example/mcp", {
        headers: { "cf-access-jwt-assertion": token },
      }),
      {
        ACCESS_TEAM_DOMAIN: "access-unit.cloudflareaccess.com",
        ACCESS_AUD: TEST_AUD,
      },
    );

    expect(response).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("rejects requests when Access is not configured", async () => {
    const response = await authorizeMcpRequest(
      new Request("https://worker.example/mcp"),
      {},
    );
    expect(response?.status).toBe(403);
    expect(await response?.text()).toMatch(/ACCESS_TEAM_DOMAIN/);
  });

  it("allows the local bypass only while Access is unset", async () => {
    const open = await authorizeMcpRequest(
      new Request("https://worker.example/mcp"),
      { MCP_ALLOW_UNAUTHENTICATED: "true" },
    );
    expect(open).toBeNull();

    const stillProtected = await authorizeMcpRequest(
      new Request("https://worker.example/mcp"),
      {
        ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        ACCESS_AUD: TEST_AUD,
        MCP_ALLOW_UNAUTHENTICATED: "true",
      },
    );
    expect(stillProtected?.status).toBe(403);
    expect(await stillProtected?.text()).toMatch(/Cf-Access-Jwt-Assertion/);
  });

  it("returns 403 when the assertion header is missing", async () => {
    const response = await authorizeMcpRequest(
      new Request("https://worker.example/mcp"),
      { ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN, ACCESS_AUD: TEST_AUD },
    );
    expect(response?.status).toBe(403);
    expect(await response?.text()).toMatch(/Cf-Access-Jwt-Assertion/);
  });

  it("returns 500 when only one Access variable is set", async () => {
    const response = await authorizeMcpRequest(
      new Request("https://worker.example/mcp"),
      { ACCESS_AUD: TEST_AUD },
    );
    expect(response?.status).toBe(500);
  });
});
