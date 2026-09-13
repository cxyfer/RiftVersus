const INVALID_RELEASE_URL =
  "RIFTVERSUS_E2E_BASE_URL must be an HTTP(S) deployment URL with an optional single project path, without credentials, query, or fragment.";

export function parseReleaseBaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error(
      "RIFTVERSUS_E2E_BASE_URL must point to a running production RiftVersus deployment.",
    );
  }

  let deploymentUrl: URL;
  try {
    deploymentUrl = new URL(value);
  } catch {
    throw new Error(INVALID_RELEASE_URL);
  }

  const unsafeEncodedPath = /%(?:2f|2F|5c|5C|2e|2E)/u.test(value);
  const unsafePathTraversal = /\/(?:\.{1,2})(?:\/|$)/u.test(value);
  const hasQueryOrFragmentDelimiter = /[?#]/u.test(value);
  const pathSegments = deploymentUrl.pathname.split("/").filter(Boolean);
  const projectPath = pathSegments[0] ?? "";
  let decodedProjectPath: string;
  try {
    decodedProjectPath = decodeURIComponent(projectPath);
  } catch {
    throw new Error(INVALID_RELEASE_URL);
  }
  if (
    !["http:", "https:"].includes(deploymentUrl.protocol) ||
    deploymentUrl.username ||
    deploymentUrl.password ||
    deploymentUrl.search ||
    deploymentUrl.hash ||
    hasQueryOrFragmentDelimiter ||
    unsafeEncodedPath ||
    unsafePathTraversal ||
    pathSegments.length > 1 ||
    pathSegments.some((segment) => segment === "." || segment === "..") ||
    (projectPath !== "" && !/^[A-Za-z0-9._~-]+$/u.test(decodedProjectPath))
  ) {
    throw new Error(INVALID_RELEASE_URL);
  }

  deploymentUrl.pathname = pathSegments.length === 0 ? "/" : `/${pathSegments[0]}/`;
  return deploymentUrl.toString();
}
