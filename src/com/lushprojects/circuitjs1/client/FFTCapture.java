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

import com.google.gwt.core.client.JavaScriptObject;

// Records the voltage of one output (a labeled node, an Output or a voltmeter: the
// same choices as the Bode plot, see ACAnalysis.getOutputs()) at every simulation
// time step, for the FFT window (war/fftplot.js), which resamples and transforms it.
// The times are kept with the samples, since the time step shrinks when the
// simulation has trouble converging.
class FFTCapture {
    SimulationManager sim;
    String key;
    CircuitElm elm;
    boolean diff;
    double tbuf[] = new double[0], vbuf[] = new double[0];
    int pos, count;
    double lastT;
    // run the simulation as fast as the frame time allows, while the FFT window acquires
    boolean fast;

    FFTCapture(SimulationManager s) { sim = s; }

    // records the output with this key (from getACTargets()) in a buffer of the given
    // size, keeping what is recorded already if nothing changed; false if it is missing
    boolean select(String k, int capacity) {
	capacity = Math.max(16, Math.min(capacity, 1 << 20));
	ACAnalysis.Target t = (k == null || sim.elmList == null) ? null : ACAnalysis.find(sim.acAnalysis.getOutputs(), k);
	if (t == null) {
	    stop();
	    return false;
	}
	if (!k.equals(key) || t.elm != elm || capacity != vbuf.length) {
	    tbuf = new double[capacity];
	    vbuf = new double[capacity];
	    pos = count = 0;
	}
	key = k;
	elm = t.elm;
	diff = elm instanceof ProbeElm;
	return true;
    }

    void stop() {
	fast = false;
	key = null;
	elm = null;
	tbuf = vbuf = new double[0];
	pos = count = 0;
    }

    void clear() { pos = count = 0; }

    // called after every time step
    void timeStep() {
	if (elm == null || vbuf.length == 0)
	    return;
	double t = sim.t;
	if (count > 0 && t <= lastT) {
	    if (t == lastT)
		return;
	    count = pos = 0;	// the simulation was reset
	}
	vbuf[pos] = diff ? elm.volts[0]-elm.volts[1] : elm.volts[0];
	tbuf[pos] = t;
	lastT = t;
	pos = (pos+1) % vbuf.length;
	if (count < vbuf.length)
	    count++;
    }

    // the recorded samples, oldest first: {t:[...], v:[...], maxStep, running}
    JavaScriptObject samples() {
	double ts[] = new double[count], vs[] = new double[count];
	int start = (pos - count + vbuf.length) % Math.max(vbuf.length, 1);
	for (int i = 0; i != count; i++) {
	    int j = (start + i) % vbuf.length;
	    ts[i] = tbuf[j];
	    vs[i] = vbuf[j];
	}
	return pack(ts, vs, sim.maxTimeStep, CirSim.theApp.simIsRunning());
    }

    // how much is recorded, without copying the samples: {count, t0, t1, maxStep, running}
    native JavaScriptObject status() /*-{
	var c = this.@com.lushprojects.circuitjs1.client.FFTCapture::count;
	var len = this.@com.lushprojects.circuitjs1.client.FFTCapture::vbuf.length;
	var pos = this.@com.lushprojects.circuitjs1.client.FFTCapture::pos;
	var tb = this.@com.lushprojects.circuitjs1.client.FFTCapture::tbuf;
	var sim = this.@com.lushprojects.circuitjs1.client.FFTCapture::sim;
	var t0 = c > 0 ? tb[(pos - c + len) % len] : 0, t1 = c > 0 ? tb[(pos - 1 + len) % len] : 0;
	return { count: c, t0: t0, t1: t1,
	    maxStep: sim.@com.lushprojects.circuitjs1.client.SimulationManager::maxTimeStep,
	    running: @com.lushprojects.circuitjs1.client.CirSim::theApp.@com.lushprojects.circuitjs1.client.CirSim::simIsRunning()() };
    }-*/;

    // in compiled code a double[] is a plain JavaScript array of numbers
    static native JavaScriptObject pack(double ts[], double vs[], double maxStep, boolean running) /*-{
	return { t: ts, v: vs, maxStep: maxStep, running: running };
    }-*/;
}
