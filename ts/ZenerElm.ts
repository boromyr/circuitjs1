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

// Zener code contributed by J. Mike Rollins
// http://www.camotruck.net/rollins/simulator.html

import { DiodeElm } from "./DiodeElm";
import { Choice } from "./Choice";
import { DiodeModel } from "./DiodeModel";
import { EditInfo } from "./EditInfo";
import { Locale } from "./Locale";
import { Graphics } from "./Graphics";
import { Point } from "./Point";
import { Polygon } from "./Polygon";
import { StringTokenizer } from "./StringTokenizer";
import { parseFloatStrict } from "./NumberParse";

export class ZenerElm extends DiodeElm {
    static lastZenerModelName: string = "default-zener";

    constructor(xx: number, yy: number);
    constructor(xa: number, ya: number, xb: number, yb: number, f: number, st: StringTokenizer);
    constructor(xa: number, ya: number, xb?: number, yb?: number, f?: number, st?: StringTokenizer) {
        if (xb === undefined) {
            super(xa, ya);
            this.modelName = ZenerElm.lastZenerModelName;
            this.setup();
        } else {
            super(xa, ya, xb, yb!, f!, st!);
            if ((f! & DiodeElm.FLAG_MODEL) === 0) {
                const zvoltage = parseFloatStrict(st!.nextToken());
                this.model = DiodeModel.getModelWithParameters(this.model.fwdrop, zvoltage);
                this.modelName = this.model.name;
//              CirSim.console("model name wparams = " + modelName);
            }
            this.setup();
        }
    }

    showPropertiesOnCreate(): boolean { return true; }
    getDumpType(): number { return 'z'.charCodeAt(0); }

    readonly hs = 8;
    declare poly: Polygon;
    declare cathode: Point[];
    wing: Point[];

    setPoints(): void {
        super.setPoints();
        this.calcLeads(16);
        this.cathode = this.newPointArray(2);
        this.wing = this.newPointArray(2);
        const pa = this.newPointArray(2);
        this.interpPoint2(this.lead1!, this.lead2!, pa[0], pa[1], 0, this.hs);
        this.interpPoint2(this.lead1!, this.lead2!, this.cathode[0], this.cathode[1], 1, this.hs);
        this.interpPoint(this.cathode[0], this.cathode[1], this.wing[0], -0.2, -this.hs);
        this.interpPoint(this.cathode[1], this.cathode[0], this.wing[1], -0.2, -this.hs);
        this.poly = this.createPolygon(pa[0], pa[1], this.lead2!);
    }

    draw(g: Graphics): void {
        this.setBbox(this.point1, this.point2, this.hs);

        const v1 = this.nodes[0].v;
        const v2 = this.nodes[1].v;

        this.draw2Leads(g);

        // draw arrow thingy
        this.setPowerColor(g, true);
        this.setVoltageColor(g, v1);
        g.fillPolygon(this.poly);

        // draw thing arrow is pointing to
        this.setVoltageColor(g, v2);
        DiodeElm.drawThickLine(g, this.cathode[0], this.cathode[1]);

        // draw wings on cathode
        DiodeElm.drawThickLine(g, this.wing[0], this.cathode[0]);
        DiodeElm.drawThickLine(g, this.wing[1], this.cathode[1]);

        this.doDots(g);
        this.drawPosts(g);
    }

    readonly default_zvoltage = 5.6;

    getElmType(): string { return "Zener diode"; }

    getInfo(arr: string[]): void {
        super.getInfo(arr);
        arr[0] = "Zener diode";
        arr[5] = "Vz = " + DiodeElm.getVoltageText(this.model.breakdownVoltage);
    }

    isZenerElm(): boolean { return true; }
    getModelKind(): string { return DiodeModel.KIND_ZENER; }

    // the quick list of standard voltages comes right after the model list
    getEditInfo(n: number): EditInfo | null {
        if (n === 1) {
            const ei = new EditInfo("Standard Voltage", 0, -1, -1);
            ei.choice = new Choice();
            ei.choice.add(Locale.LS("(custom)"));
            ei.choice.select(0);
            DiodeModel.ZENER_VOLTAGES.forEach((v, i) => {
                ei.choice!.add(v + " V");
                if (this.model.name === DiodeModel.getZenerModelName(v))
                    ei.choice!.select(i + 1);
            });
            return ei;
        }
        return super.getEditInfo(n > 1 ? n - 1 : n);
    }

    setEditValue(n: number, ei: EditInfo): void {
        if (n === 1) {
            const i = ei.choice!.getSelectedIndex() - 1;
            if (i < 0)
                return;
            this.model = DiodeModel.getModelWithName(DiodeModel.getZenerModelName(DiodeModel.ZENER_VOLTAGES[i]));
            this.modelName = this.model.name;
            this.setup();
            ei.newDialog = true;
            return;
        }
        super.setEditValue(n > 1 ? n - 1 : n, ei);
    }

    getShortcut(): number { return 'z'.charCodeAt(0); }

    setLastModelName(n: string): void {
        ZenerElm.lastZenerModelName = n;
    }
}
