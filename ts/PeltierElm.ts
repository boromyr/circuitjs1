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
import { CircuitXMLSerializer } from "./CircuitXMLSerializer";
import { CircuitXMLDeserializer } from "./CircuitXMLDeserializer";
import { Color } from "./Color";
import { EditInfo } from "./EditInfo";
import { Graphics } from "./Graphics";
import { Locale } from "./Locale";
import { Point } from "./Point";
import { StringTokenizer } from "./StringTokenizer";
import { VoltageSource } from "./VoltageSource";
import { parseFloatStrict } from "./NumberParse";

// Thermoelectric (Peltier / TEC) module.
//
// Four terminals: two ELECTRICAL and two THERMAL.  The thermal terminals use
// the standard thermal-electrical analogy, as used throughout SPICE
// electrothermal modelling:
//
//      temperature  T    <->  node voltage        (K  <-> V)
//      heat flow    Qdot <->  branch current      (W  <-> A)
//      thermal res. Rth  <->  resistance          (K/W <-> ohm)
//      thermal cap. Cth  <->  capacitance         (J/K <-> F)
//
// So an ambient reservoir is modelled as a voltage source on the thermal node,
// a heatsink as a resistor to ambient, and thermal mass as a capacitor.
//
// Device equations (standard single-couple TEC model, Seebeck coefficient a,
// electrical series resistance R, thermal conductance K):
//
//   electrical:  V = a*(Th - Tc) + I*R            (Seebeck emf + ohmic drop)
//   cold side:   Qc = a*I*Tc - 0.5*I^2*R - K*(Th-Tc)     (heat absorbed)
//   hot side:    Qh = a*I*Th + 0.5*I^2*R - K*(Th-Tc)     (heat rejected)
//
// Energy accounting is exact and can be checked in the simulator:
//
//   Qh - Qc = a*I*(Th-Tc) + I^2*R = V*I = W
//
// i.e. the heat rejected exceeds the heat absorbed by exactly the electrical
// work done.  The coefficient of performance COP = Qc/W is therefore greater
// than one whenever a*I*Tc exceeds the Joule and conduction losses -- not
// because energy is created, but because the cold-side reservoir supplies Qc
// and it is drawn as an explicit node rather than left implicit.
//
// The element is nonlinear (the heat terms contain products of I and T), so it
// is iterated via stampNonLinear/doStep.
//
// NOTE ON UNITS: the thermal nodes carry ABSOLUTE temperature in kelvin,
// because the Peltier terms are proportional to T, not to a temperature
// difference from an arbitrary zero.  Ground the thermal network through a
// voltage source of 293 (i.e. 20 C) to represent ambient.

export class PeltierElm extends CircuitElm {
    seebeck: number;      // a, V/K
    resistance: number;   // R, ohms (electrical)
    thermalCond: number;  // K, W/K

    qHot: number = 0;
    qCold: number = 0;
    elecPower: number = 0;
    cop: number = 0;
    posts: Point[];
    rectPoints: Point[];
    coldLead: Point;
    hotLead: Point;

    constructor(xx: number, yy: number);
    constructor(xa: number, ya: number, xb: number, yb: number, f: number, st: StringTokenizer);
    constructor(xa: number, ya: number, xb?: number, yb?: number, f?: number, st?: StringTokenizer) {
        super(xa, ya, xb, yb, f);
        if (st !== undefined) {
            this.seebeck = parseFloatStrict(st.nextToken());
            this.resistance = parseFloatStrict(st.nextToken());
            this.thermalCond = parseFloatStrict(st.nextToken());
        } else {
            // representative small single-stage TEC module
            this.seebeck = 0.05;      // 50 mV/K
            this.resistance = 2;      // 2 ohm
            this.thermalCond = 0.5;   // 0.5 W/K
        }
    }

    getDumpType(): number { return 435; }
    getElmType(): string { return "thermoelectric"; }

    dumpXml(doc: Document, elem: Element): void {
        super.dumpXml(doc, elem);
        CircuitXMLSerializer.dumpAttr(elem, "seebeck", this.seebeck);
        CircuitXMLSerializer.dumpAttr(elem, "resistance", this.resistance);
        CircuitXMLSerializer.dumpAttr(elem, "thermalCond", this.thermalCond);
    }

    undumpXml(xml: CircuitXMLDeserializer): void {
        super.undumpXml(xml);
        this.seebeck = xml.parseDoubleAttr("seebeck", this.seebeck);
        this.resistance = xml.parseDoubleAttr("resistance", this.resistance);
        this.thermalCond = xml.parseDoubleAttr("thermalCond", this.thermalCond);
    }

    // posts: 0,1 = electrical (left side);  2 = hot thermal, 3 = cold thermal (right side)
    getPostCount(): number { return 4; }
    getVoltageSourceCount(): number { return 1; }
    getInternalNodeCount(): number { return 1; }

    setPoints(): void {
        super.setPoints();
        const hs = 16;
        this.posts = this.newPointArray(4);
        // electrical pair at point1 end, thermal pair at point2 end
        this.interpPoint2(this.point1, this.point2, this.posts[0], this.posts[1], 0, hs);
        this.interpPoint2(this.point1, this.point2, this.posts[2], this.posts[3], 1, hs);
        // body rectangle
        const r1 = this.interpPoint(this.point1, this.point2, 0.28, hs);
        const r2 = this.interpPoint(this.point1, this.point2, 0.28, -hs);
        const r3 = this.interpPoint(this.point1, this.point2, 0.72, -hs);
        const r4 = this.interpPoint(this.point1, this.point2, 0.72, hs);
        this.rectPoints = [r1, r2, r3, r4];
        this.hotLead  = this.interpPoint(this.point1, this.point2, 0.72,  hs);
        this.coldLead = this.interpPoint(this.point1, this.point2, 0.72, -hs);
    }

    getPost(n: number): Point { return this.posts[n]; }

    draw(g: Graphics): void {
        this.setBbox(this.point1, this.point2, 16);
        // leads to each post
        const e1 = this.interpPoint(this.point1, this.point2, 0.28,  16);
        const e2 = this.interpPoint(this.point1, this.point2, 0.28, -16);
        this.setVoltageColor(g, this.nodes[0].v); CircuitElm.drawThickLine(g, this.posts[0], e1);
        this.setVoltageColor(g, this.nodes[1].v); CircuitElm.drawThickLine(g, this.posts[1], e2);
        this.setVoltageColor(g, this.nodes[2].v); CircuitElm.drawThickLine(g, this.posts[2], this.hotLead);
        this.setVoltageColor(g, this.nodes[3].v); CircuitElm.drawThickLine(g, this.posts[3], this.coldLead);

        // body
        g.setColor(this.needsHighlight() ? CircuitElm.selectColor : Color.gray);
        CircuitElm.drawThickLine(g, this.rectPoints[0], this.rectPoints[1]);
        CircuitElm.drawThickLine(g, this.rectPoints[1], this.rectPoints[2]);
        CircuitElm.drawThickLine(g, this.rectPoints[2], this.rectPoints[3]);
        CircuitElm.drawThickLine(g, this.rectPoints[3], this.rectPoints[0]);

        this.drawPosts(g);
    }

    nonLinear(): boolean { return true; }

    getConnection(n1: number, n2: number): boolean {
        // electrical pair conduct; thermal pair conduct; the two domains do not
        if (this.comparePair(n1, n2, 0, 1)) return true;
        if (this.comparePair(n1, n2, 2, 3)) return true;
        return false;
    }

    // the Seebeck/Peltier terms couple the electrical, thermal and internal nodes,
    // so they must all be in the same matrix
    getMatrixConnection(n1: number, n2: number): boolean { return true; }

    setVoltageSource(n: number, v: VoltageSource): void {
        super.setVoltageSource(n, v);
        v.setNodes(this.nodes[0], this.nodes[4]);
    }

    stamp(): void {
        const sim = CircuitElm.sim;
        // electrical: Seebeck source (nodes 0 -> internal 4) in series with R (4 -> 1)
        sim.stampVoltageSource(this.nodes[0], this.nodes[4], this.voltSource);
        sim.stampNonLinear(this.nodes[4]);
        sim.stampResistor(this.nodes[4], this.nodes[1], this.resistance);

        // thermal: Fourier conduction between hot and cold faces
        if (this.thermalCond > 0)
            sim.stampResistor(this.nodes[2], this.nodes[3], 1 / this.thermalCond);

        // thermal nodes receive injected heat (right-hand side), and the
        // injections depend on I and T, so they must be iterated
        sim.stampNonLinear(this.nodes[2]);
        sim.stampNonLinear(this.nodes[3]);
        sim.stampRightSide(this.nodes[2]);
        sim.stampRightSide(this.nodes[3]);
    }

    doStep(): void {
        const sim = CircuitElm.sim;
        const th = this.nodes[2].v;
        const tc = this.nodes[3].v;
        const i = this.current;              // electrical current through the device

        // Seebeck emf opposes the applied voltage, proportional to dT.
        // stampVoltageSource(n1, n2, vs, v) sets V(n2) - V(n1) = v, so the emf must
        // be stamped NEGATIVE here to raise the terminal voltage: with the internal
        // node 4 between the source and R, this gives
        //     V(0) - V(1) = I*R + a*(Th-Tc)
        // which is the relation Qh - Qc = V*I depends on.
        sim.updateVoltageSource(this.nodes[0], this.nodes[4], this.voltSource, -this.seebeck * (th - tc));

        // Peltier pumping: aITc leaves the cold face, aITh enters the hot face.
        // The difference aI(Th-Tc) is supplied by the electrical port via the
        // Seebeck source above, so total energy balances exactly.
        const joule = 0.5 * i * i * this.resistance;
        sim.stampRightSide(this.nodes[2],  this.seebeck * i * th + joule);
        sim.stampRightSide(this.nodes[3], -this.seebeck * i * tc + joule);
    }

    setCurrent(vs: VoltageSource, c: number): void { this.current = c; }

    stepFinished(): void {
        const th = this.nodes[2].v, tc = this.nodes[3].v;
        const i = this.current;
        const cond = this.thermalCond * (th - tc);
        this.qCold = this.seebeck * i * tc - 0.5 * i * i * this.resistance - cond;
        this.qHot  = this.seebeck * i * th + 0.5 * i * i * this.resistance - cond;
        // measured from the solved terminal voltage rather than recomputed from the
        // model equation, so that the Qh-Qc-W residual shown in getInfo() is a real
        // check against the circuit solution and not the formula compared to itself
        this.elecPower = (this.nodes[0].v - this.nodes[1].v) * i;
        // only meaningful when the device is actually being driven; with no drive
        // (Seebeck generator mode) W tends to zero and the ratio blows up
        this.cop = (this.elecPower > 1e-6) ? this.qCold / this.elecPower : 0;
    }

    getInfo(arr: string[]): void {
        arr[0] = "thermoelectric (Peltier)";
        arr[1] = "I = " + CircuitElm.getCurrentText(this.current);
        arr[2] = "Th = " + CircuitElm.showFormat.format(this.nodes[2].v) + " K, Tc = " + CircuitElm.showFormat.format(this.nodes[3].v) + " K";
        arr[3] = "Qc (absorbed) = " + CircuitElm.getUnitText(this.qCold, "W");
        arr[4] = "Qh (rejected) = " + CircuitElm.getUnitText(this.qHot, "W");
        arr[5] = "W (electrical) = " + CircuitElm.getUnitText(this.elecPower, "W");
        // exact-balance check, displayed so it can be verified at a glance
        arr[6] = "Qh-Qc-W = " + CircuitElm.getUnitText(this.qHot - this.qCold - this.elecPower, "W");
        arr[7] = "COP (cooling) = " + CircuitElm.showFormat.format(this.cop);
    }

    getScopeText(v: number): string {
        return Locale.LS("thermoelectric") + ", COP " + CircuitElm.showFormat.format(this.cop);
    }

    getEditInfo(n: number): EditInfo | null {
        if (n === 0)
            return new EditInfo("Seebeck coefficient (V/K)", this.seebeck, 0, 0);
        if (n === 1)
            return new EditInfo("Electrical resistance (ohms)", this.resistance, 0, 0);
        if (n === 2)
            return new EditInfo("Thermal conductance (W/K)", this.thermalCond, 0, 0);
        return null;
    }

    setEditValue(n: number, ei: EditInfo): void {
        if (n === 0)
            this.seebeck = ei.value;
        if (n === 1 && ei.value > 0)
            this.resistance = ei.value;
        if (n === 2 && ei.value >= 0)
            this.thermalCond = ei.value;
    }
}
