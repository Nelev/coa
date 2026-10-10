"use client";

import { useRef } from "react";

import { type Scene, type Size, useScene } from "@/components/login/use-scene";
import { pickVerdict, tagText, type Verdict } from "@/lib/line-scene";

type Vial = {
  x: number;
  kind: "vial" | "flask";
  liquid: string; // r g b
  level: number; // how full, 0..1
  verdict?: Verdict;
  text: string;
  tagWidth?: number;
  age: number; // seconds since the verdict: the tag fades in and out by it
  reject?: { dy: number; vy: number; vx: number; angle: number; spin: number; life: number };
};

const GLASS = "190 225 255";
const BEAM = "110 220 235";
const TONES: Record<Verdict, string> = { pass: "110 220 160", review: "245 200 90", fail: "255 120 120" };
const LIQUIDS = ["120 210 230", "150 220 190", "235 215 140", "170 180 255"];
const TAG_SECONDS = 2.8;
const GLASS_FILL = `rgb(${GLASS} / 0.07)`;
const GLASS_STROKE = `rgb(${GLASS} / 0.55)`;

const clamp = (x: number) => Math.max(0, Math.min(1, x));

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function create(ctx: CanvasRenderingContext2D, size: Size): Scene {
  const { width, height } = size;
  const u = Math.min(1.5, Math.max(0.65, height / 205)); // one unit of size: the scene is drawn in units of u
  const beltY = height - 30 * u;
  const gateX = width > 900 ? width * 0.72 : width * 0.5;
  const gateHalf = 15 * u;
  const speed = 34 * u; // px per second: slow, it is a calm line
  const gap = () => (110 + Math.random() * 80) * u; // the space to the next vial
  let toSpawn = gap();
  let lastVerdict: Verdict | undefined; // what the lamp on the gate shows

  const make = (x: number): Vial => ({
    x,
    kind: Math.random() < 0.7 ? "vial" : "flask",
    liquid: LIQUIDS[Math.floor(Math.random() * LIQUIDS.length)],
    level: 0.45 + Math.random() * 0.4,
    text: "",
    age: 0,
  });

  // the line is already running when the page opens, and is the same still picture when motion is off
  const vials: Vial[] = [];
  for (let x = -30 * u; x < width + 40 * u; x += gap()) {
    const vial = make(x);
    if (x > gateX + gateHalf) {
      vial.verdict = pickVerdict(Math.random() * 0.92); // the ones that failed are gone already
      vial.text = tagText(vial.verdict, Math.random());
      vial.age = x < gateX + 140 * u ? 0.6 : TAG_SECONDS;
      lastVerdict = vial.verdict;
    }
    vials.push(vial);
  }

  // the gate does not move, so its gradients are made once
  const curtainTop = beltY - 96 * u;
  const curtain = ctx.createLinearGradient(0, curtainTop, 0, beltY);
  curtain.addColorStop(0, `rgb(${BEAM} / 0.0)`);
  curtain.addColorStop(1, `rgb(${BEAM} / 0.13)`);
  const scanLine = ctx.createLinearGradient(gateX - gateHalf, 0, gateX + gateHalf, 0);
  scanLine.addColorStop(0, `rgb(${BEAM} / 0)`);
  scanLine.addColorStop(0.5, `rgb(${BEAM} / 0.95)`);
  scanLine.addColorStop(1, `rgb(${BEAM} / 0)`);

  function drawVial(v: Vial) {
    const alpha = v.reject ? clamp(v.reject.life) : 1;
    const cap = `rgb(${v.verdict ? TONES[v.verdict] : "170 190 215"} / 0.75)`; // the cap takes the color of the verdict
    ctx.save();
    ctx.globalAlpha = alpha;
    const dy = v.reject?.dy ?? 0;
    ctx.translate(v.x, beltY + dy);
    if (v.reject) ctx.rotate(v.reject.angle);
    ctx.lineWidth = 1.2;
    if (v.kind === "vial") {
      const w = 26 * u;
      const h = 46 * u;
      roundRect(ctx, -w / 2, -h, w, h, 5 * u);
      ctx.fillStyle = GLASS_FILL;
      ctx.fill();
      const fill = h * 0.86 * v.level;
      ctx.fillStyle = `rgb(${v.liquid} / 0.5)`;
      roundRect(ctx, -w / 2 + 2, -fill - 2, w - 4, fill, 3 * u);
      ctx.fill();
      ctx.strokeStyle = GLASS_STROKE;
      roundRect(ctx, -w / 2, -h, w, h, 5 * u);
      ctx.stroke();
      ctx.fillStyle = cap;
      roundRect(ctx, -9 * u, -h - 8 * u, 18 * u, 8 * u, 2 * u);
      ctx.fill();
      ctx.fillStyle = `rgb(255 255 255 / 0.18)`; // the label
      ctx.fillRect(-w / 2 + 3, -h * 0.62, w - 6, h * 0.22);
    } else {
      const base = 20 * u;
      const neck = 6 * u;
      const body = 34 * u;
      const top = 54 * u;
      ctx.beginPath();
      ctx.moveTo(-base, 0);
      ctx.lineTo(-neck, -body);
      ctx.lineTo(-neck, -top + 5 * u);
      ctx.lineTo(neck, -top + 5 * u);
      ctx.lineTo(neck, -body);
      ctx.lineTo(base, 0);
      ctx.closePath();
      ctx.fillStyle = GLASS_FILL;
      ctx.fill();
      const level = v.level * 0.6;
      ctx.beginPath();
      ctx.moveTo(-base + 1.5, -1.5);
      ctx.lineTo(-base + 1.5 + (base - neck) * level, -body * level);
      ctx.lineTo(base - 1.5 - (base - neck) * level, -body * level);
      ctx.lineTo(base - 1.5, -1.5);
      ctx.closePath();
      ctx.fillStyle = `rgb(${v.liquid} / 0.5)`;
      ctx.fill();
      ctx.strokeStyle = GLASS_STROKE;
      ctx.beginPath();
      ctx.moveTo(-base, 0);
      ctx.lineTo(-neck, -body);
      ctx.lineTo(-neck, -top + 5 * u);
      ctx.moveTo(neck, -top + 5 * u);
      ctx.lineTo(neck, -body);
      ctx.lineTo(base, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = cap;
      roundRect(ctx, -neck - 2 * u, -top, neck * 2 + 4 * u, 6 * u, 2 * u);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawTag(v: Vial) {
    if (!v.verdict || v.age > TAG_SECONDS) return;
    const fade = Math.min(1, v.age / 0.25, (TAG_SECONDS - v.age) / 0.5);
    const tone = TONES[v.verdict];
    const rise = Math.min(1, v.age / 0.5) * 6 * u;
    const dy = v.reject?.dy ?? 0;
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.font = `600 ${Math.max(9, Math.round(10.5 * u))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    v.tagWidth ??= ctx.measureText(v.text).width + 14 * u; // the words do not change once the verdict is given
    const w = v.tagWidth;
    const h = 17 * u;
    const x = v.x - w / 2;
    const y = beltY + dy - 82 * u - rise;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = `rgb(10 16 28 / 0.78)`;
    ctx.fill();
    ctx.strokeStyle = `rgb(${tone} / 0.8)`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = `rgb(${tone})`;
    ctx.fillText(v.text, v.x, y + h / 2 + 0.5);
    ctx.restore();
  }

  function drawGate(scanning?: Vial, last?: Verdict) {
    ctx.save();
    // the light curtain the vials pass through
    const top = curtainTop;
    ctx.fillStyle = curtain;
    ctx.fillRect(gateX - gateHalf, top, gateHalf * 2, beltY - top);
    ctx.strokeStyle = `rgb(${GLASS} / 0.4)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); // two posts and the arch between them
    ctx.moveTo(gateX - gateHalf - 6 * u, beltY);
    ctx.lineTo(gateX - gateHalf - 6 * u, top);
    ctx.lineTo(gateX + gateHalf + 6 * u, top);
    ctx.lineTo(gateX + gateHalf + 6 * u, beltY);
    ctx.stroke();
    // the camera on the arch, with a lamp that shows the last verdict
    roundRect(ctx, gateX - 9 * u, top - 4 * u, 18 * u, 11 * u, 3 * u);
    ctx.fillStyle = `rgb(20 30 46 / 0.9)`;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = `rgb(${last ? TONES[last] : BEAM})`;
    ctx.beginPath();
    ctx.arc(gateX, top + 1.5 * u, 2.2 * u, 0, Math.PI * 2);
    ctx.fill();
    // the scan: a bright line that climbs the vial that is in the gate
    if (scanning) {
      const progress = (scanning.x - (gateX - gateHalf)) / (gateHalf * 2);
      const y = beltY - clamp(progress) * 58 * u;
      ctx.fillStyle = scanLine;
      ctx.fillRect(gateX - gateHalf - 4 * u, y - 1, gateHalf * 2 + 8 * u, 2);
      ctx.fillStyle = `rgb(${BEAM} / 0.12)`;
      ctx.fillRect(gateX - gateHalf, y, gateHalf * 2, beltY - y);
    }
    ctx.restore();
  }

  let belt = 0;

  return {
    update(dt) {
      belt = (belt + speed * dt) % (24 * u);
      toSpawn -= speed * dt;
      if (toSpawn <= 0) {
        vials.push(make(-30 * u));
        toSpawn = gap();
      }
      for (const v of vials) {
        if (v.reject) {
          v.x += v.reject.vx * dt;
          v.reject.dy += v.reject.vy * dt;
          v.reject.vy += 700 * u * dt;
          v.reject.angle += v.reject.spin * dt;
          v.reject.life -= dt;
        } else {
          v.x += speed * dt;
        }
        if (v.verdict) v.age += dt;
        // leaving the gate, the vial is told what the scan found; a failure is blown off the line
        if (!v.verdict && v.x > gateX + gateHalf) {
          v.verdict = pickVerdict(Math.random());
          v.text = tagText(v.verdict, Math.random());
          lastVerdict = v.verdict;
          if (v.verdict === "fail") v.reject = { dy: 0, vy: -250 * u, vx: 38 * u, angle: 0, spin: (Math.random() - 0.5) * 7, life: 1.5 };
        }
      }
      for (let i = vials.length - 1; i >= 0; i--) if (vials[i].x > width + 60 * u || (vials[i].reject?.life ?? 1) <= 0) vials.splice(i, 1);
    },
    draw() {
      ctx.clearRect(0, 0, width, height);
      // the belt: a dark band with ticks that move, on rollers
      ctx.fillStyle = `rgb(18 28 44 / 0.9)`;
      ctx.fillRect(0, beltY, width, 9 * u);
      ctx.strokeStyle = `rgb(${GLASS} / 0.35)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, beltY + 0.5);
      ctx.lineTo(width, beltY + 0.5);
      ctx.stroke();
      ctx.strokeStyle = `rgb(${GLASS} / 0.14)`;
      ctx.beginPath();
      for (let x = belt - 24 * u; x < width; x += 24 * u) {
        ctx.moveTo(x, beltY + 2);
        ctx.lineTo(x - 6 * u, beltY + 9 * u - 1);
      }
      ctx.stroke();
      ctx.fillStyle = `rgb(${GLASS} / 0.18)`;
      for (let x = 20 * u; x < width; x += 44 * u) {
        ctx.beginPath();
        ctx.arc(x, beltY + 17 * u, 4 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      const scanning = vials.find((v) => !v.verdict && v.x >= gateX - gateHalf && v.x <= gateX + gateHalf);
      drawGate(scanning, lastVerdict);
      for (const v of vials) drawVial(v);
      for (const v of vials) drawTag(v);
    },
  };
}

// A quiet inspection line along the foot of the page: vials and flasks ride a belt through a gate, a scan climbs each one, and it is
// tagged PASS, REVIEW or FAIL, which is the job of the app. A failure is blown off the line. Decorative: hidden from assistive tech,
// and a still picture for reduced motion.
export function ProductionLine() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useScene(canvas, create);
  return <canvas ref={canvas} aria-hidden className="absolute inset-x-0 bottom-0 h-[clamp(160px,32vh,310px)] w-full" />;
}
