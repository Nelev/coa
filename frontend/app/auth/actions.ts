"use server";

import { withAuth } from "@workos-inc/authkit-nextjs";

// The access token the browser sends to the API, which checks it with WorkOS's public keys. The proxy has refreshed it already.
export async function getAccessTokenAction() {
  const { accessToken } = await withAuth({ ensureSignedIn: true });
  return accessToken;
}
