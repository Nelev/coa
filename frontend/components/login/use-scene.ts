"use client";

import { type RefObject, useEffect } from "react";

export type Size = { width: number; height: number };
export type Scene = { update: (dt: number, now: number) => void; draw: () => void };

// Runs a canvas scene: sizes the canvas to its box (at most 2 pixels per pixel), calls update and draw every frame (at most `maxFps` a
// second: a slow scene does not need sixty), and stops for whoever has asked for less motion (one still frame is drawn) and while the
// tab is hidden. `create` builds the scene for a size, and it is built again only when the size changes.
export function useScene(canvas: RefObject<HTMLCanvasElement | null>, create: (ctx: CanvasRenderingContext2D, size: Size) => Scene, maxFps = 60) {
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const minGap = 1000 / maxFps - 2; // ms between frames; a little less, because frames arrive on the display's beat
    let scene: Scene | undefined;
    let built: Size = { width: 0, height: 0 };
    let frame = 0;
    let last = 0;

    function build() {
      if (!el || !ctx) return;
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width === 0 || height === 0 || (scene && width === built.width && height === built.height)) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      built = { width, height };
      scene = create(ctx, built);
      scene.draw();
    }

    function tick(now: number) {
      frame = requestAnimationFrame(tick);
      if (now - last < minGap) return;
      const dt = Math.min((now - last) / 1000, 0.05); // a long pause (a background tab) must not throw everything across the screen
      last = now;
      scene?.update(dt, now / 1000);
      scene?.draw();
    }

    function start() {
      cancelAnimationFrame(frame);
      if (motion.matches || document.hidden) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }

    const onMotionChange = () => {
      start();
      if (motion.matches) scene?.draw();
    };

    // it reports the size once when it starts watching, which is the first build
    const observer = new ResizeObserver(() => {
      build();
      start();
    });
    observer.observe(el);
    document.addEventListener("visibilitychange", start);
    motion.addEventListener("change", onMotionChange);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", start);
      motion.removeEventListener("change", onMotionChange);
    };
  }, [canvas, create, maxFps]);
}
