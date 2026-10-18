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

package com.lushprojects.circuitjs1.client;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Vector;

// Small-signal AC analysis (frequency response) of the circuit, used by the Bode plot
// window (war/bodeplot.js).
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
class ACAnalysis {
    SimulationManager sim;

    ACAnalysis(SimulationManager sim) {
	this.sim = sim;
    }

    // ---- AC stamps collected from reactive elements: A[i][j] += a + j*(b*w + d/w)
    // A companion stamped in stamp() (capacitors, inductors, transformers) is STATIC: it is
    // in origMatrix.  The junction capacitance of a semiconductor is stamped in doStep(),
    // and not at all at the DC operating point.
    static final int STATIC = 0, JUNCTION = 1;
    CircuitMatrix acMatrix;
    int stCount, kind;
    int stI[] = new int[64], stJ[] = new int[64], stK[] = new int[64];
    double stA[] = new double[64], stB[] = new double[64], stD[] = new double[64];

    void add(CircuitNode i, CircuitNode j, double a, double b, double d) {
	if (i == null || j == null || i.row <= 0 || j.row <= 0 || i.matrix != acMatrix || j.matrix != acMatrix)
	    return;
	if (stCount == stI.length) {
	    int n = stCount*2;
	    int ni[] = new int[n], nj[] = new int[n], nk[] = new int[n];
	    double na[] = new double[n], nb[] = new double[n], nd[] = new double[n];
	    for (int k = 0; k != stCount; k++) {
		ni[k] = stI[k]; nj[k] = stJ[k]; nk[k] = stK[k]; na[k] = stA[k]; nb[k] = stB[k]; nd[k] = stD[k];
	    }
	    stI = ni; stJ = nj; stK = nk; stA = na; stB = nb; stD = nd;
	}
	stI[stCount] = i.row-1;
	stJ[stCount] = j.row-1;
	stK[stCount] = kind;
	stA[stCount] = a;
	stB[stCount] = b;
	stD[stCount] = d;
	stCount++;
    }

    // current from cn1 to cn2 depending on voltage vn1-vn2 (same pattern as stampVCCurrentSource)
    void transAdmittance(CircuitNode cn1, CircuitNode cn2, CircuitNode vn1, CircuitNode vn2,
	    double a, double b, double d) {
	add(cn1, vn1, a, b, d);
	add(cn2, vn2, a, b, d);
	add(cn1, vn2, -a, -b, -d);
	add(cn2, vn1, -a, -b, -d);
    }

    // two-terminal admittance a + j(b*w + d/w) between p and q
    void admittance(CircuitNode p, CircuitNode q, double a, double b, double d) {
	transAdmittance(p, q, p, q, a, b, d);
    }

    // replace a capacitor companion conductance g with jwC
    void capacitor(CircuitNode p, CircuitNode q, double g, double c) {
	admittance(p, q, -g, c, 0);
    }

    // same for the junction capacitance of a semiconductor
    void junctionCapacitor(CircuitNode p, CircuitNode q, double g, double c) {
	kind = JUNCTION;
	admittance(p, q, -g, c, 0);
	kind = STATIC;
    }

    // replace an inductor companion conductance g with 1/(jwL) = -j/(wL)
    void inductor(CircuitNode p, CircuitNode q, double g, double l) {
	admittance(p, q, -g, 0, -1/l);
    }

    // collect the AC stamps of all elements for matrix m
    void collectStamps(CircuitMatrix m) {
	acMatrix = m;
	stCount = 0;
	kind = STATIC;
	for (int i = 0; i != sim.elmList.size(); i++)
	    sim.elmList.get(i).stampAC(this);
	acMatrix = null;
    }

    // (GWT has no clone() for arrays)
    static double[] copyOf(double a[]) {
	double r[] = new double[a.length];
	for (int i = 0; i != a.length; i++)
	    r[i] = a[i];
	return r;
    }

    static double[][] copyOf(double a[][]) {
	int n = a.length;
	double r[][] = new double[n][];
	for (int i = 0; i != n; i++)
	    r[i] = copyOf(a[i]);
	return r;
    }

    // Run doStep() of all elements into scratch copies of the matrices and return the copy of
    // target (its right side is left in lastRhs).  doStep() is safe to call again because the
    // simulator already calls it once per Newton subiteration.
    double lastRhs[];
    double[][] linearizeNow(CircuitMatrix target) {
	CircuitMatrix ms[] = sim.matrices;
	double saveMat[][][] = new double[ms.length][][];
	double saveRhs[][] = new double[ms.length][];
	int i;
	for (i = 0; i != ms.length; i++) {
	    CircuitMatrix m = ms[i];
	    saveMat[i] = m.matrix;
	    saveRhs[i] = m.rightSide;
	    m.matrix = copyOf(m.origMatrix);
	    m.rightSide = copyOf(m.origRightSide);
	}
	double j[][] = null;
	try {
	    for (i = 0; i != sim.elmArr.length; i++)
		sim.elmArr[i].doStep();
	    j = target.matrix;
	    lastRhs = target.rightSide;
	} finally {
	    for (i = 0; i != ms.length; i++) {
		ms[i].matrix = saveMat[i];
		ms[i].rightSide = saveRhs[i];
	    }
	}
	return j;
    }

    // ---- DC operating point

    // an inductor shorted at DC gets a conductance of DC_INDUCTOR_TIME/L
    static final double DC_INDUCTOR_TIME = 100;

    // all elements, including the children of subcircuits (which are linked to nodes directly)
    static void allElements(Vector<CircuitElm> list, Vector<CircuitElm> out) {
	for (int i = 0; i != list.size(); i++) {
	    CircuitElm ce = list.get(i);
	    out.add(ce);
	    Vector<CircuitElm> ch = ce.getChildElmList();
	    if (ch != null)
		allElements(ch, out);
	}
    }

    // Find the DC operating point of matrix m and return the Jacobian there (with the
    // companion conductances still in it), or null if the Newton solve does not converge.
    // The element state (node voltages and currents) is put back as it was.
    double[][] operatingPointJacobian(CircuitMatrix m) {
	CircuitMatrix ms[] = sim.matrices;
	Vector<CircuitElm> elms = new Vector<CircuitElm>();
	allElements(sim.elmList, elms);
	int ne = elms.size();
	double saveVolts[][] = new double[ne][];
	double saveCur[] = new double[ne];
	int i, k;
	for (i = 0; i != ne; i++) {
	    CircuitElm ce = elms.get(i);
	    saveVolts[i] = (ce.volts == null) ? null : copyOf(ce.volts);
	    saveCur[i] = ce.current;
	}
	double saveSol[][] = new double[ms.length][];
	for (i = 0; i != ms.length; i++)
	    saveSol[i] = copyOf(ms[i].rightSide);
	boolean saveConverged = sim.converged;
	boolean saveDc = sim.app.dcAnalysisFlag;

	// companions to take out of the matrix: capacitors open, inductors shorted
	collectStamps(m);
	int nst = stCount;
	int dI[] = new int[nst], dJ[] = new int[nst];
	double dA[] = new double[nst], dD[] = new double[nst];
	boolean dStatic[] = new boolean[nst];
	for (k = 0; k != nst; k++) {
	    dI[k] = stI[k]; dJ[k] = stJ[k]; dA[k] = stA[k]; dD[k] = stD[k];
	    dStatic[k] = stK[k] == STATIC;
	}

	int n = m.size;
	double j[][] = null;
	try {
	    sim.app.dcAnalysisFlag = true;
	    boolean ok = false;
	    double ar[] = new double[n*n], ai[] = new double[n*n], br[] = new double[n], bi[] = new double[n];
	    for (int iter = 0; iter != 200; iter++) {
		// elements clear converged when their voltages moved since the last iteration
		sim.converged = true;
		double jm[][] = linearizeNow(m);
		double rhs[] = lastRhs;
		if (sim.converged && iter > 0) {
		    ok = true;
		    break;
		}
		for (int r = 0; r != n; r++) {
		    for (int c = 0; c != n; c++) {
			ar[r*n+c] = jm[r][c];
			ai[r*n+c] = 0;
		    }
		    br[r] = rhs[r];
		    bi[r] = 0;
		}
		for (k = 0; k != nst; k++) {
		    int idx = dI[k]*n+dJ[k];
		    // remove the companion conductance from origMatrix (a capacitor is then open)...
		    if (dStatic[k])
			ar[idx] += dA[k];
		    // ...and short inductive parts, like a companion with dt = DC_INDUCTOR_TIME
		    if (dD[k] != 0)
			ar[idx] -= dD[k]*DC_INDUCTOR_TIME;
		}
		for (int r = 0; r != m.nodeCount; r++)
		    ar[r*n+r] += 1e-12;
		if (!solveComplex(ar, ai, br, bi, n))
		    break;
		double save[] = m.rightSide;
		m.rightSide = br;
		sim.applySolvedRightSide(m);
		m.rightSide = save;
	    }
	    sim.app.dcAnalysisFlag = saveDc;
	    if (ok)
		j = linearizeNow(m);
	} finally {
	    sim.app.dcAnalysisFlag = saveDc;
	    restoreState(elms, saveVolts, saveCur, saveSol);
	    sim.converged = saveConverged;
	}
	return j;
    }

    void restoreState(Vector<CircuitElm> elms, double saveVolts[][], double saveCur[], double saveSol[][]) {
	int i, k;
	for (i = 0; i != elms.size(); i++) {
	    CircuitElm ce = elms.get(i);
	    if (saveVolts[i] != null)
		for (k = 0; k != saveVolts[i].length; k++)
		    ce.volts[k] = saveVolts[i][k];
	}
	// set the node voltages again the way the simulator does after a solve, so values derived
	// from them (like the currents of inductors and transformers) are recomputed as well
	CircuitMatrix ms[] = sim.matrices;
	for (int mi = 0; mi != ms.length; mi++) {
	    CircuitMatrix m = ms[mi];
	    for (k = 0; k != m.nodeList.size(); k++) {
		CircuitNode cn = m.nodeList.get(k);
		if (cn.links.size() == 0)
		    continue;
		CircuitNodeLink l0 = cn.links.elementAt(0);
		double v = l0.elm.volts[l0.num];
		m.nodeVoltages[cn.row-1] = v;
		for (int li = 0; li != cn.links.size(); li++) {
		    CircuitNodeLink cnl = cn.links.elementAt(li);
		    cnl.elm.setNodeVoltage(cnl.num, v);
		}
	    }
	    // currents of voltage sources, from the last solution (if there has been one)
	    double sol[] = saveSol[mi];
	    boolean solved = false;
	    for (k = 0; k != sol.length; k++)
		if (sol[k] != 0)
		    solved = true;
	    if (solved)
		for (k = 0; k != m.voltageSourceList.size(); k++) {
		    VoltageSource vs = m.voltageSourceList.get(k);
		    vs.elm.setCurrent(vs, sol[vs.row-1]);
		}
	    m.rightSide = sol;
	}
	for (i = 0; i != elms.size(); i++)
	    elms.get(i).current = saveCur[i];
	// re-run doStep() at the restored voltages, so the state some elements keep from it (the
	// last junction voltages used to limit Newton steps, displayed currents) matches again
	if (ms.length > 0)
	    linearizeNow(ms[0]);
    }

    // ---- sources and outputs

    static class Target {
	String key, type, name;
	int num;
	double freq;
	boolean ac;
	CircuitElm elm;
	CircuitNode a, b;
    }

    Vector<Target> getSources() {
	Vector<Target> list = new Vector<Target>();
	HashMap<String,Integer> counts = new HashMap<String,Integer>();
	for (int i = 0; i != sim.elmList.size(); i++) {
	    CircuitElm ce = sim.elmList.get(i);
	    if (!(ce instanceof VoltageElm || ce instanceof SweepElm) || ce.voltSource == null)
		continue;
	    Target t = new Target();
	    t.type = ce.getClassName();
	    Integer c = counts.get(t.type);
	    t.num = (c == null) ? 1 : c+1;
	    counts.put(t.type, t.num);
	    t.key = "S:" + t.type + ":" + t.num;
	    t.elm = ce;
	    if (ce instanceof VoltageElm) {
		VoltageElm ve = (VoltageElm) ce;
		t.ac = ve.waveform != VoltageElm.WF_DC;
		t.freq = t.ac ? ve.frequency : 0;
	    } else
		t.ac = true;
	    list.add(t);
	}
	return list;
    }

    Vector<Target> getOutputs() {
	Vector<Target> list = new Vector<Target>();
	HashSet<String> labels = new HashSet<String>();
	int nOut = 0, nProbe = 0;
	for (int i = 0; i != sim.elmList.size(); i++) {
	    CircuitElm ce = sim.elmList.get(i);
	    Target t = null;
	    if (ce instanceof LabeledNodeElm) {
		String name = ((LabeledNodeElm) ce).getName();
		if (name == null || labels.contains(name))
		    continue;
		labels.add(name);
		t = new Target();
		t.key = "L:" + name;
		t.name = name;
		t.a = ce.getNode(0);
		t.b = CircuitNode.ground;
	    } else if (ce instanceof OutputElm) {
		t = new Target();
		t.num = ++nOut;
		t.key = "O:" + t.num;
		t.a = ce.getNode(0);
		t.b = CircuitNode.ground;
	    } else if (ce instanceof ProbeElm) {
		t = new Target();
		t.num = ++nProbe;
		t.key = "P:" + t.num;
		t.a = ce.getNode(0);
		t.b = ce.getNode(1);
	    }
	    if (t == null)
		continue;
	    t.type = ce.getClassName();
	    t.elm = ce;
	    list.add(t);
	}
	return list;
    }

    static Target find(Vector<Target> list, String key) {
	for (int i = 0; i != list.size(); i++)
	    if (list.get(i).key.equals(key))
		return list.get(i);
	return null;
    }

    // ---- JSON API (see JSInterface)

    String getTargetsJSON() {
	StringBuilder sb = new StringBuilder("{\"sources\":[");
	Vector<Target> src = (sim.elmList == null) ? new Vector<Target>() : getSources();
	for (int i = 0; i != src.size(); i++) {
	    Target t = src.get(i);
	    if (i > 0) sb.append(',');
	    sb.append("{\"key\":").append(quote(t.key)).append(",\"type\":").append(quote(t.type)).
	       append(",\"num\":").append(t.num).append(",\"ac\":").append(t.ac).
	       append(",\"freq\":").append(num(t.freq)).append('}');
	}
	sb.append("],\"outputs\":[");
	Vector<Target> out = (sim.elmList == null) ? new Vector<Target>() : getOutputs();
	for (int i = 0; i != out.size(); i++) {
	    Target t = out.get(i);
	    if (i > 0) sb.append(',');
	    sb.append("{\"key\":").append(quote(t.key)).append(",\"type\":").append(quote(t.type)).
	       append(",\"num\":").append(t.num).append(",\"name\":").append(t.name == null ? "null" : quote(t.name)).append('}');
	}
	sb.append("]}");
	return sb.toString();
    }

    String sweepJSON(String srcKey, String outKey, double fmin, double fmax, int npts) {
	// a change made while the simulation is stopped is otherwise only stamped when it restarts
	if (sim.needsStamp && sim.matrices != null)
	    sim.preStampAndStampCircuit();
	if (sim.matrices == null || sim.elmArr == null)
	    return error("notready");
	Target src = find(getSources(), srcKey);
	if (src == null)
	    return error("nosource");
	Target out = find(getOutputs(), outKey);
	if (out == null)
	    return error("nooutput");
	VoltageSource vs = src.elm.voltSource;
	CircuitMatrix m = vs.matrix;
	if (m == null)
	    return error("notready");
	CircuitNode na = out.a, nb = out.b;
	boolean aIn = na != null && na.row > 0 && na.matrix == m;
	boolean bIn = nb != null && nb.row > 0 && nb.matrix == m;
	if (!aIn && !bIn)
	    return error("disconnected");

	// j: linearized matrix (still with the companion conductances, replaced below).  A
	// linear matrix does not depend on the operating point.
	double j[][];
	String op = "linear";
	if (!m.nonLinear)
	    j = m.origMatrix;
	else {
	    j = operatingPointJacobian(m);
	    op = "dc";
	    if (j == null) {
		// no DC solution found: use the present (transient) state
		j = linearizeNow(m);
		op = "transient";
	    }
	}

	// reactive elements: replace companion models with their admittances
	collectStamps(m);

	int n = m.size;
	int vrow = vs.row-1;
	int ra = aIn ? na.row-1 : -1, rb = bIn ? nb.row-1 : -1;
	double are[] = new double[n*n], aim[] = new double[n*n];
	double bre[] = new double[n], bim[] = new double[n];
	if (npts < 2) npts = 2;
	if (npts > 2000) npts = 2000;
	double lmin = Math.log(fmin), lmax = Math.log(fmax);
	StringBuilder fs = new StringBuilder(), dbs = new StringBuilder(), phs = new StringBuilder();
	int bad = 0;
	for (int s = 0; s != npts; s++) {
	    double f = Math.exp(lmin + (lmax-lmin)*s/(npts-1));
	    double w = 2*Math.PI*f;
	    int r, c;
	    for (r = 0; r != n; r++) {
		double jr[] = j[r];
		for (c = 0; c != n; c++) {
		    are[r*n+c] = jr[c];
		    aim[r*n+c] = 0;
		}
		bre[r] = bim[r] = 0;
	    }
	    // tiny conductance to ground keeps nodes that only connect through caps solvable
	    for (r = 0; r != m.nodeCount; r++)
		are[r*n+r] += 1e-12;
	    for (int k = 0; k != stCount; k++) {
		int idx = stI[k]*n+stJ[k];
		are[idx] += stA[k];
		aim[idx] += stB[k]*w + stD[k]/w;
	    }
	    bre[vrow] = 1;
	    boolean ok = solveComplex(are, aim, bre, bim, n);
	    double vre = 0, vim = 0;
	    if (ok) {
		if (ra >= 0) { vre += bre[ra]; vim += bim[ra]; }
		if (rb >= 0) { vre -= bre[rb]; vim -= bim[rb]; }
	    }
	    double mag = Math.sqrt(vre*vre + vim*vim);
	    if (s > 0) { fs.append(','); dbs.append(','); phs.append(','); }
	    fs.append(num(f));
	    if (!ok || Double.isNaN(mag)) {
		bad++;
		dbs.append("null");
		phs.append("null");
	    } else {
		dbs.append(mag > 0 ? num(20*Math.log(mag)/Math.log(10)) : "-400");
		phs.append(num(Math.atan2(vim, vre)*180/Math.PI));
	    }
	}
	if (bad == npts)
	    return error("singular");
	return "{\"ok\":true,\"op\":" + quote(op) + ",\"size\":" + n +
	    ",\"f\":[" + fs + "],\"db\":[" + dbs + "],\"ph\":[" + phs + "]}";
    }

    // complex Gaussian elimination with partial pivoting (row-major, destroys a and b; x left in b)
    static boolean solveComplex(double ar[], double ai[], double br[], double bi[], int n) {
	int r, c, k;
	for (c = 0; c != n; c++) {
	    int best = c;
	    double bv = 0;
	    for (r = c; r != n; r++) {
		double mg = ar[r*n+c]*ar[r*n+c] + ai[r*n+c]*ai[r*n+c];
		if (mg > bv) { bv = mg; best = r; }
	    }
	    if (bv == 0 || Double.isNaN(bv) || Double.isInfinite(bv))
		return false;
	    if (best != c) {
		for (k = c; k != n; k++) {
		    double t = ar[c*n+k]; ar[c*n+k] = ar[best*n+k]; ar[best*n+k] = t;
		    t = ai[c*n+k]; ai[c*n+k] = ai[best*n+k]; ai[best*n+k] = t;
		}
		double t = br[c]; br[c] = br[best]; br[best] = t;
		t = bi[c]; bi[c] = bi[best]; bi[best] = t;
	    }
	    double pr = ar[c*n+c], pi = ai[c*n+c], pd = pr*pr + pi*pi;
	    for (r = c+1; r != n; r++) {
		double er = ar[r*n+c], ei = ai[r*n+c];
		if (er == 0 && ei == 0)
		    continue;
		// factor = a[r][c] / a[c][c]
		double fr = (er*pr + ei*pi)/pd, fi = (ei*pr - er*pi)/pd;
		for (k = c; k != n; k++) {
		    double xr = ar[c*n+k], xi = ai[c*n+k];
		    if (xr == 0 && xi == 0)
			continue;
		    ar[r*n+k] -= fr*xr - fi*xi;
		    ai[r*n+k] -= fr*xi + fi*xr;
		}
		br[r] -= fr*br[c] - fi*bi[c];
		bi[r] -= fr*bi[c] + fi*br[c];
	    }
	}
	for (r = n-1; r >= 0; r--) {
	    double sr = br[r], si = bi[r];
	    for (k = r+1; k != n; k++) {
		sr -= ar[r*n+k]*br[k] - ai[r*n+k]*bi[k];
		si -= ar[r*n+k]*bi[k] + ai[r*n+k]*br[k];
	    }
	    double dr = ar[r*n+r], di = ai[r*n+r], dd = dr*dr + di*di;
	    br[r] = (sr*dr + si*di)/dd;
	    bi[r] = (si*dr - sr*di)/dd;
	}
	return true;
    }

    static String error(String code) {
	return "{\"ok\":false,\"error\":" + quote(code) + "}";
    }

    static String num(double v) {
	if (Double.isNaN(v) || Double.isInfinite(v))
	    return "null";
	return Double.toString(v);
    }

    static String quote(String s) {
	StringBuilder sb = new StringBuilder("\"");
	for (int i = 0; i != s.length(); i++) {
	    char ch = s.charAt(i);
	    if (ch == '"' || ch == '\\')
		sb.append('\\').append(ch);
	    else if (ch < ' ')
		sb.append(' ');
	    else
		sb.append(ch);
	}
	return sb.append('"').toString();
    }
}
