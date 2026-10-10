"use server";

import { signOut, withAuth } from "@workos-inc/authkit-nextjs";

export async function signOutAction() {
  await signOut();
}

// The access token the browser sends to the API, which checks it with WorkOS's public keys. The proxy has refreshed it already.
export async function getAccessTokenAction() {
  const { accessToken } = await withAuth({ ensureSignedIn: true });
  return accessToken;
}
