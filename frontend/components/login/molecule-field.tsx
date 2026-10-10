"use client";

import { useRef } from "react";

import { type Scene, type Size, useScene } from "@/components/login/use-scene";
import { centre, STRUCTURES, type Structure } from "@/lib/molecules";

type Molecule = {
  structure: Structure;
  middle: { x: number; y: number };
  at: { x: number; y: number }[]; // where each atom is on the screen now (one place per atom, rewritten every frame)
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  size: number; // px per bond length
  radius: number; // how far its atoms reach from the middle, in px: it wraps only when it is wholly off the screen
  depth: number; // 0 far, 1 near: nearer ones are larger, brighter and drift faster
  lineWidth: number;
  lineStyle: string;
  font: string;
  labelStyle: string;
};

// the oxygen of the formulas, as chemists draw it (red), kept faint
const ATOM = "255 140 140";
const LINE = "140 205 235";
const SHORTEN = 0.3; // a bond stops this far (in bond lengths) before an atom that has a letter
const SINGLE = [0];
const DOUBLE = [-0.07, 0.07]; // the two lines of a double bond, either side of the axis, in bond lengths

function populate(size: Size): Molecule[] {
  const count = Math.min(14, Math.max(5, Math.round((size.width * size.height) / 110_000)));
  const scale = Math.min(1, Math.max(0.55, size.width / 1100)); // smaller on a phone, where the page is narrow
  const all = Array.from({ length: count }, (_, i) => {
    const depth = 0.25 + Math.random() * 0.75;
    const structure = STRUCTURES[i % STRUCTURES.length]();
    const middle = centre(structure);
    const px = (20 + depth * 22) * scale;
    return {
      structure,
      middle,
      at: structure.atoms.map(() => ({ x: 0, y: 0 })),
      x: Math.random() * size.width,
      y: Math.random() * size.height,
      vx: (Math.random() - 0.5) * 9 * depth,
      vy: (Math.random() - 0.5) * 9 * depth,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.12,
      size: px,
      depth,
      radius: px * (Math.max(...structure.atoms.map((a) => Math.hypot(a.x - middle.x, a.y - middle.y))) + 0.5),
      // the look of a molecule depends on its depth only, so it is worked out once
      lineWidth: 0.8 + depth * 0.9,
      lineStyle: `rgb(${LINE} / ${0.1 + depth * 0.2})`,
      font: `500 ${Math.round(9 + depth * 5)}px ui-monospace, SFMono-Regular, Menlo, monospace`,
      labelStyle: `rgb(${ATOM} / ${0.3 + depth * 0.4})`,
    };
  });
  return all.sort((a, b) => a.depth - b.depth); // far ones are drawn first
}

function create(ctx: CanvasRenderingContext2D, size: Size): Scene {
  const molecules = populate(size);

  return {
    update(dt) {
      for (const m of molecules) {
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.angle += m.spin * dt;
        if (m.x < -m.radius) m.x = size.width + m.radius;
        if (m.x > size.width + m.radius) m.x = -m.radius;
        if (m.y < -m.radius) m.y = size.height + m.radius;
        if (m.y > size.height + m.radius) m.y = -m.radius;
      }
    },
    draw() {
      ctx.clearRect(0, 0, size.width, size.height);
      ctx.lineCap = "round";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const m of molecules) {
        const { atoms, bonds } = m.structure;
        const cos = Math.cos(m.angle);
        const sin = Math.sin(m.angle);
        atoms.forEach((atom, i) => {
          const dx = (atom.x - m.middle.x) * m.size;
          const dy = (atom.y - m.middle.y) * m.size;
          m.at[i].x = m.x + dx * cos - dy * sin;
          m.at[i].y = m.y + dx * sin + dy * cos;
        });

        // all the bonds of a molecule are one path, drawn once
        ctx.lineWidth = m.lineWidth;
        ctx.strokeStyle = m.lineStyle;
        ctx.beginPath();
        for (const [from, to, order] of bonds) {
          let { x: ax, y: ay } = m.at[from];
          let { x: bx, y: by } = m.at[to];
          const length = Math.hypot(bx - ax, by - ay) || 1;
          const ux = (bx - ax) / length;
          const uy = (by - ay) / length;
          const cut = SHORTEN * m.size;
          if (atoms[from].label) {
            ax += ux * cut;
            ay += uy * cut;
          }
          if (atoms[to].label) {
            bx -= ux * cut;
            by -= uy * cut;
          }
          for (const offset of order === 2 ? DOUBLE : SINGLE) {
            const px = -uy * offset * m.size;
            const py = ux * offset * m.size;
            ctx.moveTo(ax + px, ay + py);
            ctx.lineTo(bx + px, by + py);
          }
        }
        ctx.stroke();

        ctx.font = m.font;
        ctx.fillStyle = m.labelStyle;
        atoms.forEach((atom, i) => {
          if (atom.label) ctx.fillText(atom.label, m.at[i].x, m.at[i].y);
        });
      }
    },
  };
}

// Structural formulas drifting and turning slowly behind everything. Decorative: hidden from assistive tech, still for reduced motion.
// They move a few pixels a second, so thirty frames a second is more than they need.
export function MoleculeField() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useScene(canvas, create, 30);
  return <canvas ref={canvas} aria-hidden className="absolute inset-0 size-full" />;
}
