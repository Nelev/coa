// Small structural formulas for the login background, in bond lengths: an atom is a point, a bond joins two atoms (order 1 = single,
// 2 = double). Only the atoms that carry a letter (N, O, OH) are labelled; the carbons are the corners, as in a chemist's drawing.

export type Atom = { x: number; y: number; label?: string };
type Bond = [from: number, to: number, order: 1 | 2];
export type Structure = { atoms: Atom[]; bonds: Bond[] };

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const same = (a: Atom, x: number, y: number) => Math.hypot(a.x - x, a.y - y) < 0.01;

// a six-membered ring centred on (cx, cy) with alternating double bonds; atoms it shares with the structure are reused (a fused ring)
function addRing(s: Structure, cx: number, cy: number): number[] {
  const ids = Array.from({ length: 6 }, (_, k) => {
    const x = cx + Math.cos(rad(30 + 60 * k));
    const y = cy + Math.sin(rad(30 + 60 * k));
    const found = s.atoms.findIndex((atom) => same(atom, x, y));
    return found >= 0 ? found : s.atoms.push({ x, y }) - 1;
  });
  ids.forEach((id, k) => {
    const next = ids[(k + 1) % 6];
    const exists = s.bonds.some(([a, b]) => (a === id && b === next) || (a === next && b === id));
    if (!exists) s.bonds.push([id, next, k % 2 === 0 ? 2 : 1]);
  });
  return ids;
}

// a new atom one bond length from `from`, in the direction `angle` (degrees, y pointing down)
function attach(s: Structure, from: number, angle: number, label?: string, order: 1 | 2 = 1): number {
  const origin = s.atoms[from];
  const id = s.atoms.push({ x: origin.x + Math.cos(rad(angle)), y: origin.y + Math.sin(rad(angle)), label }) - 1;
  s.bonds.push([from, id, order]);
  return id;
}

const empty = (): Structure => ({ atoms: [], bonds: [] });

export function benzene(): Structure {
  const s = empty();
  addRing(s, 0, 0);
  return s;
}

export function naphthalene(): Structure {
  const s = empty();
  addRing(s, 0, 0);
  addRing(s, Math.sqrt(3), 0); // shares the edge between them
  return s;
}

// a ring with a hydroxyl and a carboxylic acid: the look of aspirin and of most small drugs
export function acidRing(): Structure {
  const s = empty();
  const ring = addRing(s, 0, 0);
  attach(s, ring[1], 90, "OH");
  const carbon = attach(s, ring[2], 150);
  attach(s, carbon, 210, "O", 2);
  attach(s, carbon, 90, "OH");
  return s;
}

// a chain with three carboxyl ends: the skeleton of citric acid, the sample material of this project
export function citricChain(): Structure {
  const s = empty();
  const a = attach(s, s.atoms.push({ x: 0, y: 0 }) - 1, 30);
  const b = attach(s, a, -30);
  const c = attach(s, b, 30);
  const d = attach(s, c, -30);
  attach(s, a, 150, "O", 2);
  attach(s, b, -90, "OH");
  attach(s, d, 30, "O", 2);
  attach(s, d, -90, "OH");
  return s;
}

export const STRUCTURES: (() => Structure)[] = [benzene, naphthalene, acidRing, citricChain];

// the structure's centre, so that it can be turned around it
export function centre({ atoms }: Structure): { x: number; y: number } {
  return { x: atoms.reduce((sum, a) => sum + a.x, 0) / atoms.length, y: atoms.reduce((sum, a) => sum + a.y, 0) / atoms.length };
}
