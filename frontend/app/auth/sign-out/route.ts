import { signOut } from "@workos-inc/authkit-nextjs";

// A plain navigation, not a server action: an action that clears the cookie makes Next re-render the page the person is on without a session, and that render fails before the redirect lands.
export async function GET() {
  await signOut();
}
