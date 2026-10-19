import { handleAuth } from "@workos-inc/authkit-nextjs";

// A sign-in that fails (cancelled, expired, a code used twice) sends the person back to the login page to try again; the default is a
// bare JSON error. The reason is logged: the page does not say it.
export const GET = handleAuth({
  onError: ({ error }) => {
    console.error("the sign-in did not complete:", error);
    return new Response(null, { status: 303, headers: { Location: "/login" } });
  },
});
