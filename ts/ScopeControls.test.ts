import { describe, it, expect } from "vitest";
import { ScopeControls } from "./ScopeControls";
import { Scope } from "./Scope";

// the side panel scale sliders and the time/div they produce
describe("scope quick control scales", () => {
    it("vertical slider runs from 1n to 500 per division in a 1-2-5 sequence", () => {
        expect(ScopeControls.vIndexToScale(0)).toBeCloseTo(1e-9, 20);
        expect(ScopeControls.vIndexToScale(1)).toBeCloseTo(2e-9, 20);
        expect(ScopeControls.vIndexToScale(2)).toBeCloseTo(5e-9, 20);
        expect(ScopeControls.vIndexToScale(ScopeControls.V_STEPS - 1)).toBeCloseTo(500, 6);
        for (let n = 0; n !== ScopeControls.V_STEPS; n++)
            expect(ScopeControls.vScaleToIndex(ScopeControls.vIndexToScale(n))).toBe(n);
    });

    it("horizontal slider has four steps per doubling over the 1..1024 speeds", () => {
        const sp = ScopeControls.speeds;
        expect(sp[0]).toBe(1);
        expect(sp[sp.length - 1]).toBe(1024);
        expect(sp.length).toBe(36);
        for (let i = 0; i !== sp.length; i++)
            expect(ScopeControls.speedToIndex(sp[i])).toBe(i);
        // speeds set elsewhere snap to the nearest step
        expect(sp[ScopeControls.speedToIndex(1000)]).toBe(1024);
    });

    it("time/div follows the speed with a finer step sequence", () => {
        const scope = Object.create(Scope.prototype) as Scope;
        (scope as any).sim = { maxTimeStep: 5e-6 };
        const steps: number[] = [];
        for (const s of ScopeControls.speeds) {
            scope.speed = s;
            const gs = scope.calcGridStepX();
            // at least 20 pixels per division, and a "nice" mantissa
            expect(gs).toBeGreaterThanOrEqual(5e-6 * s * 20 * 0.999999);
            const m = gs / Math.pow(10, Math.floor(Math.log10(gs) + 1e-9));
            expect(Scope.gridStepXMantissa.some(x => Math.abs(x - m) < 1e-6)).toBe(true);
            steps.push(gs);
        }
        for (let i = 1; i < steps.length; i++)
            expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
        // finer than 1-2-5: most of the 36 speeds get a time/div of their own
        expect(new Set(steps).size).toBeGreaterThan(28);
        (scope as any).sim = { maxTimeStep: 0 };
        expect(scope.calcGridStepX()).toBe(1);
    });
});
