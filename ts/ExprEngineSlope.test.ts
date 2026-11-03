import { describe, it, expect, beforeAll } from "vitest";
import { ExprEngine } from "./ExprEngine";
import { SimulationManager } from "./SimulationManager";

// the slopes evalAndStamp() stamps for an expression of two input pins at the given voltages
function slopes(expr: string, a: number, b: number, lastA: number = a): number[] {
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
    // the inputs at the previous iteration: the same (converging) unless given
    engine.lastInputs = [lastA, b];
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

    it("give a saturated limit the slope of the line back to zero while its input moves", () => {
        expect(slopes("clamp(a,-1,1)", 5, 0, 7)[0]).toBeCloseTo(1 / 5, 12);
        expect(slopes("clamp(a,-1,1)", -4, 0, -6)[0]).toBeCloseTo(1 / 4, 12);
        // in the linear region the slope is the real one
        expect(slopes("clamp(a,-1,1)", 0.5, 0, 0.6)[0]).toBeCloseTo(1, 9);
    });

    it("use the real (flat) slope of a saturated limit near the solution", () => {
        const [da] = slopes("clamp(a,-1,1)", 5, 0);
        expect(Math.abs(da)).toBeLessThan(1e-9);
    });

    it("give a function flat everywhere a tiny slope, not zero", () => {
        const [da] = slopes("3+0*a", 5, 0);
        expect(Math.abs(da)).toBeGreaterThan(0);
        expect(Math.abs(da)).toBeLessThan(1e-9);
    });
});
