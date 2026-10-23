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

import type { CirSim } from "./CirSim";
import { Scope } from "./Scope";
import type { ScopePlot } from "./ScopePlot";
import { ScopeTrigger } from "./ScopeTrigger";
import { CircuitElm } from "./CircuitElm";
import { Locale } from "./Locale";
import { Scrollbar } from "./UIManager";

// quick controls at the bottom of the side panel for the horizontal and vertical scale
// (and the trigger, in manual scale mode) of the active scope, so they can be changed
// without opening the scope properties
export class ScopeControls {

    // horizontal slider: scope speeds (sim timesteps per pixel), four steps per doubling over
    // the same 1..1024 range as the properties dialog
    static readonly speeds: number[] = [
        1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112, 128,
        160, 192, 224, 256, 320, 384, 448, 512, 640, 768, 896, 1024
    ];
    static readonly H_STEPS = ScopeControls.speeds.length;
    // vertical slider: 1-2-5 sequence of units/div from Scope.MIN_MAN_SCALE (1n) to 500
    static readonly V_STEPS = 36;
    static readonly seq125: number[] = [1, 2, 5];
    // trigger level slider resolution: steps per division
    static readonly TRIG_STEPS_PER_DIV = 10;

    sim: CirSim;
    element: HTMLDivElement;
    titleLabel: HTMLDivElement;
    hValueLabel: HTMLSpanElement;
    vValueLabel: HTMLSpanElement;
    hBar: Scrollbar;
    vBar: Scrollbar;
    channelBox: HTMLSelectElement;
    autoBox: HTMLInputElement;
    vOptionsRow: HTMLDivElement;
    trigPanel: HTMLDivElement;
    trigValueLabel: HTMLSpanElement;
    trigModeBox: HTMLSelectElement;
    trigEdgeButton: HTMLButtonElement;
    trigBar: Scrollbar;

    scope: Scope | null = null;   // scope the controls currently refer to
    channel: number = 0;          // visible plot controlled by the vertical slider
    channelSignature: string = "";
    updating: boolean = false;    // set while syncing widgets from the scope, so their handlers do nothing
    hover: boolean = false;       // mouse is over the controls; highlight the scope they act on
    lastHeight: number = 0;

    constructor(sim: CirSim) {
        this.sim = sim;
        const panel = this.element = document.createElement('div');
        panel.className = 'scopeControls';

        this.titleLabel = document.createElement('div');
        this.titleLabel.className = 'scopeControlsTitle';
        panel.appendChild(this.titleLabel);

        this.hValueLabel = document.createElement('span');
        panel.appendChild(this.makeRow(Locale.LS("Horizontal Scale"), this.hValueLabel));
        this.hBar = new Scrollbar(Scrollbar.HORIZONTAL, ScopeControls.speedToIndex(64), 1, 0, ScopeControls.H_STEPS,
                                  () => this.hBarChanged());
        panel.appendChild(this.hBar.element);

        this.vValueLabel = document.createElement('span');
        panel.appendChild(this.makeRow(Locale.LS("Vertical Scale"), this.vValueLabel));
        this.vBar = new Scrollbar(Scrollbar.HORIZONTAL, 0, 1, 0, ScopeControls.V_STEPS, () => this.vBarChanged());
        panel.appendChild(this.vBar.element);

        this.vOptionsRow = document.createElement('div');
        this.vOptionsRow.className = 'scopeControlsRow';
        this.channelBox = document.createElement('select');
        this.channelBox.className = 'scopeControlsChannel';
        this.channelBox.addEventListener('change', () => {
            if (this.updating)
                return;
            this.channel = this.channelBox.selectedIndex;
            this.refresh();
        });
        this.vOptionsRow.appendChild(this.channelBox);
        const autoLabel = document.createElement('label');
        this.autoBox = document.createElement('input');
        this.autoBox.type = 'checkbox';
        this.autoBox.addEventListener('change', () => {
            if (this.updating || this.scope === null)
                return;
            if (this.autoBox.checked)
                this.scope.setManualScale(false, false);
            else
                this.scope.setManualScale(true, true);
            this.refresh();
            this.sim.repaint();
        });
        autoLabel.appendChild(this.autoBox);
        autoLabel.appendChild(document.createTextNode(Locale.LS("Auto")));
        this.vOptionsRow.appendChild(autoLabel);
        panel.appendChild(this.vOptionsRow);

        // trigger, only shown in manual scale mode, where the level slider has a fixed range
        this.trigPanel = document.createElement('div');
        this.trigValueLabel = document.createElement('span');
        this.trigPanel.appendChild(this.makeRow(Locale.LS("Trigger"), this.trigValueLabel));
        const trigOptionsRow = document.createElement('div');
        trigOptionsRow.className = 'scopeControlsRow';
        this.trigModeBox = document.createElement('select');
        this.trigModeBox.className = 'scopeControlsChannel';
        // same order as the ScopeTrigger.TRIGGER_* constants
        for (const t of ["Free Run", "Normal", "Auto"]) {
            const o = document.createElement('option');
            o.textContent = Locale.LS(t);
            this.trigModeBox.appendChild(o);
        }
        this.trigModeBox.addEventListener('change', () => {
            if (this.updating || this.scope === null)
                return;
            this.scope.setTriggerMode(this.trigModeBox.selectedIndex);
            this.refresh();
            this.sim.repaint();
        });
        trigOptionsRow.appendChild(this.trigModeBox);
        this.trigEdgeButton = document.createElement('button');
        this.trigEdgeButton.className = 'scopeControlsEdge';
        this.trigEdgeButton.addEventListener('click', () => {
            const scope = this.scope;
            if (scope === null)
                return;
            scope.trigger.edge = (scope.trigger.edge === ScopeTrigger.TRIGGER_EDGE_RISING) ?
                ScopeTrigger.TRIGGER_EDGE_FALLING : ScopeTrigger.TRIGGER_EDGE_RISING;
            scope.resetGraph();
            this.refresh();
            this.sim.repaint();
        });
        trigOptionsRow.appendChild(this.trigEdgeButton);
        this.trigPanel.appendChild(trigOptionsRow);
        this.trigBar = new Scrollbar(Scrollbar.HORIZONTAL, 0, 1, 0, 81, () => this.trigBarChanged());
        this.trigPanel.appendChild(this.trigBar.element);
        panel.appendChild(this.trigPanel);

        panel.addEventListener('mouseenter', () => this.setHover(true));
        panel.addEventListener('mouseleave', () => this.setHover(false));

        this.setVisible(false);
    }

    // a line with a caption on the left and the current value on the right
    makeRow(caption: string, value: HTMLSpanElement): HTMLDivElement {
        const row = document.createElement('div');
        row.className = 'scopeControlsRow scopeControlsCaption';
        const cap = document.createElement('span');
        cap.textContent = caption;
        row.appendChild(cap);
        value.className = 'scopeControlsValue';
        row.appendChild(value);
        return row;
    }

    isVisible(): boolean { return this.element.style.display !== 'none'; }

    setVisible(v: boolean): void { this.element.style.display = v ? '' : 'none'; }

    static isShown(e: HTMLElement): boolean { return e.style.display !== 'none'; }

    static show(e: HTMLElement, v: boolean): void { e.style.display = v ? '' : 'none'; }

    setHover(h: boolean): void {
        if (this.hover === h)
            return;
        this.hover = h;
        this.sim.repaint();
    }

    static vIndexToScale(n: number): number {
        return Scope.MIN_MAN_SCALE * Math.pow(10, Math.floor(n / 3)) * ScopeControls.seq125[n % 3];
    }

    static vScaleToIndex(v: number): number {
        let best = 0;
        let bestDist = Number.MAX_VALUE;
        if (!(v > 0))
            return best;
        for (let n = 0; n !== ScopeControls.V_STEPS; n++) {
            const d = Math.abs(Math.log(v / ScopeControls.vIndexToScale(n)));
            if (d < bestDist) {
                bestDist = d;
                best = n;
            }
        }
        return best;
    }

    // nearest slider position for a speed (it may have been set elsewhere, eg the mouse wheel)
    static speedToIndex(speed: number): number {
        const speeds = ScopeControls.speeds;
        let best = 0;
        for (let i = 1; i !== ScopeControls.H_STEPS; i++)
            if (Math.abs(Math.log(speeds[i] / speed)) < Math.abs(Math.log(speeds[best] / speed)))
                best = i;
        return best;
    }

    hBarChanged(): void {
        if (this.updating || this.scope === null)
            return;
        this.sim.scopeManager.setScopeSpeed(this.scope, ScopeControls.speeds[this.hBar.getValue()]);
        this.refresh();
        this.sim.repaint();
    }

    vBarChanged(): void {
        const scope = this.scope;
        if (this.updating || scope === null || this.channel >= scope.visiblePlots.length)
            return;
        if (!scope.isManualScale())
            scope.setManualScale(true, true);
        scope.setManualScaleValue(this.channel, ScopeControls.vIndexToScale(this.vBar.getValue()));
        this.refresh();
        this.sim.repaint();
    }

    // the trigger watches the first visible plot; its level slider covers the visible
    // range of that plot, in steps of 1/TRIG_STEPS_PER_DIV of a division
    trigPositionOffset(scope: Scope, p: ScopePlot): number {
        return scope.getGridMaxFromManScale(p) * 2.0 * p.manVPosition / Scope.V_POSITION_STEPS;
    }

    trigPosToLevel(scope: Scope, p: ScopePlot, pos: number): number {
        return (pos / ScopeControls.TRIG_STEPS_PER_DIV - scope.manDivisions / 2.0) * p.manScale - this.trigPositionOffset(scope, p);
    }

    trigLevelToPos(scope: Scope, p: ScopePlot, level: number): number {
        return Math.round(((level + this.trigPositionOffset(scope, p)) / p.manScale + scope.manDivisions / 2.0) * ScopeControls.TRIG_STEPS_PER_DIV);
    }

    trigBarChanged(): void {
        const scope = this.scope;
        if (this.updating || scope === null || scope.visiblePlots.length === 0)
            return;
        const p = scope.visiblePlots[0];
        const level = this.trigPosToLevel(scope, p, this.trigBar.getValue());
        // avoid rounding noise like 1.0000000002
        scope.trigger.level = Math.round(level / p.manScale * 1e6) * p.manScale / 1e6;
        this.refresh();
        this.sim.repaint();
    }

    getScopeTitle(s: Scope): string {
        const sm = this.sim.scopeManager;
        let t: string | null = null;
        for (let i = 0; i !== sm.scopeCount; i++)
            if (sm.scopes[i] === s)
                t = Locale.LS("Scope") + " " + (i + 1);
        const arr = this.sim.scopeElmArr;
        if (t === null && arr !== null)
            for (let i = 0; i !== arr.length; i++)
                if (arr[i].elmScope === s)
                    t = Locale.LS("Undocked Scope") + " " + (i + 1);
        if (t === null)
            t = Locale.LS("Scope");
        const l = s.getScopeLabelOrText();
        if (l !== null && l.length > 0)
            t += " (" + l + ")";
        return t;
    }

    // move a slider to show the scope's current setting, unless the user is dragging it
    static setBar(bar: Scrollbar, v: number): void {
        if (!bar.isDragging() && bar.getValue() !== v)
            bar.setValue(v);
    }

    static setText(l: HTMLElement, s: string): void {
        if (l.textContent !== s)
            l.textContent = s;
    }

    // called every frame: follow the active scope and keep the widgets in sync with it
    // (its scales can also change from the mouse wheel, the properties dialog, etc.)
    refresh(): void {
        const s = this.sim.scopeManager.getActiveScope();
        if (s !== this.scope) {
            this.scope = s;
            this.channel = 0;
            this.channelSignature = "";
        }
        const vis = (s !== null);
        if (vis !== this.isVisible()) {
            this.setVisible(vis);
            if (!vis) {
                this.hover = false;
                this.sim.setiFrameHeight();
            }
        }
        if (s === null)
            return;
        const scope = s;
        let layoutChanged = false;

        this.updating = true;
        ScopeControls.setText(this.titleLabel, this.getScopeTitle(scope));
        this.titleLabel.title = this.titleLabel.textContent ?? "";

        ScopeControls.setBar(this.hBar, ScopeControls.speedToIndex(scope.speed));
        ScopeControls.setText(this.hValueLabel, CircuitElm.getUnitText(scope.calcGridStepX(), "s") + "/div");

        // channel list: rebuild only when the visible plots change
        const n = scope.visiblePlots.length;
        let sig = "";
        for (let i = 0; i !== n; i++)
            sig += scope.visiblePlots[i].units + ",";
        if (sig !== this.channelSignature) {
            this.channelSignature = sig;
            this.channelBox.innerHTML = '';
            for (let i = 0; i !== n; i++) {
                const o = document.createElement('option');
                o.textContent = "CH " + (i + 1) + " (" + Scope.getScaleUnitsTextStatic(scope.visiblePlots[i].units) + ")";
                this.channelBox.appendChild(o);
            }
            ScopeControls.show(this.channelBox, n > 1);
            layoutChanged = true;
        }
        if (this.channel >= n)
            this.channel = 0;
        if (n > 0 && this.channelBox.selectedIndex !== this.channel)
            this.channelBox.selectedIndex = this.channel;

        const manual = scope.isManualScale();
        if (this.autoBox.checked !== !manual)
            this.autoBox.checked = !manual;
        if (n === 0) {
            // e.g. X-Y mode, which has no per-channel scale
            if (this.vBar.isEnabled())
                this.vBar.disable();
            this.autoBox.disabled = true;
            ScopeControls.setText(this.vValueLabel, "-");
        } else {
            if (!this.vBar.isEnabled())
                this.vBar.enable();
            this.autoBox.disabled = false;
            const p = scope.visiblePlots[this.channel];
            const v = manual ? p.manScale : scope.getManScaleFromMaxScale(p.units, true);
            ScopeControls.setBar(this.vBar, ScopeControls.vScaleToIndex(v));
            const units = Scope.getScaleUnitsTextStatic(p.units);
            ScopeControls.setText(this.vValueLabel, manual ? CircuitElm.getUnitText(p.manScale, units) + "/div" : Locale.LS("Auto"));
        }

        // trigger section
        const trigVis = manual && n > 0;
        if (trigVis !== ScopeControls.isShown(this.trigPanel)) {
            ScopeControls.show(this.trigPanel, trigVis);
            layoutChanged = true;
        }
        if (trigVis) {
            const t = scope.trigger;
            if (this.trigModeBox.selectedIndex !== t.mode)
                this.trigModeBox.selectedIndex = t.mode;
            const rising = (t.edge === ScopeTrigger.TRIGGER_EDGE_RISING);
            const edgeText = rising ? "↑ " + Locale.LS("Rising") : "↓ " + Locale.LS("Falling");
            ScopeControls.setText(this.trigEdgeButton, edgeText);
            const active = t.isActive();
            ScopeControls.show(this.trigEdgeButton, active);
            if (active !== ScopeControls.isShown(this.trigBar.element)) {
                ScopeControls.show(this.trigBar.element, active);
                layoutChanged = true;
            }
            const p0 = scope.visiblePlots[0];
            if (active) {
                const steps = scope.manDivisions * ScopeControls.TRIG_STEPS_PER_DIV;
                if (this.trigBar.getMaxValue() !== steps)
                    this.trigBar.setMaxValue(steps);
                ScopeControls.setBar(this.trigBar, Math.max(0, Math.min(steps, this.trigLevelToPos(scope, p0, t.level))));
                ScopeControls.setText(this.trigValueLabel, (n > 1 ? "CH 1: " : "") +
                    CircuitElm.getUnitText(t.level, Scope.getScaleUnitsTextStatic(p0.units)));
            } else
                ScopeControls.setText(this.trigValueLabel, Locale.LS("Free Run"));
        }
        this.updating = false;

        // our height may have changed, so resize the iframe above us to keep everything on screen
        const h = this.element.offsetHeight;
        if (layoutChanged || h !== this.lastHeight) {
            this.lastHeight = h;
            this.sim.setiFrameHeight();
        }
    }

    highlightScope(s: Scope): boolean {
        return this.hover && s === this.scope;
    }
}
