"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { Library } from "@/lib/library";
import type { WorldHandle, WorldOptions } from "@/world/world";

type Hooks = Omit<WorldOptions, "fontFamily">;

/** Waits for the handwriting font so bubble labels draw with it, then builds the world once. */
export function useWorld(canvas: RefObject<HTMLCanvasElement | null>, initial: Library, hooks: Hooks) {
  const world = useRef<WorldHandle | null>(null);
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const el = canvas.current;
    if (!el) return;

    const fontFamily = getComputedStyle(document.documentElement).getPropertyValue("--font-hand").trim() || "cursive";

    (async () => {
      try {
        await document.fonts.load(`56px ${fontFamily}`).catch(() => undefined);
        const { createWorld } = await import("@/world/world");
        if (disposed) return;
        world.current = createWorld(el, {
          fontFamily,
          greeting: hooksRef.current.greeting,
          say: (t, s) => hooksRef.current.say(t, s),
          think: (req) => hooksRef.current.think(req),
          tidy: () => hooksRef.current.tidy(),
          muse: () => hooksRef.current.muse(),
          resync: () => hooksRef.current.resync(),
          onOpen: (id) => hooksRef.current.onOpen(id),
          onOpenCluster: (id) => hooksRef.current.onOpenCluster(id),
          onOpenLink: (id) => hooksRef.current.onOpenLink(id),
          onMove: (id, clusterId, from) => hooksRef.current.onMove(id, clusterId, from),
        });
        world.current.load(initial);
      } catch (error) {
        console.error("[world] failed to start", error);
        setFailed("This browser couldn't draw the 3D world (WebGL is off or unsupported).");
      }
    })();

    return () => {
      disposed = true;
      world.current?.dispose();
      world.current = null;
    };
    // The world is built once; later thoughts arrive through deliver().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { world, failed };
}
