import {
  createRemoteJWKSet,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify,
} from "jose";

export interface AccessJwtEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

export type AccessGate =
  | { enabled: false }
  | { enabled: true; teamDomain: string; audience: string };

export class AccessConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessConfigError";
  }
}

const jwksByTeam = new Map<string, JWTVerifyGetKey>();
let warnedAccessDisabled = false;

export const normalizeTeamDomain = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) {
    throw new AccessConfigError("ACCESS_TEAM_DOMAIN is empty");
  }
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new AccessConfigError("ACCESS_TEAM_DOMAIN is not a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new AccessConfigError("ACCESS_TEAM_DOMAIN must use https");
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== "/"
  ) {
    throw new AccessConfigError(
      "ACCESS_TEAM_DOMAIN must be an origin like https://<team>.cloudflareaccess.com",
    );
  }
  return url.origin;
};

export const resolveAccessGate = (env: AccessJwtEnv): AccessGate => {
  const domain = env.ACCESS_TEAM_DOMAIN?.trim() ?? "";
  const audience = env.ACCESS_AUD?.trim() ?? "";
  if (domain.length === 0 && audience.length === 0) {
    return { enabled: false };
  }
  if (domain.length === 0 || audience.length === 0) {
    throw new AccessConfigError(
      "Set both ACCESS_TEAM_DOMAIN and ACCESS_AUD, or leave both empty",
    );
  }
  return {
    enabled: true,
    teamDomain: normalizeTeamDomain(domain),
    audience,
  };
};

export const jwksForTeam = (teamDomain: string): JWTVerifyGetKey => {
  const cached = jwksByTeam.get(teamDomain);
  if (cached) {
    return cached;
  }
  const jwks = createRemoteJWKSet(
    new URL(`${teamDomain}/cdn-cgi/access/certs`),
  );
  jwksByTeam.set(teamDomain, jwks);
  return jwks;
};

export const verifyAccessJwt = async (
  token: string,
  gate: { teamDomain: string; audience: string },
  getKey?: JWTVerifyGetKey,
): Promise<JWTPayload> => {
  const { payload } = await jwtVerify(
    token,
    getKey ?? jwksForTeam(gate.teamDomain),
    {
      issuer: gate.teamDomain,
      audience: gate.audience,
      algorithms: ["RS256"],
      clockTolerance: 30,
      requiredClaims: ["exp", "iss", "aud"],
    },
  );
  return payload;
};

const plain = (message: string, status: number): Response => {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};

/**
 * Cloudflare Access がエッジで認証する。ここは Cf-Access-Jwt-Assertion の
 * 再検証だけを行う。チームドメインと AUD が両方空なら検証しない。
 * 片方だけ設定されている場合は設定ミスとして拒否する。
 */
export const authorizeMcpRequest = async (
  request: Request,
  env: AccessJwtEnv,
): Promise<Response | null> => {
  let gate: AccessGate;
  try {
    gate = resolveAccessGate(env);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid Access configuration";
    return plain(message, 500);
  }

  if (!gate.enabled) {
    if (!warnedAccessDisabled) {
      warnedAccessDisabled = true;
      console.warn(
        "Access JWT validation is disabled because ACCESS_TEAM_DOMAIN and ACCESS_AUD are empty. Set both before exposing /mcp.",
      );
    }
    return null;
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    return plain("Missing Cf-Access-Jwt-Assertion", 403);
  }

  try {
    await verifyAccessJwt(token, gate);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid token";
    return plain(`Invalid token: ${message}`, 403);
  }
};
