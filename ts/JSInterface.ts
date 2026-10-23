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


export class JSInterface {
    app: any;

    constructor(app: any) {
        this.app = app;
    }

    setExtVoltage(name: string, v: number): void {
        for (let i = 0; i !== this.app.elmList.length; i++) {
            const ce = this.app.getElm(i);
            if (ce.isExtVoltageElm()) {
                if (ce.getName() === name)
                    ce.setVoltage(v);
            }
        }
    }

    getJSElements(): object[] {
        const arr: object[] = [];
        for (let i = 0; i !== this.app.elmList.length; i++) {
            const ce = this.app.getElm(i);
            ce.addJSMethods();
            arr.push(ce.getJavaScriptObject());
        }
        return arr;
    }

    getLabeledNodeVoltage(name: string): number { return this.app.sim.getLabeledNodeVoltage(name); }

    // Delegate methods for JS API access
    setSimRunning(run: boolean): void { this.app.setSimRunning(run); }
    simIsRunning(): boolean { return this.app.simIsRunning(); }
    doExportAsSVGFromAPI(): void { this.app.imageExporter.doExportAsSVGFromAPI(); }
    dumpCircuit(): string { return this.app.dumpCircuit(); }
    importCircuitFromText(t: string, s: boolean): void { this.app.importCircuitFromText(t, s); }
    getTime(): number { return this.app.sim.t; }
    getTimeStep(): number { return this.app.sim.timeStep; }
    setTimeStep(ts: number): void { this.app.sim.timeStep = ts; }
    getMaxTimeStep(): number { return this.app.sim.maxTimeStep; }
    setMaxTimeStep(ts: number): void { this.app.sim.maxTimeStep = this.app.sim.timeStep = ts; }
    getACTargets(): object { return this.app.sim.acAnalysis.getTargets(); }
    getCircuitVersion(): number { return this.app.sim.circuitVersion; }
    acSweep(src: string, out: string, fmin: number, fmax: number, n: number): object { return this.app.sim.acAnalysis.sweep(src, out, fmin, fmax, n); }
    fftSelect(out: string, n: number): boolean { return this.app.sim.fftCapture.select(out, n); }
    fftSamples(): object { return this.app.sim.fftCapture.samples(); }
    fftClear(): void { this.app.sim.fftCapture.clear(); }
    fftStop(): void { this.app.sim.fftCapture.stop(); }
    fftStatus(): object { return this.app.sim.fftCapture.status(); }
    fftSetFast(f: boolean, span: number): void { this.app.sim.fftCapture.setFast(f, span); }
    // the Simulation Speed slider of the side panel (also shown in the Bode and FFT windows)
    getSimSpeed(): number { return this.app.ui.speedBar.getValue(); }
    getSimSpeedMax(): number { return this.app.ui.speedBar.max; }
    setSimSpeed(v: number): void { this.app.ui.speedBar.setValue(Math.trunc(v)); }

    setupJSInterface(): void {
        const that = this;
        (window as any).CircuitJS1 = {
            setSimRunning:  (run: boolean) => that.setSimRunning(run),
            getTime:        () => that.getTime(),
            getTimeStep:    () => that.getTimeStep(),
            setTimeStep:    (ts: number) => that.setTimeStep(ts), // don't use this, see #843
            getMaxTimeStep: () => that.getMaxTimeStep(),
            setMaxTimeStep: (ts: number) => that.setMaxTimeStep(ts),
            isRunning:      () => that.simIsRunning(),
            getNodeVoltage: (n: string) => that.getLabeledNodeVoltage(n),
            setExtVoltage:  (n: string, v: number) => that.setExtVoltage(n, v),
            getElements:    () => that.getJSElements(),
            getCircuitAsSVG: () => that.doExportAsSVGFromAPI(),
            exportCircuit:  () => that.dumpCircuit(),
            importCircuit:  (circuit: string, subcircuitsOnly: boolean) => that.importCircuitFromText(circuit, subcircuitsOnly),
            // small-signal frequency response, used by bodeplot.js (see ACAnalysis)
            getACTargets:   () => that.getACTargets(),
            getCircuitVersion: () => that.getCircuitVersion(),
            acSweep:        (src: string, out: string, fmin: number, fmax: number, n: number) => that.acSweep(src, out, fmin, fmax, n),
            // voltage of an output recorded at every time step, used by fftplot.js (see FFTCapture)
            fftSelect:      (out: string, n: number) => that.fftSelect(out, n),
            fftSamples:     () => that.fftSamples(),
            fftClear:       () => that.fftClear(),
            fftStop:        () => that.fftStop(),
            fftStatus:      () => that.fftStatus(),
            fftSetFast:     (f: boolean, span: number) => that.fftSetFast(!!f, +span || 0),
            getSimSpeed:    () => that.getSimSpeed(),
            getSimSpeedMax: () => that.getSimSpeedMax(),
            setSimSpeed:    (v: number) => that.setSimSpeed(v),
        };
        const hook = (window as any).oncircuitjsloaded;
        if (hook)
            hook((window as any).CircuitJS1);
    }

    callUpdateHook(): void {
        const hook = (window as any).CircuitJS1?.onupdate;
        if (hook)
            hook((window as any).CircuitJS1);
    }

    callAnalyzeHook(): void {
        const hook = (window as any).CircuitJS1?.onanalyze;
        if (hook)
            hook((window as any).CircuitJS1);
    }

    callTimeStepHook(): void {
        const hook = (window as any).CircuitJS1?.ontimestep;
        if (hook)
            hook((window as any).CircuitJS1);
    }

    callSVGRenderedHook(svgData: string): void {
        const hook = (window as any).CircuitJS1?.onsvgrendered;
        if (hook)
            hook((window as any).CircuitJS1, svgData);
    }
}
