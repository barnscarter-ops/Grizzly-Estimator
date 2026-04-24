import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProjectRecord, ProposalStyle } from "@/lib/types";

type ProposalShareClaims = {
  projectId: string;
  style: ProposalStyle;
  exp: number;
};

const PROPOSAL_SHARE_TTL_MS = 1000 * 60 * 60 * 24 * 14;

function getSecret() {
  const explicitSecret = process.env.APP_SESSION_SECRET?.trim();

  if (explicitSecret) {
    return explicitSecret;
  }

  const derivedSecret = [
    process.env.APP_ADMIN_EMAIL?.trim(),
    process.env.APP_ADMIN_PASSWORD_HASH?.trim(),
    process.env.APP_ADMIN_PASSWORD?.trim(),
  ]
    .filter(Boolean)
    .join(":");

  return derivedSecret;
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function sign(value: string) {
  const secret = getSecret();

  if (!secret) {
    return "";
  }

  return createHmac("sha256", `${secret}:proposal-share`).update(value).digest("base64url");
}

function buildShareToken(projectId: string, style: ProposalStyle) {
  const payload = Buffer.from(
    JSON.stringify({
      projectId,
      style,
      exp: Date.now() + PROPOSAL_SHARE_TTL_MS,
    } satisfies ProposalShareClaims),
  ).toString("base64url");
  const signature = sign(payload);

  if (!signature) {
    return "";
  }

  return `${payload}.${signature}`;
}

export function secureProposalVariants(project: ProjectRecord) {
  return project.proposalVariants.map((variant) => {
    const token = buildShareToken(project.id, variant.style);
    const params = new URLSearchParams({ style: variant.style });

    if (token) {
      params.set("token", token);
    }

    return {
      ...variant,
      sharePath: `/proposal/${project.id}?${params.toString()}`,
    };
  });
}

export function validateProposalShareToken(
  token: string | undefined,
  projectId: string,
  style: ProposalStyle,
) {
  if (!token) {
    return false;
  }

  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return false;
  }

  const expectedSignature = sign(payload);

  if (!expectedSignature || !safeCompare(signature, expectedSignature)) {
    return false;
  }

  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as ProposalShareClaims;

    return (
      claims.projectId === projectId &&
      claims.style === style &&
      claims.exp > Date.now()
    );
  } catch {
    return false;
  }
}
