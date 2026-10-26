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

import { Choice } from "./Choice";
import { CircuitElm } from "./CircuitElm";
import { CircuitNode } from "./CircuitNode";
import { CircuitXMLDeserializer } from "./CircuitXMLDeserializer";
import { CircuitXMLSerializer } from "./CircuitXMLSerializer";
import { CirSim } from "./CirSim";
import { CompositeElm } from "./CompositeElm";
import { CustomLogicModel } from "./CustomLogicModel";
import { EditInfo } from "./EditInfo";
import { Graphics } from "./Graphics";
import { HookRegistry } from "./HookRegistry";
import { Locale } from "./Locale";
import { OpAmpRealElm } from "./OpAmpRealElm";
import { StringTokenizer } from "./StringTokenizer";
import { SubcircuitModel } from "./SubcircuitModel";
import { SubcircuitSymbols } from "./SubcircuitSymbols";
import { WireRouter } from "./WireRouter";

// instance of a subcircuit (eg imported from a SPICE .subckt) drawn with the symbol of a
// regular component (diode, transistor, MOSFET) instead of a chip box.  The model says which
// symbol to use and which of its nodes goes to each pin of the symbol.  Op-amp subcircuits
// are models of OpAmpRealElm instead.

export class SubcircuitSymbolElm extends CompositeElm {
    static readonly DEFAULT_SYMBOL = "diode";

    modelName: string;
    model: SubcircuitModel | null = null;
    symbol: string;
    symbolIndex: number = 0;
    // flags of the element drawing the symbol
    symFlags: number = 0;
    // element used only to draw the symbol
    drawElm: any = null;

    constructor(xx: number, yy: number);
    constructor(xx: number, yy: number, name: string);
    constructor(xa: number, ya: number, xb: number, yb: number, f: number, st: StringTokenizer);
    constructor(xa: number, ya: number, xbOrName?: number | string, yb?: number, f?: number, st?: StringTokenizer) {
        if (typeof xbOrName === "number") {
            super(xa, ya, xbOrName, yb!, f!);
            this.modelName = CustomLogicModel.unescape(st!.nextToken());
        } else {
            super(xa, ya);
            // no model yet when this is used to register the class, before the models can be
            // loaded, or when loading a file, which then calls undumpXml()
            this.modelName = xbOrName ?? "default";
        }
        const m = SubcircuitModel.getModelWithName(this.modelName);
        this.symbol = (m != null && m.symbol != null) ? m.symbol : SubcircuitSymbolElm.DEFAULT_SYMBOL;
        this.initSymbol(true);
        if (xbOrName === undefined)
            this.setNoModel();
        else if (typeof xbOrName === "number")
            this.loadModel(st!);
        else
            this.updateModels();
    }

    // set up the element used to draw the symbol
    initSymbol(defaultFlags: boolean): void {
        const classes: { [sym: string]: string } = {
            diode: "DiodeElm", zener: "ZenerElm", schottky: "SchottkyElm",
            npn: "NTransistorElm", pnp: "PTransistorElm", nmos: "NMosfetElm", pmos: "PMosfetElm",
            njfet: "NJfetElm", pjfet: "PJfetElm",
        };
        if (classes[this.symbol] == null)
            this.symbol = SubcircuitSymbolElm.DEFAULT_SYMBOL;
        this.drawElm = CirSim.constructElement(classes[this.symbol], this.x, this.y);
        this.symbolIndex = SubcircuitSymbols.getSymbolIndex(this.symbol);
        if (defaultFlags)
            this.symFlags = this.drawElm.flags;
        this.noDiagonal = this.drawElm.noDiagonal;
    }

    getSymbolPinCount(): number { return SubcircuitSymbols.symbolPins[this.symbolIndex].length; }

    dumpXmlModel(doc: Document): void {
        for (const ce of this.compElmList)
            ce.dumpXmlModel(doc);
        if (this.model != null && !(this.model.builtin || this.model.dumped))
            this.model.dumpXml(doc);
    }

    dumpXml(doc: Document, elem: Element): void {
        this.dumpXmlModel(doc);
        super.dumpXml(doc, elem);
        CircuitXMLSerializer.dumpAttr(elem, "mo", this.modelName);
        CircuitXMLSerializer.dumpAttr(elem, "sy", this.symbol);
        CircuitXMLSerializer.dumpAttr(elem, "sf", this.symFlags);
    }

    undumpXml(xml: CircuitXMLDeserializer): void {
        this.modelName = xml.parseStringAttr("mo", this.modelName)!;
        this.symbol = xml.parseStringAttr("sy", this.symbol)!;
        this.initSymbol(false);
        this.symFlags = xml.parseIntAttr("sf", this.symFlags);
        this.updateModels();
        super.undumpXml(xml);
    }

    // (rebuilt only if the model changed: the circuit must then be analyzed again)
    updateModels(): void {
        const m = SubcircuitModel.getModelWithName(this.modelName);
        if (m === this.model && m != null && this.isConnected())
            return;
        this.model = null;
        this.loadModel(null);
        CircuitElm.app?.needAnalyze();
    }

    // name of the subcircuit model used (see SubcircuitModel.getModelNamesInUse())
    getSubcircuitModelName(): string | null { return this.modelName; }

    loadModel(st: StringTokenizer | null): void {
        const m = SubcircuitModel.getModelWithName(this.modelName);
        if (m == null || m.symbolNodes == null || m.symbolNodes.length !== this.getSymbolPinCount() ||
                this.symbol !== m.symbol) {
            // model missing or not made for this symbol: draw the symbol without connections
            this.setNoModel();
            return;
        }
        this.model = m;
        if (st != null)
            this.loadComposite(st, m.getNodeList(), m.symbolNodes);
        else
            this.loadCompositeXml(m.getElmEntries(), m.symbolNodes);
        this.allocNodes();
        this.setPoints();
    }

    setNoModel(): void {
        this.compElmList = [];
        this.numPosts = this.numNodes = 0;
        this.posts = [];
        this.allocNodes();
        this.setPoints();
    }

    isConnected(): boolean { return this.numPosts === this.getSymbolPinCount(); }

    getPinCurrent(n: number): number {
        return this.isConnected() ? this.getCurrentIntoNode(n) : 0;
    }

    setPoints(): void {
        super.setPoints();
        if (this.drawElm == null)
            return;
        this.syncDrawElm();
        this.drawElm.setPoints();
        this.boundingBox = this.drawElm.boundingBox;
        for (let i = 0; i !== this.numPosts; i++)
            this.setPost(i, this.drawElm.getPost(i));
    }

    draw(g: Graphics): void {
        const n = this.getSymbolPinCount();
        for (let i = 0; i !== n; i++)
            this.drawElm.nodes[i] = (i < this.numPosts) ? this.nodes[i] : CircuitNode.ground;
        // currents used by the symbol to draw the dots
        if (SubcircuitSymbols.isBjt(this.symbol)) {
            this.drawElm.ib = -this.getPinCurrent(0);
            this.drawElm.ic = -this.getPinCurrent(1);
            this.drawElm.ie = -this.getPinCurrent(2);
        } else if (SubcircuitSymbols.isMosfet(this.symbol) || SubcircuitSymbols.isJfet(this.symbol)) {
            this.drawElm.ids = -this.getPinCurrent(2);
            if (SubcircuitSymbols.isJfet(this.symbol))
                this.drawElm.gateCurrent = -this.getPinCurrent(0);
        } else
            this.drawElm.current = -this.getPinCurrent(0);
        this.drawElm.setSelected(this.needsHighlight());
        this.drawElm.draw(g);
        this.boundingBox = this.drawElm.boundingBox;
        this.drawPosts(g);
    }

    addRoutingObstacle(router: WireRouter): void {
        this.drawElm.addRoutingObstacle(router);
    }

    // flips are done by the drawn element (which knows how its symbol flips), then copied back
    syncDrawElm(): void {
        const d = this.drawElm;
        d.x = this.x; d.y = this.y; d.x2 = this.x2; d.y2 = this.y2;
        d.flags = this.symFlags;
    }

    copyFromDrawElm(): void {
        const d = this.drawElm;
        this.x = d.x; this.y = d.y; this.x2 = d.x2; this.y2 = d.y2;
        this.symFlags = d.flags;
        this.setPoints();
    }

    flipX(c2: number, count: number): void {
        this.syncDrawElm();
        this.drawElm.flipX(c2, count);
        this.copyFromDrawElm();
    }

    flipY(c2: number, count: number): void {
        this.syncDrawElm();
        this.drawElm.flipY(c2, count);
        this.copyFromDrawElm();
    }

    flipXY(xmy: number, count: number): void {
        this.syncDrawElm();
        this.drawElm.flipXY(xmy, count);
        this.copyFromDrawElm();
    }

    canFlipX(): boolean { return this.drawElm.canFlipX(); }
    canFlipY(): boolean { return this.drawElm.canFlipY(); }

    getDumpType(): number { return 437; }
    getXmlDumpType(): string { return "scs"; }

    getElmType(): string { return this.drawElm.getElmType(); }

    getInfo(arr: string[]): void {
        const name = Locale.LS(SubcircuitSymbols.symbolLabels[this.symbolIndex]);
        if (this.model == null) {
            arr[0] = name + " (" + Locale.LS("missing: ") + this.modelName + ")";
            return;
        }
        arr[0] = name + " (" + this.model.name + ")";
        if (!this.isConnected())
            return;
        const names = SubcircuitSymbols.symbolPinNames[this.symbolIndex];
        for (let i = 0; i !== names.length && i + 1 < arr.length; i++)
            arr[i + 1] = names[i] + " = " + CircuitElm.getVoltageText(this.nodes[i].v);
    }

    private models: SubcircuitModel[] = [];

    getEditInfo(n: number): EditInfo | null {
        if (n === 0) {
            const label = (this.model == null) ? (Locale.LS("Model not found: ") + this.modelName) : "Model Name";
            const ei = new EditInfo(label, 0, -1, -1);
            // only the models made for this symbol
            this.models = SubcircuitModel.getModelList().filter(m => m.symbol === this.symbol);
            ei.choice = new Choice();
            for (let i = 0; i !== this.models.length; i++) {
                ei.choice.add(this.models[i].name);
                if (this.models[i] === this.model)
                    ei.choice.select(i);
            }
            return ei;
        }
        return null;
    }

    setEditValue(n: number, ei: EditInfo): void {
        if (n === 0) {
            const i = ei.choice!.getSelectedIndex();
            if (i < 0 || i >= this.models.length)
                return;
            this.modelName = this.models[i].name;
            this.updateModels();
        }
    }
}

// subcircuits made for a symbol (eg imported from SPICE) are drawn with it; op-amps are
// models of the real op-amp
HookRegistry.createSymbolSubcircuitElm = (x, y, name) => {
    const m = SubcircuitModel.getModelWithName(name);
    if (SubcircuitSymbols.isOpAmpModel(m))
        return new OpAmpRealElm(x, y, name);
    if (m != null && m.symbol != null)
        return new SubcircuitSymbolElm(x, y, name);
    return null;
};
