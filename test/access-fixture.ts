import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";

export const TEST_TEAM_DOMAIN = "https://mcp-test.cloudflareaccess.com";
export const TEST_AUD = "test-aud-tag";

export interface AccessSigner {
  jwk: JWK;
  sign: (overrides?: {
    iss?: string;
    aud?: string | string[];
    exp?: number | string;
  }) => Promise<string>;
}

export const createAccessSigner = async (
  kid = "test-key",
): Promise<AccessSigner> => {
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const jwk = await exportJWK(publicKey);
  jwk.kid = kid;
  jwk.alg = "RS256";
  jwk.use = "sig";

  return {
    jwk,
    sign: async (overrides) => {
      const jwt = new SignJWT({ email: "reader@example.com" })
        .setProtectedHeader({ alg: "RS256", kid })
        .setIssuer(overrides?.iss ?? TEST_TEAM_DOMAIN)
        .setAudience(overrides?.aud ?? TEST_AUD)
        .setIssuedAt();
      jwt.setExpirationTime(overrides?.exp ?? "2h");
      return jwt.sign(privateKey);
    },
  };
};

const encodeJson = (value: unknown): string => {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
};

export const buildForgedTokens = async (
  legit: AccessSigner,
  iss: string,
): Promise<{
  differentKey: string;
  tamperedPayload: string;
  tamperedSignature: string;
  algNone: string;
  hs256: string;
}> => {
  const kid = typeof legit.jwk.kid === "string" ? legit.jwk.kid : "test-key";
  const attacker = await createAccessSigner(kid);
  const valid = await legit.sign({ iss });
  const [header, payload, signature] = valid.split(".");
  const decoded = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as { email?: string };
  decoded.email = "forged@example.com";
  const tamperedPayload = `${header}.${encodeJson(decoded)}.${signature}`;
  const flipped = signature.startsWith("A")
    ? `B${signature.slice(1)}`
    : `A${signature.slice(1)}`;

  return {
    differentKey: await attacker.sign({ iss }),
    tamperedPayload,
    tamperedSignature: `${header}.${payload}.${flipped}`,
    algNone: `${encodeJson({ alg: "none", typ: "JWT" })}.${encodeJson({
      iss,
      aud: TEST_AUD,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.`,
    hs256: await new SignJWT({ email: "reader@example.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(iss)
      .setAudience(TEST_AUD)
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(new TextEncoder().encode("0123456789abcdef0123456789abcdef")),
  };
};
