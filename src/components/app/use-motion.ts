"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};

/** false para quem pediu menos movimento e durante a renderização no servidor. */
export const useMotionOk = () =>
  useSyncExternalStore(
    subscribe,
    () => !window.matchMedia(QUERY).matches,
    () => false,
  );

/** Número que sobe até o valor final. Sem animação, mostra o valor direto. */
export function useCountUp(target: number, duration = 700) {
  const motion = useMotionOk();
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!motion) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(target * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, motion]);
  return motion ? value : target;
}
