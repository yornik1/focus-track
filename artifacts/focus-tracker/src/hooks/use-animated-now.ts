import { useEffect, useState } from "react";

export function useAnimatedNow(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let frameId: number;

    const tick = () => {
      setNowMs(Date.now());
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  return nowMs;
}
