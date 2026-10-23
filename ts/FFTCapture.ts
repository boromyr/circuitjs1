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

import { ACAnalysis } from "./ACAnalysis";
import type { SimulationManager } from "./SimulationManager";

// Records the voltage of one output (a labeled node, an Output or a voltmeter: the
// same choices as the Bode plot, see ACAnalysis.getOutputs()) at every simulation
// time step, for the FFT window (fftplot.js), which resamples and transforms it.
// The times are kept with the samples, since the time step shrinks when the
// simulation has trouble converging.
export class FFTCapture {
    sim: SimulationManager;
    key: string | null = null;
    elm: any = null;
    diff: boolean = false;
    tbuf: Float64Array = new Float64Array(0);
    vbuf: Float64Array = new Float64Array(0);
    pos: number = 0;
    count: number = 0;
    lastT: number = 0;
    // run the simulation as fast as the frame time allows, while the FFT window acquires,
    // until fastSpan seconds of simulated time are recorded
    fast: boolean = false;
    fastSpan: number = 0;

    constructor(s: SimulationManager) { this.sim = s; }

    // records the output with this key (from getACTargets()) in a buffer of the given
    // size, keeping what is recorded already if nothing changed; false if it is missing
    select(k: string, capacity: number): boolean {
	capacity = Math.max(16, Math.min(Math.trunc(capacity) || 0, 1 << 20));
	const t = (k == null || this.sim.app.elmList == null) ? null : ACAnalysis.find(this.sim.acAnalysis.getOutputs(), k);
	if (t == null) {
	    this.stop();
	    return false;
	}
	if (k !== this.key || t.elm !== this.elm || capacity !== this.vbuf.length) {
	    this.tbuf = new Float64Array(capacity);
	    this.vbuf = new Float64Array(capacity);
	    this.pos = this.count = 0;
	}
	this.key = k;
	this.elm = t.elm;
	this.diff = this.elm.isProbeElm();
	return true;
    }

    stop(): void {
	this.fast = false;
	this.key = null;
	this.elm = null;
	this.tbuf = this.vbuf = new Float64Array(0);
	this.pos = this.count = 0;
    }

    clear(): void { this.pos = this.count = 0; }

    setFast(f: boolean, span: number): void {
	this.fast = f;
	this.fastSpan = span;
    }

    // simulated time covered by the recorded samples
    recordedSpan(): number {
	if (this.count < 2)
	    return 0;
	const len = this.vbuf.length;
	return this.tbuf[(this.pos-1+len) % len] - this.tbuf[(this.pos-this.count+len) % len];
    }

    // checked by the simulation loop every frame: fast mode ends by itself as soon as enough
    // is recorded, instead of when the FFT window next looks (which can be seconds later)
    isFast(): boolean {
	return this.fast && this.elm != null && this.recordedSpan() < this.fastSpan;
    }

    // called after every time step
    timeStep(): void {
	if (this.elm == null || this.vbuf.length === 0)
	    return;
	const t = this.sim.t;
	if (this.count > 0 && t <= this.lastT) {
	    if (t === this.lastT)
		return;
	    this.count = this.pos = 0;	// the simulation was reset
	}
	const nodes = this.elm.nodes;
	this.vbuf[this.pos] = this.diff ? nodes[0].v-nodes[1].v : nodes[0].v;
	this.tbuf[this.pos] = t;
	this.lastT = t;
	this.pos = (this.pos+1) % this.vbuf.length;
	if (this.count < this.vbuf.length)
	    this.count++;
    }

    // the recorded samples, oldest first: {t:[...], v:[...], maxStep, running}
    samples(): object {
	const len = this.vbuf.length;
	const ts: number[] = new Array(this.count), vs: number[] = new Array(this.count);
	const start = (this.pos - this.count + len) % Math.max(len, 1);
	for (let i = 0; i !== this.count; i++) {
	    const j = (start + i) % len;
	    ts[i] = this.tbuf[j];
	    vs[i] = this.vbuf[j];
	}
	return { t: ts, v: vs, maxStep: this.sim.maxTimeStep, running: this.sim.app.simIsRunning() };
    }

    // how much is recorded, without copying the samples: {count, t0, t1, maxStep, running}
    status(): object {
	const c = this.count, len = this.vbuf.length, tb = this.tbuf;
	const t0 = c > 0 ? tb[(this.pos - c + len) % len] : 0, t1 = c > 0 ? tb[(this.pos - 1 + len) % len] : 0;
	return { count: c, t0: t0, t1: t1, maxStep: this.sim.maxTimeStep, running: this.sim.app.simIsRunning() };
    }
}
