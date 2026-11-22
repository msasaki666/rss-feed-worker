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
