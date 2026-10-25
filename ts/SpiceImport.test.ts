import { describe, it, expect } from "vitest";
import { SpiceImport } from "./SpiceImport";
import { SubcircuitSymbols } from "./SubcircuitSymbols";
import { UserModelLibrary } from "./UserModelLibrary";
import { DiodeModel } from "./DiodeModel";
import { TransistorModel } from "./TransistorModel";
import { MosfetModel } from "./MosfetModel";
import { CustomLogicModel } from "./CustomLogicModel";
import { ExprParser, ExprState } from "./Expr";
import { SpiceNetlist } from "./SpiceNetlist";

export const TL072 = `* TL072 OPERATIONAL AMPLIFIER "MACROMODEL" SUBCIRCUIT
* CREATED USING PARTS RELEASE 4.01 ON 06/16/89 AT 13:08
* (REV N/A)      SUPPLY VOLTAGE: +/-15V
* CONNECTIONS:   NON-INVERTING INPUT
*                | INVERTING INPUT
*                | | POSITIVE POWER SUPPLY
*                | | | NEGATIVE POWER SUPPLY
*                | | | | OUTPUT
*                | | | | |
.SUBCKT TL072    1 2 3 4 5
*
  C1   11 12 3.498E-12
  C2    6  7 15.00E-12
  DC    5 53 DX
  DE   54  5 DX
  DLP  90 91 DX
  DLN  92 90 DX
  DP    4  3 DX
  EGND 99  0 POLY(2) (3,0) (4,0) 0 .5 .5
  FB    7 99 POLY(5) VB VC VE VLP VLN 0 4.715E6 -5E6 5E6 5E6 -5E6
  GA    6  0 11 12 282.8E-6
  GCM   0  6 10 99 8.942E-9
  ISS   3 10 DC 195.0E-6
  HLIM 90  0 VLIM 1K
  J1   11  2 10 JX
  J2   12  1 10 JX
  R2    6  9 100.0E3
  RD1   4 11 3.536E3
  RD2   4 12 3.536E3
  RO1   8  5 150
  RO2   7 99 150
  RP    3  4 2.143E3
  RSS  10 99 1.026E6
  VB    9  0 DC 0
  VC    3 53 DC 2.200
  VE   54  4 DC 2.200
  VLIM  7  8 DC 0
  VLP  91  0 DC 25
  VLN   0 92 DC 25
.MODEL DX D(IS=800.0E-18)
.MODEL JX PJF(IS=15.00E-12 BETA=270.1E-6 VTO=-1)
.ENDS
`;

describe("SPICE numbers", () => {
    it("parses suffixes like SPICE", () => {
        const p = UserModelLibrary.parseNumber;
        expect(p("4.4e-9")).toBeCloseTo(4.4e-9, 20);
        expect(p("2.52n")).toBeCloseTo(2.52e-9, 20);
        expect(p("1meg")).toBe(1e6);
        expect(p("1M")).toBeCloseTo(1e-3, 12);
        expect(p("4pF")).toBeCloseTo(4e-12, 20);
        expect(p("1k")).toBe(1000);
        expect(p("-.5961")).toBeCloseTo(-0.5961, 12);
        expect(() => p("abc")).toThrow();
    });
});

describe("TL072 header", () => {
    const h = SpiceImport.analyzeHeader(TL072);
    it("reads the nodes and the pin ladder", () => {
        expect(h.nodes).toEqual(["1", "2", "3", "4", "5"]);
        expect(h.descs[0]).toBe("non-inverting input");
        expect(h.descs[4]).toBe("output");
    });
    it("guesses an op-amp with the right pins", () => {
        expect(SpiceImport.guessSymbol(h)).toBe(SubcircuitSymbols.SYM_OPAMP);
        // pins: -in, +in, out, V+, V-  ->  nodes 2, 1, 5, 3, 4
        expect(SpiceImport.guessPinNodes(h, SubcircuitSymbols.SYM_OPAMP)).toEqual([1, 0, 4, 2, 3]);
    });
});

describe("TL072 conversion", () => {
    const log: string[] = [];
    const sub = new SpiceImport(s => log.push(s)).parse(TL072);
    it("converts every element", () => {
        expect(sub, log.join("\n")).not.toBeNull();
        expect(sub!.displayName).toBe("TL072");
        expect(sub!.extList.map(e => e.name)).toEqual(["1", "2", "3", "4", "5"]);
        const lines = sub!.elmDump.split("\r").filter(l => l.length > 0);
        const dumps = sub!.dump.split(" ");
        expect(dumps.length).toBe(lines.length);
        expect(lines.filter(l => l.startsWith("JfetElm")).length).toBe(2);
        expect(lines.filter(l => l.startsWith("DiodeElm")).length).toBe(5);
        expect(lines.filter(l => l.startsWith("VoltageElm")).length).toBe(6);
        expect(lines.some(l => l.startsWith("CCCSElm"))).toBe(true);
        expect(lines.some(l => l.startsWith("CCVSElm"))).toBe(true);
    });
    it("converts the POLY sources to expressions", () => {
        const lines = sub!.elmDump.split("\r");
        const dumps = sub!.dump.split(" ").map(d => CustomLogicModel.unescape(d));
        const egnd = lines.findIndex(l => l.startsWith("VCVSElm"));
        expect(dumps[egnd]).toBe("0 2 0.5*a+0.5*b");
        const fb = lines.findIndex(l => l.startsWith("CCCSElm"));
        expect(dumps[fb]).toBe("2 10 4715000*a+-5000000*b+5000000*c+5000000*d+-5000000*e");
    });
    it("makes the PJF and diode models", () => {
        const lines = sub!.elmDump.split("\r");
        const dumps = sub!.dump.split(" ").map(d => CustomLogicModel.unescape(d));
        const j = lines.findIndex(l => l.startsWith("JfetElm"));
        // p-channel, VTO, 2*BETA
        expect(dumps[j]).toBe("1 -1 " + 2 * 270.1e-6);
        expect(DiodeModel.getModelWithName("tl072-dx").saturationCurrent).toBeCloseTo(800e-18, 30);
    });
});

describe(".model lines", () => {
    it("imports diode, BJT and MOSFET models", () => {
        const log: string[] = [];
        const n = UserModelLibrary.importModels([
            ".model D1N914X D(IS=2.52n RS=.568 N=1.752 BV=100)",
            ".model Q2N3904X NPN(IS=6.734f BF=416.4 VAF=74.03 CJE=4.493p)",
            ".model MYNMOS NMOS(VTO=2.1 KP=0.5 LAMBDA=0.01)",
            ".model MYPMOS PMOS(VTO=-2 KP=0.2)",
            ".model J201X NJF(BETA=1.304m VTO=-.5961)",
            ".model BAD XYZ(A=1)",
        ], log);
        expect(n).toBe(5);
        expect(DiodeModel.getModelWithName("D1N914X").saturationCurrent).toBeCloseTo(2.52e-9, 20);
        const tm = TransistorModel.getModelWithName("Q2N3904X");
        expect(tm.invEarlyVoltF).toBeCloseTo(1 / 74.03, 12);
        expect(tm.junctionCapBE).toBeCloseTo(4.493e-12, 20);
        expect(MosfetModel.getModelWithName("MYNMOS").threshold).toBe(2.1);
        expect(MosfetModel.getModelWithName("MYPMOS").threshold).toBe(2);
        const j = MosfetModel.getModelWithName("J201X");
        expect(j.isJfet()).toBe(true);
        expect(j.beta).toBeCloseTo(2 * 1.304e-3, 12);
        expect(UserModelLibrary.getEntries().map(e => e.name)).toContain("Q2N3904X");
        // re-parsing the written-out line gives the same model
        const e = UserModelLibrary.entries.get("Q2N3904X")!;
        const line = UserModelLibrary.toSpiceLine(e);
        UserModelLibrary.parseModelLine(line, []);
        expect(TransistorModel.getModelWithName("Q2N3904X").invEarlyVoltF).toBeCloseTo(1 / 74.03, 12);
        expect(UserModelLibrary.entries.get("Q2N3904X")!.beta).toBeCloseTo(416.4, 9);
    });
    it("renames models that clash with built-in ones", () => {
        const log: string[] = [];
        const e = UserModelLibrary.parseModelLine(".model 1N4148 D(IS=1n)", log);
        expect(e!.name).toBe("1N4148-spice");
    });
});

// written like the vendor models (eg Texas Instruments): subcircuits used by the main one,
// with PARAMS:, a VSWITCH switch, ABM expressions and models outside the subcircuits
const NESTED = `* test of nested subcircuits
.SUBCKT DET GND OUT VDD
E_GAIN1  N1 0 VALUE {1 * V(VDD)}
X_U1     N1 N2 INV_GEN PARAMS: VDD=5 VSS=0
+  VTHRESH=2.5E0
G_ABM1   VDD 0 VALUE { IF(V(VDD) < 0, 0,
+ IF(V(VDD) < 2.5, V(VDD)*4u, LIMIT(V(VDD)*2u, 1u, 10u)))  }
E_ABM2   N3 0 VALUE { (12.5m*pwr(V(N2),3)) + 1 }
X_S1     N2 0 OUT 0 DET_S1
D_D1     OUT N3 D_D1special
R_R1     0 GND 1
.ENDS DET
*$
.subckt DET_S1 1 2 3 4
S_S1  3 4 1 2 _S1
RS_S1 1 2 1G
.MODEL _S1 VSWITCH Roff=1e6 Ron=10 Voff=1 Von=4
.ends DET_S1
*$
.SUBCKT INV_GEN A  Y PARAMS: VDD=1 VSS=0 VTHRESH=0.5
E_ABMGATE    YINT 0 VALUE {{IF(V(A) > {VTHRESH} ,
+ {VSS},{VDD})}}
RINT YINT Y 1
CINT Y 0 1n
.ENDS INV_GEN
*$
.MODEL D_D1special D( IS=1e-15 TT=10p Rs=0.05 N=1.5  )
`;

describe("nested subcircuits", () => {
    const log: string[] = [];
    const sub = new SpiceImport(s => log.push(s)).parse(NESTED);
    it("expands them into the main subcircuit", () => {
        expect(sub, log.join("\n")).not.toBeNull();
        expect(sub!.name).toBe("det");
        expect(sub!.extList.map(e => e.name)).toEqual(["gnd", "out", "vdd"]);
        const elms = sub!.elmDump.split("\r").filter(x => x.length > 0).map(x => x.split(" ")[0]);
        expect(elms).toEqual(["VCVSElm", "VCVSElm", "ResistorElm", "CapacitorElm", "VCCSElm", "VCVSElm",
            "VCCSElm", "ResistorElm", "DiodeElm", "ResistorElm"]);
    });
    it("translates the expressions with the parameters of each instance", () => {
        const dump = CustomLogicModel.unescape(sub!.dump);
        // the inverter, with VTHRESH=2.5 and VDD=5
        expect(dump).toContain("0 1 ((((a>(2.5))?((0)):((5)))))");
        expect(dump).toContain("0 1 (((a<0)?0:(((a<2.5)?(a*0.000004):(clamp(a*0.000002,min(0.000001,0.00001),max(0.000001,0.00001)))))))");
        expect(dump).toContain("0 1 ((0.0125*pwr(a,3))+1)");
    });
    it("translates PSpice expressions", () => {
        const inputs: string[] = [];
        expect(SpiceNetlist.translateExpr("{V(a,b) > 1 & V(c) <> 0 | ~(time**2 = 1meg)}", inputs))
            .toBe("((a-b)>1&&c!=0||!(t^2==1000000))");
        expect(inputs).toEqual(["a", "b", "c"]);
        expect(() => SpiceNetlist.translateExpr("table(v(a),0,1)", [])).toThrow();
    });
    it("turns switches into conductances between Ron and Roff", () => {
        // the conductance the expression gives at a control voltage
        const g = (vc: number) => {
            const ix = sub!.elmDump.split("\r").findIndex(x => x.startsWith("VCCSElm") && x.split(" ").length === 5);
            expect(ix).toBeGreaterThanOrEqual(0);
            const dumps = CustomLogicModel.unescape(sub!.dump);
            const expr = dumps.split(" ").find(x => x.includes("exp"))!;
            const p = new ExprParser(expr);
            const e = p.parseExpression();
            expect(p.gotError()).toBeNull();
            const es = new ExprState(0);
            es.values[0] = 1;
            es.values[1] = vc;
            return e.eval(es);
        };
        expect(1 / g(0)).toBeCloseTo(1e6, -1);
        expect(1 / g(5)).toBeCloseTo(10, 6);
        expect(1 / g(2.5)).toBeCloseTo(Math.sqrt(10 * 1e6), -1);
    });
    it("finds the main subcircuit for the header", () => {
        expect(SpiceNetlist.findTopSubckt(SpiceImport.getLines(NESTED))).toBe("det");
        // also when the subcircuits it uses come first
        const ix = NESTED.indexOf(".subckt DET_S1");
        const reordered = NESTED.substring(ix) + NESTED.substring(0, ix);
        expect(SpiceImport.analyzeHeader(reordered).nodes).toEqual(["gnd", "out", "vdd"]);
        expect(new SpiceImport(() => {}).parse(reordered)!.name).toBe("det");
    });
});
