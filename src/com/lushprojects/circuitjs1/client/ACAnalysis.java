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

// Small-signal AC analysis (frequency response) of the running circuit, used by the
// Bode plot window (war/bodeplot.js).
//
// The circuit is linearized at its operating point using the matrix the simulator
// already builds: after a converged timestep, the matrix of a nonlinear circuit is the
// Newton Jacobian, so transistors, JFETs, diodes, op-amps etc. are all included with
// their small-signal parameters.  The only frequency-dependent parts of that matrix are
// the companion models of reactive elements (conductances like 2C/dt or dt/2L); each
// such element replaces its companion with the real admittance (jwC, 1/jwL) in
// CircuitElm.stampAC().  The input source gets an AC amplitude of 1, all other
// independent sources are AC-shorted (voltage) or open (current).
//
// When the input is large (e.g. a 1V sine into a tone stack followed by a JFET stage),
// the operating point moves during the signal period, so while the plot is open the
// Jacobian of a nonlinear circuit is averaged over one period of the input source to get
// a stable result.  The companion conductances are removed from each sample before it is
// averaged, so the average does not depend on the timestep (which the simulator may change
// while it runs).
class ACAnalysis {
    SimulationManager sim;

    ACAnalysis(SimulationManager sim) {
	this.sim = sim;
    }

    // ---- AC stamps collected from reactive elements: A[i][j] += a + j*(b*w + d/w)
    CircuitMatrix acMatrix;
    int stCount;
    int stI[] = new int[64], stJ[] = new int[64];
    double stA[] = new double[64], stB[] = new double[64], stD[] = new double[64];

    void add(CircuitNode i, CircuitNode j, double a, double b, double d) {
	if (i == null || j == null || i.row <= 0 || j.row <= 0 || i.matrix != acMatrix || j.matrix != acMatrix)
	    return;
	if (stCount == stI.length) {
	    int n = stCount*2;
	    int ni[] = new int[n], nj[] = new int[n];
	    double na[] = new double[n], nb[] = new double[n], nd[] = new double[n];
	    for (int k = 0; k != stCount; k++) {
		ni[k] = stI[k]; nj[k] = stJ[k]; na[k] = stA[k]; nb[k] = stB[k]; nd[k] = stD[k];
	    }
	    stI = ni; stJ = nj; stA = na; stB = nb; stD = nd;
	}
	stI[stCount] = i.row-1;
	stJ[stCount] = j.row-1;
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

    // replace an inductor companion conductance g with 1/(jwL) = -j/(wL)
    void inductor(CircuitNode p, CircuitNode q, double g, double l) {
	admittance(p, q, -g, 0, -1/l);
    }

    // ---- Jacobian (without companion conductances) averaged over the input period while the plot is open
    long lastRequest;
    CircuitMatrix avgMatrix;
    double avgStart, avgWindow;
    double avgSum[][], avgJ[][];
    int avgCount;

    // collect the AC stamps of all elements for matrix m
    void collectStamps(CircuitMatrix m) {
	acMatrix = m;
	stCount = 0;
	for (int i = 0; i != sim.elmList.size(); i++)
	    sim.elmList.get(i).stampAC(this);
	acMatrix = null;
    }

    boolean capturing() {
	return avgMatrix != null && System.currentTimeMillis() - lastRequest < 3000;
    }

    // called by SimulationManager.runCircuit() after a timestep has converged
    void stepConverged() {
	if (!capturing())
	    return;
	CircuitMatrix m = avgMatrix;
	// a linear matrix does not depend on the operating point, nothing to average
	if (!m.nonLinear)
	    return;
	// after the last (converged) subiteration a nonlinear matrix is left unfactored,
	// so it holds the Jacobian
	double j[][] = m.matrix;
	if (avgSum == null || avgSum.length != m.size) {
	    avgSum = new double[m.size][m.size];
	    avgJ = null;
	    avgCount = 0;
	    avgStart = sim.t;
	}
	int i, k;
	for (i = 0; i != m.size; i++) {
	    double s[] = avgSum[i], r[] = j[i];
	    for (k = 0; k != m.size; k++)
		s[k] += r[k];
	}
	// remove the companion conductances of this timestep
	collectStamps(m);
	for (k = 0; k != stCount; k++)
	    avgSum[stI[k]][stJ[k]] += stA[k];
	avgCount++;
	if (sim.t + sim.timeStep - avgStart >= avgWindow) {
	    avgJ = scaled(avgSum, 1.0/avgCount);
	    for (i = 0; i != m.size; i++)
		for (k = 0; k != m.size; k++)
		    avgSum[i][k] = 0;
	    avgCount = 0;
	    avgStart = sim.t + sim.timeStep;
	}
    }

    static double[][] scaled(double a[][], double f) {
	int n = a.length;
	double r[][] = new double[n][n];
	for (int i = 0; i != n; i++)
	    for (int k = 0; k != n; k++)
		r[i][k] = a[i][k]*f;
	return r;
    }

    // linearize the circuit now (used when there is no captured Jacobian, e.g. when the
    // simulation is stopped).  Re-runs doStep() into scratch matrices; doStep() is safe to call
    // again because the simulator already calls it once per Newton subiteration.
    double[][] linearizeNow(CircuitMatrix target) {
	CircuitMatrix ms[] = sim.matrices;
	double saveMat[][][] = new double[ms.length][][];
	double saveRhs[][] = new double[ms.length][];
	boolean saveConverged = sim.converged;
	int i;
	for (i = 0; i != ms.length; i++) {
	    CircuitMatrix m = ms[i];
	    saveMat[i] = m.matrix;
	    saveRhs[i] = m.rightSide;
	    m.matrix = scaled(m.origMatrix, 1);
	    m.rightSide = new double[m.size];
	}
	double j[][] = null;
	try {
	    for (i = 0; i != sim.elmArr.length; i++)
		sim.elmArr[i].doStep();
	    j = target.matrix;
	} finally {
	    for (i = 0; i != ms.length; i++) {
		ms[i].matrix = saveMat[i];
		ms[i].rightSide = saveRhs[i];
	    }
	    sim.converged = saveConverged;
	}
	return j;
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
	lastRequest = System.currentTimeMillis();
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

	// averaging window: one period of the input source (at least a few timesteps)
	double window = (src.freq > 0) ? 1/src.freq : 0;
	window = Math.min(Math.max(window, 4*sim.timeStep), 1);
	if (avgMatrix != m || avgWindow != window) {
	    avgMatrix = m;
	    avgWindow = window;
	    avgSum = avgJ = null;
	}
	// j: linearized matrix; withCompanions: it still contains the companion conductances
	double j[][];
	boolean averaged = false, withCompanions = true;
	if (!m.nonLinear)
	    j = m.origMatrix;
	else if (avgJ != null && avgJ.length == m.size) {
	    j = avgJ;
	    averaged = true;
	    withCompanions = false;
	} else if (sim.app.simIsRunning())
	    // the first average is ready after one period of the input
	    return error("notready");
	else
	    j = linearizeNow(m);

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
		if (withCompanions)
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
	return "{\"ok\":true,\"averaged\":" + averaged + ",\"size\":" + n +
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
