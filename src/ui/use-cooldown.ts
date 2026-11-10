import { useEffect, useState } from 'react';

export function useCooldown(retryAt: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (retryAt <= Date.now()) return;
    const interval = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= retryAt) window.clearInterval(interval);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [retryAt]);
  return Math.max(0, Math.ceil((retryAt - now) / 1000));
}
