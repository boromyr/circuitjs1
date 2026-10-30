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

import { CirSim } from "./CirSim";
import { CircuitElm } from "./CircuitElm";
import { EditInfo } from "./EditInfo";
import { Locale } from "./Locale";

// popup shown when the mouse wheel is scrolled over a resistor/capacitor/inductor or a voltage
// source: scrolling steps the value through a series of preferred values (E12 for components),
// previewing a few neighboring values
export class ScrollValuePopup {

    static readonly e12: number[] = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
    // frequencies per decade (50/60 Hz, 400 Hz, 1 kHz...)
    static readonly freqSeries: number[] = [1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0];
    static readonly labMax = 5;
    static readonly scale = 6;

    private values: number[] = [];
    private nvalues = 0;
    private currentidx = 0;
    private lastidx = 0;
    private myElm: CircuitElm;
    private editIndex: number;
    private labels: HTMLDivElement[] = [];
    private deltaY = 0;
    private name = "";
    private inf!: EditInfo;
    private sim: CirSim;

    private panel: HTMLDivElement;
    private closed = false;

    private readonly onWheel = (e: WheelEvent) => {
        e.preventDefault();
        this.doDeltaY(ScrollValuePopup.normalizeWheelDelta(e));
    };
    private readonly onMouseOut = () => this.close(true);
    private readonly onMouseDown = (e: MouseEvent) => {
        if (e.button === 0 || e.button === 1)
            this.close(true);
        else
            this.close(false);
    };

    // editIndex: the edit-info value to step (a voltage source's voltage or frequency)
    constructor(x: number, y: number, dy: number, elm: CircuitElm, sim: CirSim, editIndex: number = 0) {
        this.myElm = elm;
        this.editIndex = editIndex;
        this.sim = sim;
        this.sim.undoManager.pushUndo();
        this.setupValues();

        this.panel = document.createElement("div");
        this.panel.className = "scrollValuePopup";

        const nameLabel = document.createElement("div");
        nameLabel.className = "scrollValuePopup-name";
        nameLabel.textContent = this.name;
        this.panel.appendChild(nameLabel);

        for (let i = 0; i < ScrollValuePopup.labMax; i++) {
            const label = document.createElement("div");
            label.textContent = "---";
            label.className = "scrollValuePopup-label" +
                (i === 2 ? " selected" : (i === 1 || i === 3) ? " off1" : " off2");
            this.panel.appendChild(label);
            this.labels.push(label);
        }

        this.panel.addEventListener("wheel", this.onWheel, { passive: false });
        this.panel.addEventListener("mouseout", this.onMouseOut);
        this.panel.addEventListener("mousedown", this.onMouseDown);

        this.doDeltaY(dy);

        // position off-screen first so we can measure it, then place it relative to (x, y)
        // and clamp to stay on-screen, matching the GWT PositionCallback behavior
        this.panel.style.visibility = "hidden";
        document.body.appendChild(this.panel);
        const w = this.panel.offsetWidth;
        const h = this.panel.offsetHeight;
        const left = Math.max(0, x - w / 4);
        const top = Math.max(0, y - 7 * h / 12);
        this.panel.style.left = left + "px";
        this.panel.style.top = top + "px";
        this.panel.style.visibility = "";
    }

    private setupValues(): void {
        if (this.myElm.isResistorElm())
            this.values = ScrollValuePopup.decades(-1, 7, ScrollValuePopup.e12);
        else if (this.myElm.isCapacitorElm())
            this.values = ScrollValuePopup.decades(-11, -3, ScrollValuePopup.e12);
        else if (this.myElm.isInductorElm())
            this.values = ScrollValuePopup.decades(-6, 0, ScrollValuePopup.e12);
        else if (this.editIndex > 0) {
            // a source's frequency, up to what the time step allows (above it setFrequency asks
            // to change the time step, which would pop up a confirm at every notch)
            const maxfreq = 1 / (8 * CircuitElm.sim.maxTimeStep);
            this.values = ScrollValuePopup.decades(-1, 7, ScrollValuePopup.freqSeries).filter(f => f <= maxfreq);
        } else
            this.values = ScrollValuePopup.voltages();
        this.nvalues = this.values.length;
        this.values[this.nvalues] = 1e99;
        this.inf = this.myElm.getEditInfo(this.editIndex)!;
        // keep a source's waveform phase continuous (see VoltageElm.setEditValue)
        this.inf.continuous = true;
        const currentvalue = this.inf.value;
        for (let i = 0; i < this.nvalues + 1; i++) {
            if (CircuitElm.getShortUnitText(currentvalue, "") === CircuitElm.getShortUnitText(this.values[i], "")) {
                // match to an existing value
                this.values[i] = currentvalue; // just in case it isn't 100% identical
                this.currentidx = i;
                break;
            }
            if (currentvalue < this.values[i]) {
                // overshot - need to insert value
                this.currentidx = i;
                for (let j = this.nvalues - 1; j >= i; j--)
                    this.values[j + 1] = this.values[j];
                this.values[i] = currentvalue;
                this.nvalues++;
                break;
            }
        }
        this.name = Locale.LS(this.inf.name);
        this.lastidx = this.currentidx;
    }

    // series[j] * 10^i for minpow <= i < maxpow, then 10^maxpow
    private static decades(minpow: number, maxpow: number, series: number[]): number[] {
        const v: number[] = [];
        for (let i = minpow; i <= maxpow; i++) {
            const jmax = (i !== maxpow) ? series.length : 1;
            for (let j = 0; j < jmax; j++)
                v.push(Math.pow(10.0, i) * series[j]);
        }
        return v;
    }

    // voltages from -1000 to 1000, finer near 0, with the usual supply values (1.8, 3.3, 12, 24...)
    private static voltages(): number[] {
        const pos: number[] = [];
        const step = (from: number, to: number, d: number) => {
            for (let k = 0; from + k * d < to - 1e-9; k++)
                pos.push(Math.round((from + k * d) * 10) / 10);
        };
        step(0.1, 1, 0.1);
        step(1, 10, 0.5);
        pos.push(1.2, 1.8, 3.3);
        step(10, 30, 1);
        step(30, 100, 5);
        step(100, 300, 10);
        step(300, 1000, 50);
        pos.push(1000);
        pos.sort((a, b) => a - b);
        return pos.slice().reverse().map(v => -v).concat([0], pos);
    }

    private setupLabels(): void {
        const thissel = this.getSelIdx();
        for (let i = 0; i < ScrollValuePopup.labMax; i++) {
            const label = this.labels[i];
            label.classList.remove("current");
            const idx = thissel + i - 2;
            if (idx < 0 || idx >= this.nvalues)
                label.textContent = "---";
            else {
                label.textContent = CircuitElm.getShortUnitText(this.values[idx], "");
                if (idx === this.currentidx)
                    label.classList.add("current");
            }
        }
    }

    close(keepChanges: boolean): void {
        if (this.closed)
            return;
        this.closed = true;
        if (!keepChanges)
            this.setElmValue(this.currentidx);
        else
            this.setElmValue();
        this.panel.remove();
    }

    isShowing(): boolean {
        return !this.closed;
    }

    doDeltaY(dy: number): void {
        // a single wheel event moves at most one step (times the sensitivity).  a mouse wheel
        // notch's pixel deltaY varies a lot by browser/platform (~100 in Chromium, more in
        // Firefox), which otherwise skipped values; small trackpad deltas still accumulate
        dy /= (window.devicePixelRatio || 1);
        this.deltaY += Math.max(-ScrollValuePopup.scale, Math.min(ScrollValuePopup.scale, dy));
        this.setElmValue();
        this.setupLabels();
    }

    private setElmValue(i: number = this.getSelIdx()): void {
        if (i !== this.lastidx) {
            this.lastidx = i;
            this.inf.value = this.values[i];
            this.myElm.setEditValue(this.editIndex, this.inf);
            this.sim.needAnalyze();
        }
    }

    // GWT's MouseWheelEvent.getDeltaY() (which the constants below, like scale, were tuned
    // against) came out much smaller than the raw pixel deltaY a native 'wheel' event gives
    // us - GWT computed it from the legacy, non-standard wheelDelta property, whose ratio to
    // deltaY turned out not to be the fixed cross-browser constant it's classically assumed
    // to be. 0.12 is an empirically-chosen scale-down factor, not a derived conversion.
    // Not rounded: the many small steps of a touchpad (a few pixels each) came out as 0
    // and were lost.  Lines and pages (Firefox, some mice) are converted to the same
    // units, a mouse notch (3 lines) being WHEEL_NOTCH.
    static readonly WHEEL_NOTCH = 12;

    static normalizeWheelDelta(e: WheelEvent): number {
        if (!e.deltaY)
            return 0;
        if (e.deltaMode === 1)          // lines
            return e.deltaY * ScrollValuePopup.WHEEL_NOTCH / 3;
        if (e.deltaMode === 2)          // pages
            return e.deltaY * ScrollValuePopup.WHEEL_NOTCH * 10;
        return e.deltaY * 0.12;         // pixels
    }

    getSelIdx(): number {
        let r = this.currentidx + Math.round(this.sim.mouse.wheelSensitivity * this.deltaY / ScrollValuePopup.scale);
        if (r < 0)
            r = 0;
        if (r >= this.nvalues)
            r = this.nvalues - 1;
        return r;
    }
}
