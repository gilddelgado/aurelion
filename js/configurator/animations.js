const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reducedMotion = () => !!motionQuery?.matches;

export const ease = {
  linear: (t) => t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

export class Tweens {
  constructor(onActivity = () => {}) {
    this.active = new Set();
    this.onActivity = onActivity;
  }

  add({ key, duration = 600, easing = ease.inOutCubic, update, complete }) {
    if (key) for (const t of this.active) if (t.key === key) { this.active.delete(t); t.resolve(false); }
    return new Promise((resolve) => {
      if (reducedMotion() || duration <= 0) {
        update(1); complete?.(); resolve(true); this.onActivity(); return;
      }
      this.active.add({ key, duration, easing, update, complete, resolve, start: performance.now() });
      this.onActivity();
    });
  }

  step(now) {
    if (!this.active.size) return false;
    for (const t of [...this.active]) {
      const p = Math.min(1, (now - t.start) / t.duration);
      t.update(t.easing(p));
      if (p >= 1) { this.active.delete(t); t.complete?.(); t.resolve(true); }
    }
    return true;
  }
}

export const lerp = (a, b, t) => a + (b - a) * t;
