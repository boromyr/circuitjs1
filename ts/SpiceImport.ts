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

import { BetterStringTokenizer } from "./BetterStringTokenizer";
import { CustomLogicModel } from "./CustomLogicModel";
import { DiodeModel } from "./DiodeModel";
import { ExtListEntry } from "./ExtListEntry";
import { SpiceNetlist } from "./SpiceNetlist";
import { SubcircuitSymbols } from "./SubcircuitSymbols";
import { TransistorModel } from "./TransistorModel";
import { UserModelLibrary } from "./UserModelLibrary";

// Converts a SPICE .subckt into the old-style element/dump strings a subcircuit model is
// built from (see SubcircuitModel.convertOldFormatToXml()), and guesses from its header
// what kind of component it is and which node goes to each pin.  No UI here: see
// ImportFromSpiceDialog.

class TransistorModelImport {
    pnp: number = 1;
    beta: number = 100;
    name: string = "";
    cjc: number = 0;
    cje: number = 0;
    rc: number = 0;
    re: number = 0;
    rb: number = 0;
    areaModelNames: string[] = [];
}

class FetModelImport {
    pnp: number = 1;
    beta: number = 1e-3;
    vto: number = -2;
}

class VoltageSource {
    node1: string = "";
    node2: string = "";
}

export interface SpiceSubcircuit {
    name: string;            // lower case, as the parser sees it
    displayName: string;     // as written in the file
    extList: ExtListEntry[];
    elmDump: string;         // element classes and nodes, one per line
    dump: string;            // escaped element parameters
}

// the .subckt line's nodes and what the comments say about them
export class SpiceHeader {
    nodes: string[] = [];    // lower case, as the parser sees them
    descs: string[] = [];    // description of each node, from the header comments if present
    text: string = "";       // header comments and subcircuit name, lower case
    found: boolean = false;  // is there a .subckt line?
}

export class SpiceImport {

    // split into lines, joining "+" continuation lines
    static getLines(text: string): string[] {
        const vec: string[] = [];
        for (const s of text.split(/[\r\n]+/)) {
            if (s.length === 0)
                continue;
            if (s.startsWith("+") && vec.length > 0)
                // a continuation always separates tokens ("+PULSE" must not glue to the previous one)
                vec[vec.length - 1] += " " + s.substring(1);
            else
                vec.push(s);
        }
        return vec;
    }

    // look at the .subckt line and the comments to find the nodes and what they are for
    static analyzeHeader(text: string): SpiceHeader {
        const h = new SpiceHeader();
        const lines = SpiceImport.getLines(text);
        // the subcircuit that is imported, if the text has the ones it uses too
        const top = SpiceNetlist.findTopSubckt(lines);
        let header = "";
        const ladder: string[] = [];
        const comments: string[] = [];
        let inLadder = false;
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith("*")) {
                let c = t.substring(1).trim().toLowerCase();
                comments.push(c);
                header += c + " ";
                // pin lists drawn as a ladder of "|", eg
                // * CONNECTIONS:   NON-INVERTING INPUT
                // *                | INVERTING INPUT
                if (c.startsWith("connections") || c.startsWith("node assignment") || c.startsWith("pin order") ||
                        c.startsWith("pinout") || c.startsWith("pin out")) {
                    inLadder = true;
                    ladder.length = 0;
                    const ix = c.indexOf(':');
                    c = (ix < 0) ? "" : c.substring(ix + 1).trim();
                } else if (!inLadder)
                    continue;
                const pipes = c.startsWith("|");
                while (c.startsWith("|"))
                    c = c.substring(1).trim();
                if (c.length > 0)
                    ladder.push(c);
                else if (!pipes && ladder.length > 0)
                    inLadder = false;
                continue;
            }
            if (!t.toLowerCase().startsWith(".subckt"))
                continue;
            const st = new BetterStringTokenizer(t, " \t\f()");
            st.nextToken();
            if (!st.hasMoreTokens())
                continue;
            const name = st.nextToken();
            if (top != null && name !== top)
                continue;
            header += name + " ";
            for (const n of SpiceImport.subcktPins(st))
                h.nodes.push(n);
            h.found = true;
            break;
        }
        h.text = header;
        if (!h.found)
            return h;
        const descs: (string | null)[] = h.nodes.map((_, i) => ladder.length === h.nodes.length ? ladder[i] : null);
        // also "1=drain 2=gate 3=source" style comments
        for (const c of comments) {
            const st = new BetterStringTokenizer(c, " \t,;=:");
            const toks: string[] = [];
            while (st.hasMoreTokens()) {
                // the tokenizer also returns the delimiters
                const tok = st.nextToken();
                if (tok.length > 0 && ",;=:".indexOf(tok) < 0)
                    toks.push(tok);
            }
            for (let i = 0; i + 1 < toks.length; i++) {
                const k = toks[i];
                const n = h.nodes.indexOf(k);
                if (n >= 0 && descs[n] == null &&
                        (c.indexOf(k + "=") >= 0 || c.indexOf(k + " =") >= 0 || c.indexOf(k + ":") >= 0))
                    descs[n] = toks[i + 1];
            }
        }
        h.descs = descs.map((d, i) => d ?? h.nodes[i]);
        return h;
    }

    private static has(s: string, ...words: string[]): boolean {
        return words.some(w => s.indexOf(w) >= 0);
    }

    private static is(s: string, ...words: string[]): boolean {
        return words.includes(s);
    }

    // which pin of a symbol a node description refers to, or -1
    static classifyPin(sym: string, d: string): number {
        const has = SpiceImport.has, is = SpiceImport.is;
        if (sym === SubcircuitSymbols.SYM_OPAMP) {
            if (has(d, "non-inv", "noninv", "non inv") || is(d, "+in", "in+", "inp", "+", "vinp", "in_p", "inplus", "+input", "pos_in", "vin+"))
                return 1;
            if (has(d, "inv") || is(d, "-in", "in-", "inn", "-", "vinn", "in_n", "inminus", "-input", "neg_in", "vin-"))
                return 0;
            if (has(d, "output") || is(d, "out", "vout", "o", "vo"))
                return 2;
            if ((has(d, "pos") && has(d, "supply", "power", "rail")) || is(d, "v+", "vcc", "vdd", "vs+", "+v", "vpos", "+vs", "+vcc", "vcc+", "vp"))
                return 3;
            if ((has(d, "neg") && has(d, "supply", "power", "rail")) || is(d, "v-", "vee", "vss", "vs-", "-v", "vneg", "-vs", "-vee", "vee-", "vn", "gnd"))
                return 4;
            return -1;
        }
        if (SubcircuitSymbols.isDiode(sym)) {
            if (has(d, "anode") || is(d, "a", "+", "p"))
                return 0;
            if (has(d, "cathode") || is(d, "k", "c", "-", "n"))
                return 1;
            return -1;
        }
        if (SubcircuitSymbols.isBjt(sym)) {
            if (has(d, "base") || is(d, "b"))
                return 0;
            if (has(d, "collector") || is(d, "c"))
                return 1;
            if (has(d, "emitter") || is(d, "e"))
                return 2;
            return -1;
        }
        if (has(d, "gate") || is(d, "g"))
            return 0;
        if (has(d, "source") || is(d, "s"))
            return 1;
        if (has(d, "drain") || is(d, "d"))
            return 2;
        return -1;
    }

    // how many different pins of a symbol the node descriptions refer to
    static countPins(h: SpiceHeader, sym: string): number {
        const seen = new Set<number>();
        for (const d of h.descs) {
            const p = SpiceImport.classifyPin(sym, d);
            if (p >= 0)
                seen.add(p);
        }
        return seen.size;
    }

    // guess the component type from the header comments, subcircuit name and pins
    static guessSymbol(h: SpiceHeader): string | null {
        const has = SpiceImport.has;
        const t = h.text;
        const nc = h.nodes.length;
        if (nc >= 5 && (has(t, "operational amplifier", "op amp", "opamp", "op-amp", "comparator") ||
                SpiceImport.countPins(h, SubcircuitSymbols.SYM_OPAMP) >= 3 || nc === 5))
            return SubcircuitSymbols.SYM_OPAMP;
        if (nc === 2 && (has(t, "diode", "zener", "rectifier", "schottky", "led") || SpiceImport.countPins(h, "diode") === 2))
            return has(t, "zener") ? "zener" : has(t, "schottky") ? "schottky" : "diode";
        if (nc >= 3 && nc <= 4) {
            if (has(t, "jfet", "j-fet", "njf", "pjf"))
                return has(t, "pjf", "p-channel", "p-ch", "pch") ? "pjfet" : "njfet";
            if (has(t, "mosfet", "nmos", "pmos", "n-channel", "p-channel", "n-ch", "p-ch", "nch", "pch") || SpiceImport.countPins(h, "nmos") === 3)
                return has(t, "pmos", "p-channel", "p-ch", "pch") ? "pmos" : "nmos";
            if (has(t, "npn", "pnp", "darlington", "transistor", "bjt") || SpiceImport.countPins(h, "npn") === 3)
                return has(t, "pnp") ? "pnp" : "npn";
        }
        return null;
    }

    // pin order usually used by SPICE subcircuits: symbol pin for each node
    static getDefaultPinOrder(sym: string): number[] {
        if (sym === SubcircuitSymbols.SYM_OPAMP)
            return [1, 0, 3, 4, 2];  // +in -in V+ V- out
        if (SubcircuitSymbols.isDiode(sym))
            return [0, 1];           // anode cathode
        if (SubcircuitSymbols.isBjt(sym))
            return [1, 0, 2];        // collector base emitter
        return [2, 0, 1];            // drain gate source
    }

    // guess the node (index into h.nodes) for each pin of a symbol: from the descriptions
    // first, then the usual pin order, then any free node.  null if there are too few nodes.
    static guessPinNodes(h: SpiceHeader, sym: string): number[] | null {
        const pinCount = SubcircuitSymbols.symbolPins[SubcircuitSymbols.getSymbolIndex(sym)].length;
        const nc = h.nodes.length;
        if (nc < pinCount)
            return null;
        const nodeForPin: number[] = new Array(pinCount).fill(-1);
        const used: boolean[] = new Array(nc).fill(false);
        for (let i = 0; i !== nc; i++) {
            const p = SpiceImport.classifyPin(sym, h.descs[i]);
            if (p >= 0 && nodeForPin[p] < 0) {
                nodeForPin[p] = i;
                used[i] = true;
            }
        }
        const order = SpiceImport.getDefaultPinOrder(sym);
        for (let i = 0; i !== order.length && i < nc; i++) {
            const p = order[i];
            if (nodeForPin[p] < 0 && !used[i]) {
                nodeForPin[p] = i;
                used[i] = true;
            }
        }
        for (let p = 0; p !== pinCount; p++) {
            for (let i = 0; i !== nc && nodeForPin[p] < 0; i++)
                if (!used[i]) {
                    nodeForPin[p] = i;
                    used[i] = true;
                }
        }
        return nodeForPin;
    }

    // does the text only have .model lines (to add to the model library) and no subcircuit?
    static isModelLibrary(lines: string[]): boolean {
        let hasSubckt = false, hasModel = false;
        for (const l of lines) {
            const t = l.trim().toLowerCase();
            if (t.startsWith(".subckt"))
                hasSubckt = true;
            if (t.startsWith(".model"))
                hasModel = true;
        }
        return hasModel && !hasSubckt;
    }

    // state of one conversion
    private nodes: string[] = [];
    private voltageSources = new Map<string, VoltageSource>();
    private elmDump: string = "";
    private ldump: string = "";
    private log: (s: string) => void;

    constructor(log: (s: string) => void) {
        this.log = log;
    }

    // convert the subcircuit in a SPICE text; null (with the reason logged) if it can't be done
    parse(text: string): SpiceSubcircuit | null {
        // with the subcircuits it uses expanded into it
        let lines: string[] | null;
        try {
            lines = SpiceNetlist.flatten(SpiceImport.getLines(text), this.log);
        } catch (e) {
            this.log((e instanceof Error) ? e.message : String(e));
            return null;
        }
        if (lines == null)
            return null;
        const transistorModels = new Map<string, TransistorModelImport>();
        const fetModels = new Map<string, FetModelImport>();
        this.voltageSources = new Map();
        this.nodes = [];
        const extList: ExtListEntry[] = [];
        let subcircuitName: string | null = null;
        let subcircuitDisplayName = "";
        const parseNumber = SpiceImport.parseValue;

        // first pass, get a list of models and nodes
        for (const line of lines) {
            this.log("got line " + line);
            const st = new BetterStringTokenizer(line, " \t\f()");
            if (!st.hasMoreTokens())
                continue;
            const first = st.nextToken();
            if (first.startsWith("*"))
                continue;
            try {
                if (first.startsWith(".subckt")) {
                    if (subcircuitName != null) {
                        this.log("multiple subcircuits!");
                        return null;
                    }
                    subcircuitName = st.nextToken();
                    subcircuitDisplayName = st.tokenPreserveCase;
                    for (const n of SpiceImport.subcktPins(st)) {
                        this.nodes.push(n);
                        extList.push(new ExtListEntry(n, this.nodes.length));
                    }
                    continue;
                }
                if (first === ".ends")
                    continue;
                if (first.startsWith(".model")) {
                    const name = st.nextToken();
                    const type = st.nextToken();
                    if (type === "pnp" || type === "npn") {
                        const tmi = new TransistorModelImport();
                        tmi.pnp = (type === "pnp") ? -1 : 1;
                        tmi.name = subcircuitName + "-" + name;
                        const tm = TransistorModel.getModelWithName(tmi.name);
                        tm.satCur = 1e-16;
                        while (st.hasMoreTokens()) {
                            const s = st.nextToken();
                            if (s.startsWith("bf=")) tmi.beta = parseNumber(s.substring(3));
                            if (s.startsWith("is=")) tm.satCur = parseNumber(s.substring(3));
                            if (s.startsWith("br=")) tm.betaR = parseNumber(s.substring(3));
                            if (s.startsWith("ne=")) tm.leakBEemissionCoeff = parseNumber(s.substring(3));
                            if (s.startsWith("nc=")) tm.leakBCemissionCoeff = parseNumber(s.substring(3));
                            if (s.startsWith("nf=")) tm.emissionCoeffF = parseNumber(s.substring(3));
                            if (s.startsWith("nr=")) tm.emissionCoeffR = parseNumber(s.substring(3));
                            if (s.startsWith("vaf=")) tm.invEarlyVoltF = 1 / parseNumber(s.substring(4));
                            if (s.startsWith("var=")) tm.invEarlyVoltR = 1 / parseNumber(s.substring(4));
                            if (s.startsWith("ikf=")) tm.invRollOffF = 1 / parseNumber(s.substring(4));
                            if (s.startsWith("ikr=")) tm.invRollOffR = 1 / parseNumber(s.substring(4));
                            if (s.startsWith("ise=")) tm.BEleakCur = parseNumber(s.substring(4));
                            if (s.startsWith("isc=")) tm.BCleakCur = parseNumber(s.substring(4));
                            if (s.startsWith("cje=")) tmi.cje = parseNumber(s.substring(4));
                            if (s.startsWith("cjc=")) tmi.cjc = parseNumber(s.substring(4));
                            if (s.startsWith("rc=")) tmi.rc = parseNumber(s.substring(3));
                            if (s.startsWith("re=")) tmi.re = parseNumber(s.substring(3));
                            if (s.startsWith("rb=")) tmi.rb = parseNumber(s.substring(3));
                        }
                        tm.updateModel();
                        this.log("found transistor model " + name);
                        transistorModels.set(name, tmi);
                    }
                    if (type === "d") {
                        const dm = DiodeModel.getModelWithName(subcircuitName + "-" + name);
                        while (st.hasMoreTokens()) {
                            const s = st.nextToken();
                            if (s.startsWith("is="))
                                dm.saturationCurrent = parseNumber(s.substring(3));
                            else if (s.startsWith("rs="))
                                dm.seriesResistance = parseNumber(s.substring(3));
                            else if (s.startsWith("n="))
                                dm.emissionCoefficient = parseNumber(s.substring(2));
                            else if (s.startsWith("bv="))
                                dm.breakdownVoltage = parseNumber(s.substring(3));
                        }
                        dm.updateModel();
                    }
                    if (type === "njf" || type === "pjf") {
                        const fm = new FetModelImport();
                        if (type === "pjf")
                            fm.pnp = -1;
                        while (st.hasMoreTokens()) {
                            const s = st.nextToken();
                            if (s.startsWith("vto="))
                                fm.vto = parseNumber(s.substring(4));
                            else if (s.startsWith("beta="))
                                // SPICE: Ids = BETA*(Vgs-VTO)^2; JfetElm: Ids = beta/2*(Vgs-Vt)^2
                                fm.beta = 2 * parseNumber(s.substring(5));
                        }
                        fetModels.set(name, fm);
                    }
                    continue;
                }
                if (first.startsWith(".rename")) {
                    let i = 0;
                    while (st.hasMoreTokens()) {
                        const toStr = st.nextTokenPreserveCase();
                        if (i < extList.length)
                            extList[i++].name = toStr;
                    }
                    continue;
                }

                // other dot commands (.end, .param, .options...) don't define anything we use
                if (first.startsWith(".")) {
                    this.log("skipping " + first);
                    continue;
                }

                let nodeCount = 0;
                const c = first.charAt(0);
                if ("bcdfhilrv".indexOf(c) >= 0)
                    nodeCount = 2;
                else if ("qjm".indexOf(c) >= 0)
                    nodeCount = 3;
                else if (c === 'e' || c === 'g')
                    nodeCount = 2;     // might be POLY, just look at first two nodes
                else if (c === 'x') {
                    this.log("nested subcircuits not supported");
                    return null;
                } else {
                    this.log("can't understand line: " + line);
                    return null;
                }

                // need to keep track of voltage sources and their nodes to implement f and h
                if (c === 'v') {
                    const n1 = st.nextToken();
                    const n2 = st.nextToken();
                    this.addNode(n1);
                    this.addNode(n2);
                    const vs = new VoltageSource();
                    vs.node1 = n1;
                    vs.node2 = n2;
                    this.voltageSources.set(first, vs);
                    continue;
                }

                for (let i = 0; i !== nodeCount; i++)
                    this.addNode(st.nextToken());
                // and the nodes the expression of a VALUE source uses
                if ("egb".indexOf(c) >= 0)
                    for (const m of line.toLowerCase().matchAll(/\bv\s*\(([^()]*)\)/g))
                        for (const n of m[1].split(","))
                            this.addNode(n.trim());
            } catch (e) {
                this.log("exception when parsing line: " + line);
            }
        }

        this.log("nodes: " + this.nodes.join(","));

        // second pass
        this.elmDump = "";
        let dump = "";
        const addDump = (s: string) => {
            if (dump.length > 0)
                dump += " ";
            dump += CustomLogicModel.escape(s);
        };
        let extraNode = this.nodes.length + 1;
        for (const line of lines) {
            const st = new BetterStringTokenizer(line, " \t\f");
            if (!st.hasMoreTokens())
                continue;
            const first = st.nextToken();
            if (first.startsWith("*") || first.startsWith("."))
                continue;
            try {
                const c = first.charAt(0);
                if (c === 'c') {
                    const n1 = st.nextToken();
                    const n2 = st.nextToken();
                    const cap = parseNumber(st.nextToken());
                    // a capacitor of 0 (a parameter expression can give one) is an open circuit
                    if (cap === 0)
                        continue;
                    // IC=x (or IC = x) is the voltage on reset
                    const opts: string[] = [];
                    while (st.hasMoreTokens())
                        opts.push(st.nextToken());
                    const icm = /(?:^|\s)ic\s*=\s*(\S+)/.exec(opts.join(" "));
                    const ic = (icm == null) ? 0 : parseNumber(icm[1]);
                    this.elmDump += "CapacitorElm " + this.findNode(n1) + " " + this.findNode(n2) + "\r";
                    // add FLAG_BACK_EULER because that is probably the most appropriate setting for spice models
                    this.ldump = "2 " + cap + " " + ic + " " + ic;
                } else if (c === 'r') {
                    const n1 = st.nextToken();
                    const n2 = st.nextToken();
                    let restxt = st.nextToken();
                    // skip model if present
                    const cd = restxt.charAt(0);
                    if (!(cd >= '0' && cd <= '9') && cd !== '.')
                        restxt = st.nextToken();
                    const res = parseNumber(restxt);
                    this.elmDump += "ResistorElm " + this.findNode(n1) + " " + this.findNode(n2) + "\r";
                    this.ldump = "0 " + res;
                } else if (c === 'd') {
                    const n1 = st.nextToken();
                    const n2 = st.nextToken();
                    const mod = st.nextToken();
                    this.elmDump += "DiodeElm " + this.findNode(n1) + " " + this.findNode(n2) + "\r";
                    // 2 = FLAG_MODEL
                    this.ldump = "2 " + CustomLogicModel.escape(subcircuitName + "-" + mod);
                } else if (c === 'i') {
                    const n1 = st.nextToken();
                    const n2 = st.nextToken();
                    let x = st.nextToken();
                    if (x === "dc")
                        x = st.nextToken();
                    const cur = parseNumber(x);
                    this.elmDump += "CurrentElm " + this.findNode(n1) + " " + this.findNode(n2) + "\r";
                    this.ldump = "0 " + cur;
                } else if (c === 'q') {
                    const n1 = st.nextToken();
                    const n2 = st.nextToken();
                    const n3 = st.nextToken();
                    const mod = st.nextToken();
                    let area = 1;
                    if (st.hasMoreTokens()) {
                        const as = st.nextToken();
                        area = parseFloat(as.startsWith("area=") ? as.substring(5) : as);
                        if (isNaN(area))
                            throw new Error("bad area");
                    }
                    const tm = transistorModels.get(mod)!;
                    let collector = this.findNode(n1);
                    let base = this.findNode(n2);
                    let emitter = this.findNode(n3);
                    if (tm.rc > 0) {
                        // add resistor at collector
                        const n = extraNode++;
                        this.elmDump += "ResistorElm " + collector + " " + n + "\r";
                        addDump("0 " + tm.rc / area);
                        collector = n;
                    }
                    if (tm.rb > 0) {
                        // add resistor at base
                        const n = extraNode++;
                        this.elmDump += "ResistorElm " + base + " " + n + "\r";
                        addDump("0 " + tm.rb / area);
                        base = n;
                    }
                    if (tm.re > 0) {
                        // add resistor at emitter
                        const n = extraNode++;
                        this.elmDump += "ResistorElm " + emitter + " " + n + "\r";
                        addDump("0 " + tm.re / area);
                        emitter = n;
                    }
                    if (tm.cje > 0) {
                        // add capacitor for base-emitter junction (with FLAG_BACK_EULER)
                        this.elmDump += "CapacitorElm " + base + " " + emitter + "\r";
                        addDump("2 " + tm.cje * area + " 0 0");
                    }
                    if (tm.cjc > 0) {
                        // add capacitor for base-collector junction
                        this.elmDump += "CapacitorElm " + base + " " + collector + "\r";
                        addDump("2 " + tm.cjc * area + " 0 0");
                    }
                    this.elmDump += "TransistorElm " + base + " " + collector + " " + emitter + " \r";
                    this.ldump = "0 " + tm.pnp + " 0 0 " + tm.beta + " " + SpiceImport.getTransistorModelWithArea(tm, area);
                } else if (c === 'j') {
                    const n1 = st.nextToken();
                    const n2 = st.nextToken();
                    const n3 = st.nextToken();
                    const mod = st.nextToken();
                    const fm = fetModels.get(mod)!;
                    const drain = this.findNode(n1);
                    const gate = this.findNode(n2);
                    const source = this.findNode(n3);
                    this.elmDump += "JfetElm " + gate + " " + source + " " + drain + " \r";
                    this.ldump = ((fm.pnp === -1) ? "1" : "0") + " " + fm.vto + " " + fm.beta;
                } else if (c === 'l') {
                    const n1 = st.nextToken();
                    const n2 = st.nextToken();
                    const ind = parseNumber(st.nextToken());
                    this.elmDump += "InductorElm " + this.findNode(n1) + " " + this.findNode(n2) + "\r";
                    // add FLAG_BACK_EULER because that is probably the most appropriate setting for spice models
                    this.ldump = "2 " + ind + " 0";
                } else if (c === 'v') {
                    const n1 = st.nextToken();
                    const n2 = st.nextToken();
                    let x = st.nextToken();
                    if (x === "dc")
                        x = st.nextToken();
                    // higher voltage node comes first for spice, last for us.
                    // rather than swap nodes, swap the sign of the voltage because
                    // it simplifies things for controlled sources
                    this.elmDump += "VoltageElm " + this.findNode(n1) + " " + this.findNode(n2) + "\r";
                    const wave = /^(pulse|sin)\b/.exec(x);
                    if (wave != null) {
                        // PULSE(v1 v2 td tr tf pw per) and SIN(vo va freq ...): the parentheses are
                        // optional.  Delay, rise and fall times, damping are not in the dump format.
                        // the arguments follow the keyword after the name and the two nodes (which
                        // may contain "sin" or "pulse" too, as in Vsin or sinout)
                        const afterNodes = line.toLowerCase().replace(/^\s*[^\s()]+[\s()]+[^\s()]+[\s()]+[^\s()]+/, "");
                        const kw = new RegExp("\\b" + wave[1] + "\\b").exec(afterNodes)!;
                        const args = afterNodes.substring(kw.index + wave[1].length)
                            .replace(/[()]/g, " ").trim().split(/\s+/).filter(s => s.length > 0 && !s.includes("="));
                        const num = (i: number, def: number) => (i < args.length) ? parseNumber(args[i]) : def;
                        if (wave[1] === "sin") {
                            // waveform 1 = WF_AC: frequency, amplitude, offset, phase, duty
                            this.ldump = "0 1 " + num(2, 0) + " " + (-num(1, 0)) + " " + (-num(0, 0)) + " 0 0.5";
                        } else {
                            const v1 = num(0, 0);
                            const v2 = num(1, 0);
                            const pw = num(5, 0);
                            const per = num(6, 0);
                            if (per > 0 && pw > 0 && pw < per)
                                // flags 4 = FLAG_PULSE_DUTY, waveform 5 = WF_PULSE: low level is the bias
                                this.ldump = "4 5 " + (1 / per) + " " + (-(v2 - v1)) + " " + (-v1) + " 0 " + (pw / per);
                            else
                                this.ldump = "0 0 0 " + (-v1);
                        }
                    } else
                        this.ldump = "0 0 0 " + (-parseNumber(x));
                } else if (c === 'b' || ((c === 'e' || c === 'g') && /\svalue\b/i.test(line))) {
                    this.parseValueSource(c, line);
                } else if (c === 'e') {
                    this.parseControlledSource("VCVSElm", st, false);
                } else if (c === 'g') {
                    this.parseControlledSource("VCCSElm", st, false);
                } else if (c === 'h') {
                    this.parseControlledSource("CCVSElm", st, true);
                } else if (c === 'f') {
                    this.parseControlledSource("CCCSElm", st, true);
                } else {
                    this.log("skipping " + first);
                    continue;
                }
                addDump(this.ldump);
            } catch (e) {
                this.log("exception when parsing line: " + line + ((e instanceof Error) ? " (" + e.message + ")" : ""));
                return null;
            }
        }
        if (subcircuitName == null) {
            this.log("No model!");
            return null;
        }
        // pin names are always shown in capitals
        for (const e of extList)
            e.name = e.name.toUpperCase();
        this.log("elmDump\n" + this.elmDump);
        this.log("\ndump\n" + dump);
        return { name: subcircuitName, displayName: subcircuitDisplayName, extList, elmDump: this.elmDump, dump };
    }

    private addNode(n: string): void {
        if (n.length === 0)
            throw new Error("missing node");
        if (!this.nodes.includes(n) && n !== "0")
            this.nodes.push(n);
    }

    private findNode(node: string): number {
        return this.nodes.indexOf(node) + 1;
    }

    // get/create variant of transistor model with a particular area
    private static getTransistorModelWithArea(tmi: TransistorModelImport, area: number): string {
        if (area === 1)
            return tmi.name;
        const n = tmi.name + "-A" + area;
        if (tmi.areaModelNames.includes(n))
            return n;

        // create new model from old
        const tm1 = TransistorModel.getModelWithName(tmi.name);
        const tm = TransistorModel.getModelWithNameOrCopy(n, tm1);

        // adjust parameters as necessary for area
        tm.satCur = tm1.satCur * area;
        tm.invRollOffF = tm1.invRollOffF / area;
        tm.BEleakCur = tm1.BEleakCur * area;
        tm.invRollOffR = tm1.invRollOffR / area;
        tm.BCleakCur = tm1.BCleakCur * area;
        tm.updateModel();
        tmi.areaModelNames.push(n);
        return n;
    }

    // E or G source with VALUE = {expression}, or B source (I = or V = expression)
    private parseValueSource(c: string, line: string): void {
        const m = /^\S+\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line.toLowerCase());
        if (m == null)
            throw new Error("missing nodes");
        let n1 = m[1];
        let n2 = m[2];
        let rest = m[3];
        let cls: string;
        if (c === 'b') {
            const bm = /^([iv])\s*=\s*(.*)$/.exec(rest);
            if (bm == null)
                throw new Error("expected I= or V=");
            cls = (bm[1] === 'i') ? "VCCSElm" : "VCVSElm";
            rest = bm[2];
        } else {
            cls = (c === 'e') ? "VCVSElm" : "VCCSElm";
            rest = rest.replace(/^value\s*=?\s*/, "");
        }
        // swap output nodes for current sources because current flows the opposite way
        if (cls === "VCCSElm") {
            const x = n1;
            n1 = n2;
            n2 = x;
        }
        const inputs: string[] = [];
        const expr = SpiceNetlist.translateExpr(rest, inputs);
        this.elmDump += cls;
        for (const inp of inputs)
            this.elmDump += " " + this.findNode(inp);
        this.elmDump += " " + this.findNode(n1) + " " + this.findNode(n2) + "\r";
        this.ldump = "0 " + inputs.length + " " + expr;
    }

    // the pins of a .subckt line, from the tokenizer after the name: the tokens before the
    // parameters (PARAMS:, x=1, or x = 1 with spaces, whose name is not a pin either)
    private static subcktPins(st: BetterStringTokenizer): string[] {
        const toks: string[] = [];
        while (st.hasMoreTokens()) {
            const n = st.nextToken();
            if (n !== "(" && n !== ")")
                toks.push(n);
        }
        for (let i = 0; i < toks.length; i++) {
            const eq = toks[i].indexOf('=');
            if (toks[i].endsWith(":") || eq > 0)
                return toks.slice(0, i);
            if (eq === 0)
                return toks.slice(0, Math.max(0, i - 1));
        }
        return toks;
    }

    // a number with an optional suffix, or a constant expression in braces: {1/12}
    private static parseValue(s: string): number {
        if (s.startsWith("{") && s.endsWith("}")) {
            const x = SpiceNetlist.evalConst(s.substring(1, s.length - 1));
            if (x == null)
                throw new Error("bad number: " + s);
            return x;
        }
        return UserModelLibrary.parseNumber(s);
    }

    private static getLetter(ch: number): string {
        return String.fromCharCode('a'.charCodeAt(0) + ch);
    }

    private parseControlledSource(cls: string, st: BetterStringTokenizer, cc: boolean): void {
        // get output nodes
        let n1 = st.nextToken();
        let n2 = st.nextToken();
        const flags = cls.startsWith("CC") ? 2 : 0;

        // swap output nodes for current sources because current flows the opposite way
        // (output nodes come first for spice, last for us)
        if (cls.endsWith("CSElm")) {
            const x = n1;
            n1 = n2;
            n2 = x;
        }

        st.setDelimiters(" =");
        let n3 = st.nextToken();
        if (n3 === "value")
            throw new Error("value not supported for current-controlled sources");
        if (!n3.startsWith("poly")) {
            // not a POLY, just simple linear controlled source with two control inputs
            let n4: string;
            if (cc) {
                // current controlled source, convert voltage source to node pair
                const vs = this.voltageSources.get(n3)!;
                n3 = vs.node1;
                n4 = vs.node2;
            } else {
                // get second node for voltage controlled source
                n4 = st.nextToken();
            }
            const mult = SpiceImport.parseValue(st.nextToken());
            this.elmDump += cls + " " + this.findNode(n3) + " " + this.findNode(n4) + " " + this.findNode(n1) + " " + this.findNode(n2) + "\r";
            this.ldump = flags + " 2 " + mult + "*(a-b)";
            return;
        }

        // need to parse POLY, first get dimension
        const dim = SpiceImport.getPolyDim(n3);

        // get inputs
        const inputs: string[] = [];
        const inputExprs: string[] = new Array(dim);
        this.elmDump += cls + " ";
        const letter = SpiceImport.getLetter;

        // parse list of inputs of form (a,b)
        for (let i = 0; i !== dim; i++) {
            const parts = st.nextToken().split(/[(),]+/).filter(x => x.length > 0);
            const na = parts[0];
            if (cc) {
                // current-controlled source
                const vs = this.voltageSources.get(na)!;
                inputExprs[i] = letter(inputs.length / 2);
                inputs.push(vs.node1, vs.node2);
                continue;
            }
            inputExprs[i] = letter(inputs.length);
            inputs.push(na);
            if (parts.length > 1 && parts[1] !== "0") {
                inputExprs[i] = "(" + letter(inputs.length - 1) + "-" + letter(inputs.length) + ")";
                inputs.push(parts[1]);
            }
        }
        for (const inp of inputs)
            this.elmDump += this.findNode(inp) + " ";

        this.elmDump += this.findNode(n1) + " " + this.findNode(n2) + "\r";

        let expr = "";

        // convert POLY to expression
        for (let i = 0; st.hasMoreTokens(); i++) {
            const x = UserModelLibrary.parseNumber(st.nextToken());
            if (x === 0)
                continue;
            if (expr.length > 0)
                expr += "+";
            if (i === 0) {
                expr = SpiceImport.formatDouble(x);
                continue;
            }
            // handle a few higher elements of POLY(2)
            if (dim === 2 && (i >= 3 && i <= 5)) {
                expr += SpiceImport.formatDouble(x) + "*" + inputExprs[i > 3 ? 1 : 0] + "*" + inputExprs[i > 4 ? 1 : 0];
                continue;
            }
            // other than that, we only deal with the first n+1 terms of POLY(n).  need to improve this
            if (i > dim)
                throw new Error("POLY term not supported");
            expr += SpiceImport.formatDouble(x) + "*" + inputExprs[i - 1];
        }
        this.ldump = flags + " " + inputs.length + " " + expr;
    }

    // numbers in expressions: like Java's Double.toString() as far as the expression
    // parser is concerned (no "e+" exponents, which it would read as an addition)
    private static formatDouble(x: number): string {
        return String(x).replace("e+", "e");
    }

    private static getPolyDim(s: string): number {
        const ix = s.indexOf('(');
        const d = parseInt(s.substring(ix + 1, s.length - 1));
        if (isNaN(d))
            throw new Error("bad POLY");
        return d;
    }
}
