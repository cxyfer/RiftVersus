const INVALID_RELEASE_URL =
  "RIFTVERSUS_E2E_BASE_URL must be an HTTP(S) root deployment URL without credentials, path, query, or fragment.";

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

  const hasQueryOrFragmentDelimiter =
    deploymentUrl.href.includes("?") || deploymentUrl.href.includes("#");
  if (
    !["http:", "https:"].includes(deploymentUrl.protocol) ||
    deploymentUrl.username ||
    deploymentUrl.password ||
    deploymentUrl.pathname !== "/" ||
    hasQueryOrFragmentDelimiter
  ) {
    throw new Error(INVALID_RELEASE_URL);
  }

  return deploymentUrl.toString();
}
