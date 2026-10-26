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

import { CircuitElm } from "./CircuitElm";
import { DiodeElm } from "./DiodeElm";
import { DiodeModel } from "./DiodeModel";
import { Graphics } from "./Graphics";
import { Point } from "./Point";
import { StringTokenizer } from "./StringTokenizer";

// Schottky diode: a diode with the S-shaped bar of its symbol, and a Schottky model by default

export class SchottkyElm extends DiodeElm {
    static lastSchottkyModelName: string = "1N5711";

    constructor(xx: number, yy: number);
    constructor(xa: number, ya: number, xb: number, yb: number, f: number, st: StringTokenizer);
    constructor(xa: number, ya: number, xb?: number, yb?: number, f?: number, st?: StringTokenizer) {
        if (xb === undefined) {
            super(xa, ya);
            this.modelName = SchottkyElm.lastSchottkyModelName;
            this.setup();
        } else
            super(xa, ya, xb, yb!, f!, st!);
    }

    showPropertiesOnCreate(): boolean { return true; }
    getDumpType(): number { return 438; }

    hook!: Point[];

    setPoints(): void {
        super.setPoints();
        // the ends of the bar are bent: the top one towards the anode, the other one away from it
        const d = Math.max(Graphics.distanceSq(this.lead1!.x, this.lead1!.y, this.lead2!.x, this.lead2!.y), 1);
        const fd = 4 / Math.sqrt(d);
        this.hook = this.newPointArray(4);
        this.interpPoint(this.lead1!, this.lead2!, this.hook[0], 1 - fd, this.hs);
        this.interpPoint(this.lead1!, this.lead2!, this.hook[1], 1 - fd, this.hs - 4);
        this.interpPoint(this.lead1!, this.lead2!, this.hook[2], 1 + fd, -this.hs);
        this.interpPoint(this.lead1!, this.lead2!, this.hook[3], 1 + fd, -this.hs + 4);
    }

    draw(g: Graphics): void {
        this.drawDiode(g);
        this.setVoltageColor(g, this.nodes[1].v);
        this.setPowerColor(g, true);
        CircuitElm.drawThickLine(g, this.cathode[0], this.hook[0]);
        CircuitElm.drawThickLine(g, this.hook[0], this.hook[1]);
        CircuitElm.drawThickLine(g, this.cathode[1], this.hook[2]);
        CircuitElm.drawThickLine(g, this.hook[2], this.hook[3]);
        this.doDots(g);
        this.drawPosts(g);
    }

    getElmType(): string { return "Schottky diode"; }

    getInfo(arr: string[]): void {
        super.getInfo(arr);
        arr[0] = "Schottky diode (" + this.modelName + ")";
    }

    getModelKind(): string { return DiodeModel.KIND_SCHOTTKY; }

    getShortcut(): number { return 0; }

    setLastModelName(n: string): void {
        SchottkyElm.lastSchottkyModelName = n;
    }
}
