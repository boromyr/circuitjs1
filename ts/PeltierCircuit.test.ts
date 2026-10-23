import { describe, it, expect } from "vitest";
import { CircuitElm } from "./CircuitElm";
import { SimulationManager } from "./SimulationManager";
import { PeltierElm } from "./PeltierElm";
import { VoltageElm } from "./VoltageElm";
import { ResistorElm } from "./ResistorElm";
import { GroundElm } from "./GroundElm";
import { WireElm } from "./WireElm";

const off = { getState: () => false };

function makeApp(elmList: any[]): any {
    const app: any = {
        elmList, postDrawList: [], badConnectionList: [],
        showResistanceInVoltageSources: true, dumpMatrix: false, stopMessage: null,
        dcAnalysisFlag: false, simRunning: true, minFrameRate: 10,
        menus: {
            showValuesCheckItem: off, powerCheckItem: off, euroResistorCheckItem: off,
            showOhmCheckItem: off, smallGridCheckItem: off,
        },
        ui: { elmList, steps: 0, lastFrameTime: 0 },
        scopeManager: { canDelayWireProcessing: () => false },
        setStopElm: () => {}, getIterCount: () => 1, isPrintable: () => false,
        onTimeStep: () => {},
        stop: (s: string) => { app.stopMessage = s; },
    };
    return app;
}

function place(e: any, x1: number, y1: number, x2: number, y2: number) {
    e.x = x1; e.y = y1; e.x2 = x2; e.y2 = y2;
    e.setPoints();
    return e;
}

function source(x1: number, y1: number, x2: number, y2: number, v: number): any {
    const vs: any = place(new VoltageElm(0, 0, VoltageElm.WF_DC), x1, y1, x2, y2);
    vs.maxVoltage = v;
    return vs;
}

function resistor(x1: number, y1: number, x2: number, y2: number, r: number): any {
    const re: any = place(new ResistorElm(0, 0), x1, y1, x2, y2);
    re.resistance = r;
    return re;
}

// the thermoelectric-cooler example: 2V drive on the electrical side, hot face
// through 0.5K/W and cold face through 1K/W to a 293K ambient
function cooler(): any[] {
    return [
        place(new PeltierElm(0, 0), 400, 208, 496, 208),
        source(336, 288, 336, 192, 2),
        place(new GroundElm(0, 0), 336, 288, 336, 320),
        place(new WireElm(0, 0), 336, 192, 400, 192),
        place(new WireElm(0, 0), 400, 224, 288, 224),
        place(new GroundElm(0, 0), 288, 224, 288, 256),
        resistor(496, 192, 592, 192, 0.5),
        resistor(496, 224, 592, 224, 1),
        place(new WireElm(0, 0), 592, 192, 592, 224),
        source(592, 288, 592, 224, 293),
        place(new GroundElm(0, 0), 592, 288, 592, 320),
    ];
}

function analyzeAndStep(elms: any[]) {
    const app = makeApp(elms);
    (CircuitElm as any).app = app;
    const sim = new SimulationManager(app as any);
    (CircuitElm as any).sim = sim;
    sim.analyzeCircuit();
    sim.preStampCircuit(false);
    sim.stampCircuit();
    for (const m of sim.matrices!) {
        for (let i = 0; i < m.size; i++) m.rightSide[i] = m.origRightSide[i];
        if (m.nonLinear)
            for (let i = 0; i < m.size; i++)
                for (let j = 0; j < m.size; j++) m.matrix[i][j] = m.origMatrix[i][j];
    }
    for (const e of elms) e.doStep();
    let factored = true;
    for (const m of sim.matrices!)
        if (!(SimulationManager as any).lu_factor(m.matrix, m.size, m.permute, m)) factored = false;
    return { sim, factored };
}

describe("thermoelectric (Peltier) element", () => {
    // the split-matrix solver groups nodes with getMatrixConnection(); the Seebeck
    // source ends on an internal node that getConnection() links to nothing, so
    // without keeping all the element's nodes together it got a matrix of its own
    // and the examples stopped with "Singular matrix!"
    it("keeps its electrical, thermal and internal nodes in one solvable matrix", () => {
        const elms = cooler();
        const { factored } = analyzeAndStep(elms);
        const pe: any = elms[0];
        const m = pe.nodes[4].matrix;
        expect(m).not.toBeNull();
        for (let i = 0; i < 4; i++)
            expect(pe.nodes[i].index === 0 || pe.nodes[i].matrix === m).toBe(true);
        expect(factored, "matrix should not be singular").toBe(true);
    });
});
