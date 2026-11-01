import { describe, it, expect, beforeAll } from "vitest";
import { ExprEngine } from "./ExprEngine";
import { SimulationManager } from "./SimulationManager";

// the slopes evalAndStamp() stamps for an expression of two input pins at the given voltages
function slopes(expr: string, a: number, b: number): number[] {
    const stamped: number[] = [];
    const owner: any = {
        nodes: [{ v: a }, { v: b }],
        stampInputDerivative: (_p: unknown, _n: unknown, dx: number) => stamped.push(dx),
        stampInputDerivativeVS: (_vs: unknown, dx: number) => stamped.push(dx),
    };
    const engine = new ExprEngine(owner);
    expect(engine.parse(expr)).toBeNull();
    engine.alloc(2);
    engine.pinInputCount = 2;
    // as after the previous iteration, so the slope is the tangent, not a secant from 0
    engine.lastInputs = [a, b];
    engine.evalAndStamp(false);
    return stamped;
}

describe("expression slopes", () => {
    beforeAll(() => { (SimulationManager as any).theSim ??= { t: 0 }; });

    it("keep small real slopes (filter stages of macromodels, GAIN/R with R = 1e8)", () => {
        const [da, db] = slopes("1e-8*(a-b)", 0.5, 0);
        expect(da).toBeCloseTo(1e-8, 15);
        expect(db).toBeCloseTo(-1e-8, 15);
    });

    it("are accurate at millions of volts", () => {
        const [da] = slopes("315789.473684211*(a-b)", 1e8, 0);
        expect(da / 315789.473684211).toBeCloseTo(1, 6);
    });

    it("give a flat function a tiny slope, not zero", () => {
        const [da] = slopes("clamp(a,-1,1)", 5, 0);
        expect(Math.abs(da)).toBeGreaterThan(0);
        expect(Math.abs(da)).toBeLessThan(1e-9);
    });
});

describe("Newton damping", () => {
    it("leaves ordinary iterations alone and shortens the steps of long ones", () => {
        expect(SimulationManager.newtonStepFraction(0)).toBe(1);
        expect(SimulationManager.newtonStepFraction(99)).toBe(1);
        expect(SimulationManager.newtonStepFraction(100)).toBe(0.5);
        expect(SimulationManager.newtonStepFraction(4999)).toBe(0.01);
    });
});
