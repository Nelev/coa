// The inspection line of the login background: what a vial is told at the gate. Mostly good, sometimes to be looked at, rarely not.

export type Verdict = "pass" | "review" | "fail";

// `roll` is a number in [0, 1)
export function pickVerdict(roll: number): Verdict {
  if (roll < 0.78) return "pass";
  return roll < 0.92 ? "review" : "fail";
}

// what the tag above the vial says: the word always, and for a number the assay it read
export function tagText(verdict: Verdict, roll: number): string {
  if (verdict === "review") return "REVIEW";
  const assay = verdict === "pass" ? 99.5 + roll * 0.9 : 97.6 + roll * 1.4; // a pass is inside 99.5–100.5 %, a fail is outside it
  return `${verdict === "pass" ? "PASS" : "FAIL"} ${assay.toFixed(1)} %`;
}
