export const dynamic = "force-dynamic";

const DEFAULT_REPO_OWNER = "DreamyTalesPAN";
const DEFAULT_REPO_SLUG = "CodexBar-Display";

type DeploymentInfo = {
  ok: true;
  commitRef?: string;
  commitSha?: string;
  environment?: string;
  repo: string;
  sourceRef?: string;
};

export function GET() {
  const commitSha = cleanDeploymentValue(process.env.VERCEL_GIT_COMMIT_SHA);
  const commitRef = cleanDeploymentValue(process.env.VERCEL_GIT_COMMIT_REF);
  const repoOwner =
    cleanDeploymentValue(process.env.VERCEL_GIT_REPO_OWNER) ||
    DEFAULT_REPO_OWNER;
  const repoSlug =
    cleanDeploymentValue(process.env.VERCEL_GIT_REPO_SLUG) ||
    DEFAULT_REPO_SLUG;
  const sourceRef = safeSourceRef(commitSha) || safeSourceRef(commitRef);

  return Response.json({
    ok: true,
    commitRef: commitRef || undefined,
    commitSha: commitSha || undefined,
    environment: cleanDeploymentValue(process.env.VERCEL_ENV) || undefined,
    repo: `${repoOwner}/${repoSlug}`,
    sourceRef: sourceRef || undefined,
  } satisfies DeploymentInfo);
}

function cleanDeploymentValue(value: string | undefined): string {
  return value?.trim() || "";
}

function safeSourceRef(value: string): string {
  if (
    !value ||
    value.startsWith("/") ||
    value.includes("..") ||
    value.includes("//") ||
    !/^[A-Za-z0-9._/-]+$/.test(value)
  ) {
    return "";
  }
  return value;
}
