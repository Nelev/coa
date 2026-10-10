import { describe, expect, it } from "vitest";

import { pickVerdict, tagText } from "@/lib/line-scene";
import { acidRing, benzene, centre, citricChain, naphthalene } from "@/lib/molecules";

describe("molecules", () => {
  it("draws a benzene ring with three double bonds", () => {
    const s = benzene();
    expect(s.atoms).toHaveLength(6);
    expect(s.bonds).toHaveLength(6);
    expect(s.bonds.filter(([, , order]) => order === 2)).toHaveLength(3);
  });

  it("fuses two rings along one shared edge", () => {
    const s = naphthalene();
    expect(s.atoms).toHaveLength(10); // 12 corners, 2 shared
    expect(s.bonds).toHaveLength(11); // 12 edges, 1 shared
  });

  it("labels only the atoms that are not carbon", () => {
    expect(
      acidRing()
        .atoms.filter((a) => a.label)
        .map((a) => a.label),
    ).toEqual(["OH", "O", "OH"]);
    expect(citricChain().atoms.filter((a) => a.label)).toHaveLength(4);
    expect(benzene().atoms.some((a) => a.label)).toBe(false);
  });

  it("joins every atom to the rest and no bond to an atom that is not there", () => {
    for (const make of [benzene, naphthalene, acidRing, citricChain]) {
      const { atoms, bonds } = make();
      expect(bonds.every(([a, b]) => a >= 0 && b >= 0 && a < atoms.length && b < atoms.length && a !== b)).toBe(true);
      const touched = new Set(bonds.flatMap((bond) => bond.slice(0, 2)));
      expect(touched.size).toBe(atoms.length);
    }
  });

  it("finds the middle of a ring", () => {
    const { x, y } = centre(benzene());
    expect(Math.abs(x)).toBeLessThan(1e-9);
    expect(Math.abs(y)).toBeLessThan(1e-9);
  });
});

describe("the inspection line", () => {
  it("passes most, sends some to review, and fails few", () => {
    expect(pickVerdict(0)).toBe("pass");
    expect(pickVerdict(0.77)).toBe("pass");
    expect(pickVerdict(0.8)).toBe("review");
    expect(pickVerdict(0.95)).toBe("fail");
  });

  it("writes a tag with the word, and the assay when it read one", () => {
    expect(tagText("review", 0.5)).toBe("REVIEW");
    expect(tagText("pass", 0)).toBe("PASS 99.5 %");
    const fail = Number.parseFloat(tagText("fail", 0.99).replace("FAIL ", ""));
    expect(fail).toBeLessThan(99.5); // a failing assay is outside the limit
  });
});
