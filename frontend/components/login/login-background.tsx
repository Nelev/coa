import { LoginScenes } from "@/components/login/login-scenes";

// The background is a pharmaceutical line, all of it decorative: molecules drifting far behind and an inspection line along the foot
// where each vial is scanned and tagged PASS, REVIEW or FAIL (what this app does with a certificate). Nothing crosses the form. It takes
// no focus, no pointer events and is not announced.
export function LoginBackground() {
  return (
    <div aria-hidden className="login-bg pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="aurora aurora-1" />
      <div className="aurora aurora-2" />
      <div className="aurora aurora-3" />
      <div className="login-grid absolute inset-0" />
      <LoginScenes />
      <div className="login-vignette absolute inset-0" />
    </div>
  );
}
