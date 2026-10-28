import { describe, it, expect, beforeAll } from "vitest";

// steady() of the FFT window (fftplot.js): fast acquisition goes on until it is true, so a
// start-up transient (eg after a reset) is out of the spectrum quickly

let steady: (t: number[], v: number[], f0: number, dt: number) => boolean;

beforeAll(async () => {
    // fftplot.js is a browser script: it only needs window (with addEventListener) to define itself
    (globalThis as any).window = globalThis;
    (globalThis as any).addEventListener ??= () => {};
    // @ts-ignore: plain JavaScript, no declarations
    await import("./fftplot.js");
    steady = (globalThis as any).CircuitJSFFT._test.steady;
});

// samples of a 40 Hz sine every 5 us up to time end, plus a decaying offset (a capacitor
// charging to its bias with time constant tau)
function signal(end: number, offset: number, tau: number): { t: number[]; v: number[] } {
    const t: number[] = [], v: number[] = [];
    for (let i = 0; i * 5e-6 <= end; i++) {
        const x = i * 5e-6;
        t.push(x);
        v.push(0.3 * Math.sin(2 * Math.PI * 40 * x) + offset * Math.exp(-x / tau));
    }
    return { t, v };
}

describe("FFT steady state", () => {
    it("is not reached while the bias is still settling", () => {
        const s = signal(0.3, 1, 0.05);
        expect(steady(s.t, s.v, 40, 5e-6)).toBe(false);
    });

    it("is reached once the transient has died out", () => {
        const s = signal(1.5, 1, 0.05);
        expect(steady(s.t, s.v, 40, 5e-6)).toBe(true);
    });

    it("is reached at once by a signal without a transient", () => {
        const s = signal(0.06, 0, 1);
        expect(steady(s.t, s.v, 40, 5e-6)).toBe(true);
    });

    it("needs two periods", () => {
        const s = signal(0.04, 0, 1);
        expect(steady(s.t, s.v, 40, 5e-6)).toBe(false);
    });
});
