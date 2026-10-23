/*
    Copyright (C) Paul Falstad and Iain Sharp

    This file is part of CircuitJS1.

    CircuitJS1 is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 2 of the License, or
    (at your option) any later version.

    CircuitJS1 is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with CircuitJS1.  If not, see <http://www.gnu.org/licenses/>.
*/

import { CircuitNode } from "./CircuitNode";
import type { CircuitMatrix } from "./CircuitMatrix";
import type { SimulationManager } from "./SimulationManager";

// Small-signal AC analysis (frequency response) of the circuit, used by the Bode plot
// window (bodeplot.js).
//
// As in SPICE, the circuit is linearized at its DC operating point: capacitors open,
// inductors shorted, every source at its DC value (an AC source at its offset).  The
// operating point is found with a private Newton solve that runs the elements' own doStep()
// with CirSim.dcAnalysisFlag set, so it does not depend on the transient simulation: not on
// its speed, nor on whether it is running, nor on where the input signal happens to be.
// The transient state is put back afterwards.
//
// At that operating point the matrix the simulator builds is the Newton Jacobian, so
// transistors, JFETs, diodes, op-amps etc. are all included with their small-signal
// parameters.  The only frequency-dependent parts of it are the companion models of
// reactive elements (conductances like 2C/dt or dt/2L); each such element replaces its
// companion with the real admittance (jwC, 1/jwL) in CircuitElm.stampAC().  The input
// source gets an AC amplitude of 1, all other independent sources are AC-shorted
// (voltage) or open (current).

export class ACTarget {
    key: string;
    type: string;
    name: string | null = null;
    num: number = 0;
    freq: number = 0;
    ac: boolean = false;
    elm: any;
    a: CircuitNode | null = null;
    b: CircuitNode | null = null;
}

export class ACAnalysis {
    sim: SimulationManager;

    constructor(sim: SimulationManager) {
	this.sim = sim;
    }

    // ---- AC stamps collected from reactive elements: A[i][j] += a + j*(b*w + d/w)
    // A companion stamped in stamp() (capacitors, inductors, transformers) is STATIC: it is
    // in origMatrix.  The junction capacitance of a semiconductor is stamped in doStep(),
    // and not at all at the DC operating point.
    static readonly STATIC = 0;
    static readonly JUNCTION = 1;
    acMatrix: CircuitMatrix | null = null;
    stCount: number = 0;
    kind: number = ACAnalysis.STATIC;
    stI: number[] = [];
    stJ: number[] = [];
    stK: number[] = [];
    stA: number[] = [];
    stB: number[] = [];
    stD: number[] = [];

    add(i: CircuitNode, j: CircuitNode, a: number, b: number, d: number): void {
	if (i == null || j == null || i.row <= 0 || j.row <= 0 || i.matrix !== this.acMatrix || j.matrix !== this.acMatrix)
	    return;
	const k = this.stCount++;
	this.stI[k] = i.row-1;
	this.stJ[k] = j.row-1;
	this.stK[k] = this.kind;
	this.stA[k] = a;
	this.stB[k] = b;
	this.stD[k] = d;
    }

    // current from cn1 to cn2 depending on voltage vn1-vn2 (same pattern as stampVCCurrentSource)
    transAdmittance(cn1: CircuitNode, cn2: CircuitNode, vn1: CircuitNode, vn2: CircuitNode,
		    a: number, b: number, d: number): void {
	this.add(cn1, vn1, a, b, d);
	this.add(cn2, vn2, a, b, d);
	this.add(cn1, vn2, -a, -b, -d);
	this.add(cn2, vn1, -a, -b, -d);
    }

    // two-terminal admittance a + j(b*w + d/w) between p and q
    admittance(p: CircuitNode, q: CircuitNode, a: number, b: number, d: number): void {
	this.transAdmittance(p, q, p, q, a, b, d);
    }

    // replace a capacitor companion conductance g with jwC
    capacitor(p: CircuitNode, q: CircuitNode, g: number, c: number): void {
	this.admittance(p, q, -g, c, 0);
    }

    // same for the junction capacitance of a semiconductor
    junctionCapacitor(p: CircuitNode, q: CircuitNode, g: number, c: number): void {
	this.kind = ACAnalysis.JUNCTION;
	this.admittance(p, q, -g, c, 0);
	this.kind = ACAnalysis.STATIC;
    }

    // replace an inductor companion conductance g with 1/(jwL) = -j/(wL)
    inductor(p: CircuitNode, q: CircuitNode, g: number, l: number): void {
	this.admittance(p, q, -g, 0, -1/l);
    }

    // collect the AC stamps of all elements for matrix m.  sim.elmList has the children of
    // subcircuits in it as well (they are simulated directly), so composites forward nothing.
    collectStamps(m: CircuitMatrix): void {
	this.acMatrix = m;
	this.stCount = 0;
	this.kind = ACAnalysis.STATIC;
	const list = this.sim.elmList;
	for (let i = 0; i !== list.length; i++)
	    list[i].stampAC(this);
	this.acMatrix = null;
    }

    static copyOf2(a: number[][]): number[][] {
	return a.map(r => r.slice());
    }

    // Run doStep() of all elements into scratch copies of the matrices and return the copy of
    // target (its right side is left in lastRhs).  doStep() is safe to call again because the
    // simulator already calls it once per Newton subiteration.
    lastRhs: number[] = [];
    linearizeNow(target: CircuitMatrix): number[][] {
	const ms = this.sim.matrices!;
	const saveMat: number[][][] = new Array(ms.length);
	const saveRhs: number[][] = new Array(ms.length);
	let i: number;
	for (i = 0; i !== ms.length; i++) {
	    const m = ms[i];
	    saveMat[i] = m.matrix;
	    saveRhs[i] = m.rightSide;
	    m.matrix = ACAnalysis.copyOf2(m.origMatrix);
	    m.rightSide = m.origRightSide.slice();
	}
	let j: number[][] = null;
	try {
	    const elmArr = this.sim.elmArr;
	    for (i = 0; i !== elmArr.length; i++)
		elmArr[i].doStep();
	    j = target.matrix;
	    this.lastRhs = target.rightSide;
	} finally {
	    for (i = 0; i !== ms.length; i++) {
		ms[i].matrix = saveMat[i];
		ms[i].rightSide = saveRhs[i];
	    }
	}
	return j;
    }

    // ---- DC operating point

    // an inductor shorted at DC gets a conductance of DC_INDUCTOR_TIME/L
    static readonly DC_INDUCTOR_TIME = 100;

    // Find the DC operating point of matrix m and return the Jacobian there (with the
    // companion conductances still in it), or null if the Newton solve does not converge.
    // The circuit state (node voltages and element currents) is put back as it was.
    operatingPointJacobian(m: CircuitMatrix): number[][] | null {
	const sim = this.sim;
	const ms = sim.matrices!;
	// all elements, including the children of subcircuits
	const elms: any[] = sim.elmList;
	const ne = elms.length;
	const saveCur: number[] = new Array(ne);
	let i: number, k: number;
	for (i = 0; i !== ne; i++)
	    saveCur[i] = elms[i].current;
	const saveNv: number[][] = new Array(ms.length);
	const saveSol: number[][] = new Array(ms.length);
	for (i = 0; i !== ms.length; i++) {
	    saveNv[i] = ms[i].nodeVoltages.slice();
	    saveSol[i] = ms[i].rightSide.slice();
	}
	const saveConverged = sim.converged;
	const saveDc = sim.app.dcAnalysisFlag;

	// companions to take out of the matrix: capacitors open, inductors shorted
	this.collectStamps(m);
	const nst = this.stCount;
	const dI = this.stI.slice(0, nst), dJ = this.stJ.slice(0, nst);
	const dA = this.stA.slice(0, nst), dD = this.stD.slice(0, nst);
	const dStatic: boolean[] = new Array(nst);
	for (k = 0; k !== nst; k++)
	    dStatic[k] = this.stK[k] === ACAnalysis.STATIC;

	const n = m.size;
	let j: number[][] | null = null;
	try {
	    sim.app.dcAnalysisFlag = true;
	    let ok = false;
	    const ar = new Float64Array(n*n), ai = new Float64Array(n*n);
	    const br = new Float64Array(n), bi = new Float64Array(n);
	    for (let iter = 0; iter !== 200; iter++) {
		// elements clear converged when their voltages moved since the last iteration
		sim.converged = true;
		const jm = this.linearizeNow(m);
		const rhs = this.lastRhs;
		if (sim.converged && iter > 0) {
		    ok = true;
		    break;
		}
		for (let r = 0; r !== n; r++) {
		    const jr = jm[r];
		    for (let c = 0; c !== n; c++) {
			ar[r*n+c] = jr[c];
			ai[r*n+c] = 0;
		    }
		    br[r] = rhs[r];
		    bi[r] = 0;
		}
		for (k = 0; k !== nst; k++) {
		    const idx = dI[k]*n+dJ[k];
		    // remove the companion conductance from origMatrix (a capacitor is then open)...
		    if (dStatic[k])
			ar[idx] += dA[k];
		    // ...and short inductive parts, like a companion with dt = DC_INDUCTOR_TIME
		    if (dD[k] !== 0)
			ar[idx] -= dD[k]*ACAnalysis.DC_INDUCTOR_TIME;
		}
		for (let r = 0; r !== m.nodeCount; r++)
		    ar[r*n+r] += 1e-12;
		if (!ACAnalysis.solveComplex(ar, ai, br, bi, n))
		    break;
		const save = m.rightSide;
		m.rightSide = Array.from(br);
		sim.applySolvedRightSide(m);
		m.rightSide = save;
	    }
	    sim.app.dcAnalysisFlag = saveDc;
	    if (ok)
		j = this.linearizeNow(m);
	} finally {
	    sim.app.dcAnalysisFlag = saveDc;
	    this.restoreState(elms, saveCur, saveNv, saveSol);
	    sim.converged = saveConverged;
	}
	return j;
    }

    restoreState(elms: any[], saveCur: number[], saveNv: number[][], saveSol: number[][]): void {
	const sim = this.sim;
	const ms = sim.matrices!;
	let i: number, k: number;
	// set the node voltages again the way the simulator does after a solve, so values derived
	// from them (like the currents of capacitors and inductors) are recomputed as well
	for (let mi = 0; mi !== ms.length; mi++) {
	    const m = ms[mi];
	    for (k = 0; k !== m.nodeCount; k++)
		m.nodeVoltages[k] = saveNv[mi][k];
	    sim.setNodeVoltages(m, m.nodeVoltages);
	    // currents of voltage sources, from the last solution (if there has been one)
	    const sol = saveSol[mi];
	    let solved = false;
	    for (k = 0; k !== sol.length; k++)
		if (sol[k] !== 0)
		    solved = true;
	    if (solved)
		for (k = 0; k !== m.voltageSourceList.length; k++) {
		    const vs = m.voltageSourceList[k];
		    vs.elm.setCurrent(vs, sol[vs.row-1]);
		}
	    m.rightSide = sol;
	}
	for (i = 0; i !== elms.length; i++)
	    elms[i].current = saveCur[i];
	// re-run doStep() at the restored voltages, so the state some elements keep from it (the
	// last junction voltages used to limit Newton steps, displayed currents) matches again
	if (ms.length > 0)
	    this.linearizeNow(ms[0]);
    }

    // ---- sources and outputs (the elements of the circuit itself, not inside subcircuits)

    getSources(): ACTarget[] {
	const list: ACTarget[] = [];
	const counts = new Map<string, number>();
	const elmList: any[] = this.sim.app.elmList;
	for (let i = 0; i !== elmList.length; i++) {
	    const ce = elmList[i];
	    const sweep = ce.getClassName() === "SweepElm";
	    if (!(ce.isVoltageElm() || sweep) || ce.voltSource == null)
		continue;
	    const t = new ACTarget();
	    t.type = ce.getClassName();
	    const c = counts.get(t.type);
	    t.num = (c == null) ? 1 : c+1;
	    counts.set(t.type, t.num);
	    t.key = "S:" + t.type + ":" + t.num;
	    t.elm = ce;
	    if (!sweep) {
		t.ac = ce.waveform !== 0;	// VoltageElm.WF_DC
		t.freq = t.ac ? ce.frequency : 0;
	    } else
		t.ac = true;
	    list.push(t);
	}
	return list;
    }

    getOutputs(): ACTarget[] {
	const list: ACTarget[] = [];
	const labels = new Set<string>();
	let nOut = 0, nProbe = 0;
	const elmList: any[] = this.sim.app.elmList;
	for (let i = 0; i !== elmList.length; i++) {
	    const ce = elmList[i];
	    let t: ACTarget | null = null;
	    if (ce.isLabeledNodeElm()) {
		const name: string = ce.getName();
		if (name == null || labels.has(name))
		    continue;
		labels.add(name);
		t = new ACTarget();
		t.key = "L:" + name;
		t.name = name;
		t.a = ce.getNode(0);
		t.b = CircuitNode.ground;
	    } else if (ce.isOutputElm()) {
		t = new ACTarget();
		t.num = ++nOut;
		t.key = "O:" + t.num;
		t.a = ce.getNode(0);
		t.b = CircuitNode.ground;
	    } else if (ce.isProbeElm()) {
		t = new ACTarget();
		t.num = ++nProbe;
		t.key = "P:" + t.num;
		t.a = ce.getNode(0);
		t.b = ce.getNode(1);
	    }
	    if (t == null)
		continue;
	    t.type = ce.getClassName();
	    t.elm = ce;
	    list.push(t);
	}
	return list;
    }

    static find(list: ACTarget[], key: string): ACTarget | null {
	for (let i = 0; i !== list.length; i++)
	    if (list[i].key === key)
		return list[i];
	return null;
    }

    // ---- API for JSInterface (plain objects, as the JSON the Java version returned)

    getTargets(): object {
	const ready = this.sim.app.elmList != null;
	const src = ready ? this.getSources() : [];
	const out = ready ? this.getOutputs() : [];
	return {
	    sources: src.map(t => ({ key: t.key, type: t.type, num: t.num, ac: t.ac, freq: ACAnalysis.num(t.freq) })),
	    outputs: out.map(t => ({ key: t.key, type: t.type, num: t.num, name: t.name }))
	};
    }

    sweep(srcKey: string, outKey: string, fmin: number, fmax: number, npts: number): object {
	const sim = this.sim;
	// a change made while the simulation is stopped is otherwise only stamped when it restarts
	if (sim.needsStamp && sim.matrices != null)
	    sim.preStampAndStampCircuit();
	if (sim.matrices == null || sim.elmArr == null)
	    return ACAnalysis.error("notready");
	const src = ACAnalysis.find(this.getSources(), srcKey);
	if (src == null)
	    return ACAnalysis.error("nosource");
	const out = ACAnalysis.find(this.getOutputs(), outKey);
	if (out == null)
	    return ACAnalysis.error("nooutput");
	const vs = src.elm.voltSource;
	const m: CircuitMatrix = vs.matrix;
	if (m == null)
	    return ACAnalysis.error("notready");
	const na = out.a, nb = out.b;
	const aIn = na != null && na.row > 0 && na.matrix === m;
	const bIn = nb != null && nb.row > 0 && nb.matrix === m;
	if (!aIn && !bIn)
	    return ACAnalysis.error("disconnected");

	// j: linearized matrix (still with the companion conductances, replaced below).  A
	// linear matrix does not depend on the operating point.
	let j: number[][];
	let op = "linear";
	if (!m.nonLinear)
	    j = m.origMatrix;
	else {
	    j = this.operatingPointJacobian(m);
	    op = "dc";
	    if (j == null) {
		// no DC solution found: use the present (transient) state
		j = this.linearizeNow(m);
		op = "transient";
	    }
	}

	// reactive elements: replace companion models with their admittances
	this.collectStamps(m);

	const n = m.size;
	const vrow = vs.row-1;
	const ra = aIn ? na.row-1 : -1, rb = bIn ? nb.row-1 : -1;
	const are = new Float64Array(n*n), aim = new Float64Array(n*n);
	const bre = new Float64Array(n), bim = new Float64Array(n);
	npts = Math.trunc(npts) || 0;
	if (npts < 2) npts = 2;
	if (npts > 2000) npts = 2000;
	const lmin = Math.log(fmin), lmax = Math.log(fmax);
	const fs: (number | null)[] = [], dbs: (number | null)[] = [], phs: (number | null)[] = [];
	let bad = 0;
	for (let s = 0; s !== npts; s++) {
	    const f = Math.exp(lmin + (lmax-lmin)*s/(npts-1));
	    const w = 2*Math.PI*f;
	    let r: number, c: number;
	    for (r = 0; r !== n; r++) {
		const jr = j[r];
		for (c = 0; c !== n; c++) {
		    are[r*n+c] = jr[c];
		    aim[r*n+c] = 0;
		}
		bre[r] = bim[r] = 0;
	    }
	    // tiny conductance to ground keeps nodes that only connect through caps solvable
	    for (r = 0; r !== m.nodeCount; r++)
		are[r*n+r] += 1e-12;
	    for (let k = 0; k !== this.stCount; k++) {
		const idx = this.stI[k]*n+this.stJ[k];
		are[idx] += this.stA[k];
		aim[idx] += this.stB[k]*w + this.stD[k]/w;
	    }
	    bre[vrow] = 1;
	    const ok = ACAnalysis.solveComplex(are, aim, bre, bim, n);
	    let vre = 0, vim = 0;
	    if (ok) {
		if (ra >= 0) { vre += bre[ra]; vim += bim[ra]; }
		if (rb >= 0) { vre -= bre[rb]; vim -= bim[rb]; }
	    }
	    const mag = Math.sqrt(vre*vre + vim*vim);
	    fs.push(ACAnalysis.num(f));
	    if (!ok || isNaN(mag)) {
		bad++;
		dbs.push(null);
		phs.push(null);
	    } else {
		dbs.push(mag > 0 ? ACAnalysis.num(20*Math.log(mag)/Math.log(10)) : -400);
		phs.push(ACAnalysis.num(Math.atan2(vim, vre)*180/Math.PI));
	    }
	}
	if (bad === npts)
	    return ACAnalysis.error("singular");
	return { ok: true, op: op, size: n, f: fs, db: dbs, ph: phs };
    }

    // complex Gaussian elimination with partial pivoting (row-major, destroys a and b; x left in b)
    static solveComplex(ar: Float64Array, ai: Float64Array, br: Float64Array, bi: Float64Array, n: number): boolean {
	let r: number, c: number, k: number;
	for (c = 0; c !== n; c++) {
	    let best = c;
	    let bv = 0;
	    for (r = c; r !== n; r++) {
		const mg = ar[r*n+c]*ar[r*n+c] + ai[r*n+c]*ai[r*n+c];
		if (mg > bv) { bv = mg; best = r; }
	    }
	    if (bv === 0 || !isFinite(bv))
		return false;
	    if (best !== c) {
		for (k = c; k !== n; k++) {
		    let t = ar[c*n+k]; ar[c*n+k] = ar[best*n+k]; ar[best*n+k] = t;
		    t = ai[c*n+k]; ai[c*n+k] = ai[best*n+k]; ai[best*n+k] = t;
		}
		let t = br[c]; br[c] = br[best]; br[best] = t;
		t = bi[c]; bi[c] = bi[best]; bi[best] = t;
	    }
	    const pr = ar[c*n+c], pi = ai[c*n+c], pd = pr*pr + pi*pi;
	    for (r = c+1; r !== n; r++) {
		const er = ar[r*n+c], ei = ai[r*n+c];
		if (er === 0 && ei === 0)
		    continue;
		// factor = a[r][c] / a[c][c]
		const fr = (er*pr + ei*pi)/pd, fi = (ei*pr - er*pi)/pd;
		for (k = c; k !== n; k++) {
		    const xr = ar[c*n+k], xi = ai[c*n+k];
		    if (xr === 0 && xi === 0)
			continue;
		    ar[r*n+k] -= fr*xr - fi*xi;
		    ai[r*n+k] -= fr*xi + fi*xr;
		}
		br[r] -= fr*br[c] - fi*bi[c];
		bi[r] -= fr*bi[c] + fi*br[c];
	    }
	}
	for (r = n-1; r >= 0; r--) {
	    let sr = br[r], si = bi[r];
	    for (k = r+1; k !== n; k++) {
		sr -= ar[r*n+k]*br[k] - ai[r*n+k]*bi[k];
		si -= ar[r*n+k]*bi[k] + ai[r*n+k]*br[k];
	    }
	    const dr = ar[r*n+r], di = ai[r*n+r], dd = dr*dr + di*di;
	    br[r] = (sr*dr + si*di)/dd;
	    bi[r] = (si*dr - sr*di)/dd;
	}
	return true;
    }

    static error(code: string): object {
	return { ok: false, error: code };
    }

    static num(v: number): number | null {
	return isFinite(v) ? v : null;
    }
}
