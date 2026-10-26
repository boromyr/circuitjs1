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
import { DiodeModel } from "./DiodeModel";
import { HookRegistry } from "./HookRegistry";
import { Locale } from "./Locale";
import { MosfetModel } from "./MosfetModel";
import { SubcircuitModel } from "./SubcircuitModel";
import { SubcircuitSymbols } from "./SubcircuitSymbols";
import { TransistorModel } from "./TransistorModel";

type DeviceModel = DiodeModel | TransistorModel | MosfetModel;

// an imported device model
export class UserModelEntry {
    name: string = "";     // model name, as used by the elements
    type: string = "";     // SPICE type: d, npn, pnp, njf, pjf, nmos, pmos
    line: string = "";     // .model line, re-parsed at startup (regenerated when the model is edited)
    model: DeviceModel = null!;
    beta: number = 100;    // BJT forward beta (BF), kept only to write it back out
}

// Device models imported from SPICE ".model" lines (diodes, BJTs, JFETs, MOSFETs), kept in
// local storage so they show up in the model list of each component's edit dialog across
// sessions (and stay editable there), and the menu category chosen for each subcircuit.
export class UserModelLibrary {
    static readonly MODEL_PREFIX = "spiceModel:";
    static readonly CATEGORY_PREFIX = "subcircuitCategory:";

    // menu categories a subcircuit can be placed in; keys are stored, labels are locale keys
    static readonly CAT_SUBCIRCUITS = SubcircuitSymbols.CAT_SUBCIRCUITS;
    static readonly categoryKeys = [
        UserModelLibrary.CAT_SUBCIRCUITS, "passive", "input", "output", "active", "activeBloc", "gates", "chips", "achips",
    ];
    static readonly categoryLabels = [
        "Subcircuits", "Passive Components", "Inputs and Sources", "Outputs and Labels", "Active Components",
        "Active Building Blocks", "Logic Gates, Input and Output", "Digital Chips", "Analog and Hybrid Chips",
    ];

    static entries: Map<string, UserModelEntry> = new Map();
    static sequenceNumber: number = 1;  // bumped whenever the menus need to be rebuilt

    static getStorage(): Storage | null {
        try {
            if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function")
                return null;
            return localStorage;
        } catch (e) {
            return null;
        }
    }

    // save a model's line, so it is loaded again in the next sessions
    static store(e: UserModelEntry): void {
        try {
            UserModelLibrary.getStorage()?.setItem(UserModelLibrary.MODEL_PREFIX + e.name, e.line);
        } catch (ex) {
            CirSim.console("can't save model " + e.name + ": " + ex);
        }
    }

    static loadFromStorage(): void {
        const stor = UserModelLibrary.getStorage();
        if (stor == null)
            return;
        for (let i = 0; i !== stor.length; i++) {
            const key = stor.key(i);
            if (key == null || !key.startsWith(UserModelLibrary.MODEL_PREFIX))
                continue;
            try {
                UserModelLibrary.parseModelLine(stor.getItem(key)!, []);
            } catch (e) {
                CirSim.console("can't load model " + key + ": " + e);
            }
        }
        UserModelLibrary.sequenceNumber++;
    }

    // device models made for the inside of subcircuits (their diodes, transistors and JFETs
    // come with the model), unless they were imported on their own: not worth listing among
    // the models of a diode or transistor
    static getSubcircuitInternalModelNames(): Set<string> {
        const names = new Set<string>();
        const scan = (m: SubcircuitModel) => {
            if (m.elmDoc == null)
                return;
            for (const child of Array.from(m.elmDoc.documentElement.children)) {
                const mo = child.getAttribute("mo");
                if (mo != null)
                    names.add(mo);
                const nm = child.getAttribute("nm");
                if (nm != null && (child.tagName === "dm" || child.tagName === "tm" || child.tagName === "mm"))
                    names.add(nm);
            }
        };
        for (const m of SubcircuitModel.globalModelMap.values())
            scan(m);
        for (const m of SubcircuitModel.localModelMap.values())
            scan(m);
        for (const n of UserModelLibrary.entries.keys())
            names.delete(n);
        return names;
    }

    static getEntries(): UserModelEntry[] {
        return [...UserModelLibrary.entries.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    }

    // import every ".model" line in a SPICE text, saving them to storage; returns how many
    // were imported, with a report in log
    static importModels(lines: string[], log: string[]): number {
        let count = 0;
        for (const line of lines) {
            if (!line.trim().toLowerCase().startsWith(".model"))
                continue;
            try {
                const e = UserModelLibrary.parseModelLine(line, log);
                if (e == null)
                    continue;
                count++;
                UserModelLibrary.store(e);
            } catch (ex) {
                log.push("error in line: " + line);
            }
        }
        if (count > 0) {
            UserModelLibrary.sequenceNumber++;
            CirSim.theApp?.updateModels();
        }
        return count;
    }

    static removeModel(name: string): void {
        const e = UserModelLibrary.entries.get(name);
        UserModelLibrary.entries.delete(name);
        // also take it out of the model lists of the elements
        if (e != null) {
            if (e.model instanceof DiodeModel)
                DiodeModel.modelMap?.delete(name);
            else if (e.model instanceof TransistorModel)
                TransistorModel.modelMap?.delete(name);
            else if (e.model instanceof MosfetModel)
                MosfetModel.modelMap?.delete(name);
        }
        UserModelLibrary.getStorage()?.removeItem(UserModelLibrary.MODEL_PREFIX + name);
        UserModelLibrary.sequenceNumber++;
    }

    // parse a SPICE number: "4.4e-9", "2.52n", "1meg", "4pF" (trailing units are ignored,
    // and M means milli as in SPICE)
    static parseNumber(str: string): number {
        const s = str.toLowerCase();
        const n = s.length;
        let i = 0;
        while (i < n) {
            const c = s.charAt(i);
            if ((c >= '0' && c <= '9') || c === '.' || ((c === '-' || c === '+') && (i === 0 || s.charAt(i - 1) === 'e')))
                i++;
            else if (c === 'e' && i > 0 && i + 1 < n && "0123456789+-".indexOf(s.charAt(i + 1)) >= 0)
                i++;
            else
                break;
        }
        const num = s.substring(0, i);
        if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(num))
            throw new Error("bad number: " + str);
        const v = parseFloat(num);
        const suffix = s.substring(i);
        if (suffix.startsWith("meg"))
            return v * 1e6;
        switch (suffix.charAt(0)) {
            case 'f': return v * 1e-15;
            case 'p': return v * 1e-12;
            case 'n': return v * 1e-9;
            case 'u': return v * 1e-6;
            case 'm': return v * 1e-3;
            case 'k': return v * 1e3;
            case 'g': return v * 1e9;
            case 't': return v * 1e12;
        }
        return v;
    }

    // parse ".model NAME TYPE(PARAM=VALUE ...)" and create/update the matching model
    static parseModelLine(line: string, log: string[]): UserModelEntry | null {
        // make "NAME TYPE ( a = 1 , b=2 )" into "NAME TYPE a=1 b=2"
        const s = line.trim().replace(/[(),]/g, " ").replace(/\s*=\s*/g, "=");
        const tok = s.split(/\s+/);
        if (tok.length < 3 || tok[0].toLowerCase() !== ".model")
            throw new Error("bad model line");
        let name = tok[1];
        const type = tok[2].toLowerCase();
        const params = new Map<string, number>();
        for (let i = 3; i < tok.length; i++) {
            const eq = tok[i].indexOf('=');
            if (eq <= 0)
                continue;
            try {
                params.set(tok[i].substring(0, eq).toLowerCase(), UserModelLibrary.parseNumber(tok[i].substring(eq + 1)));
            } catch (e) {
                log.push(name + ": " + Locale.LS("ignored parameter") + " " + tok[i]);
            }
        }
        const get = (key: string, def: number): number => params.get(key) ?? def;

        const e = new UserModelEntry();
        e.type = type;
        e.line = line.trim();
        e.name = name;

        if (type === "d") {
            DiodeModel.createModelMap();
            if (UserModelLibrary.isBuiltInName(DiodeModel.modelMap, name))
                e.name = name = name + "-spice";
            const dm = DiodeModel.getModelWithName(name);
            dm.flags = 0;
            dm.saturationCurrent = get("is", 1e-14);
            dm.seriesResistance = get("rs", 0);
            dm.emissionCoefficient = get("n", 1);
            dm.breakdownVoltage = get("bv", 0);
            UserModelLibrary.setDiodeCharge(dm, get("cjo", get("cj0", 0)), get("vj", 0.75), get("m", 0.33), get("tt", 0));
            dm.description = "SPICE";
            dm.readOnly = false;
            e.model = dm;
            dm.builtIn = dm.internal = dm.oldStyle = false;
            dm.updateModel();
        } else if (type === "npn" || type === "pnp") {
            TransistorModel.createModelMap();
            if (UserModelLibrary.isBuiltInName(TransistorModel.modelMap, name))
                e.name = name = name + "-spice";
            const tm = TransistorModel.getModelWithName(name);
            tm.description = "SPICE";
            tm.satCur = get("is", 1e-16);
            tm.betaR = get("br", 1);
            tm.emissionCoeffF = get("nf", 1);
            tm.emissionCoeffR = get("nr", 1);
            tm.leakBEemissionCoeff = get("ne", 1.5);
            tm.leakBCemissionCoeff = get("nc", 2);
            tm.BEleakCur = get("ise", 0);
            tm.BCleakCur = get("isc", 0);
            tm.invEarlyVoltF = UserModelLibrary.inverse(get("vaf", get("va", 0)));
            tm.invEarlyVoltR = UserModelLibrary.inverse(get("var", get("vb", 0)));
            tm.invRollOffF = UserModelLibrary.inverse(get("ikf", get("ik", 0)));
            tm.invRollOffR = UserModelLibrary.inverse(get("ikr", 0));
            tm.junctionCapBE = get("cje", 0);
            tm.junctionCapBC = get("cjc", 0);
            tm.junctionPotBE = get("vje", get("pe", 0.75));
            tm.junctionPotBC = get("vjc", get("pc", 0.75));
            tm.junctionExpBE = get("mje", get("me", 0.33));
            tm.junctionExpBC = get("mjc", get("mc", 0.33));
            tm.transitTimeF = get("tf", 0);
            tm.transitTimeR = get("tr", 0);
            tm.readOnly = false;
            e.model = tm;
            tm.builtIn = tm.internal = false;
            tm.updateModel();
            e.beta = get("bf", 100);
            if (params.has("rb") || params.has("rc") || params.has("re"))
                log.push(name + ": " + Locale.LS("RB/RC/RE not supported, ignored"));
        } else if (type === "njf" || type === "pjf" || type === "nmos" || type === "pmos") {
            const jfet = type.endsWith("jf");
            MosfetModel.createModelMap();
            if (UserModelLibrary.isBuiltInName(MosfetModel.modelMap, name))
                e.name = name = name + "-spice";
            const mm = MosfetModel.getModelWithName(name);
            mm.description = "SPICE";
            mm.flags = 0;
            if (jfet) {
                mm.setJfet();
                // SPICE VTO is negative for depletion JFETs of both polarities
                mm.threshold = get("vto", -2);
                // SPICE: Ids = BETA*(Vgs-VTO)^2; here Ids = beta/2*(Vgs-Vt)^2
                mm.beta = 2 * get("beta", 1e-4);
                mm.showBulk = mm.bodyDiode = false;
            } else {
                // level 1 with W/L = 1: beta = KP.  PMOS VTO is given with its real (negative) sign,
                // while the element works with the n-channel equivalent.
                const vto = get("vto", 0);
                mm.threshold = (type === "pmos") ? -vto : vto;
                mm.beta = get("kp", 2e-5);
                mm.showBulk = mm.bodyDiode = true;
            }
            mm.capGS = get("cgs", 0);
            mm.capGD = get("cgd", 0);
            mm.lambda = get("lambda", 0);
            mm.readOnly = false;
            e.model = mm;
            mm.builtIn = mm.internal = mm.oldStyle = false;
        } else {
            log.push(name + ": " + Locale.LS("unsupported model type") + " " + tok[2]);
            return null;
        }
        if (e.name !== tok[1])
            log.push(tok[1] + ": " + Locale.LS("a built-in model has this name, imported as") + " " + e.name);
        log.push(Locale.LS("imported model") + " " + e.name + " (" + tok[2].toUpperCase() + ")");
        UserModelLibrary.entries.set(e.name, e);
        return e;
    }

    // junction capacitance and transit time, for diode models that simulate them
    static setDiodeCharge(dm: DiodeModel, cjo: number, vj: number, m: number, tt: number): void {
        const d = dm as any;
        if (!("junctionCap" in d))
            return;
        d.junctionCap = cjo;
        d.junctionPot = vj;
        d.junctionExp = m;
        d.transitTime = tt;
    }

    static isBuiltInName(map: Map<string, DeviceModel> | null, name: string): boolean {
        const o = map?.get(name);
        return o != null && o.builtIn;
    }

    static inverse(x: number): number {
        return x === 0 ? 0 : 1 / x;
    }

    // called when a model was changed in its edit dialog: if it's one of ours, store the new
    // values (and the new name, if it was renamed)
    static modelEdited(model: DeviceModel): void {
        let e: UserModelEntry | null = null;
        for (const x of UserModelLibrary.entries.values())
            if (x.model === model)
                e = x;
        if (e == null)
            return;
        const stor = UserModelLibrary.getStorage();
        const name = model.name;
        if (name !== e.name) {
            UserModelLibrary.entries.delete(e.name);
            stor?.removeItem(UserModelLibrary.MODEL_PREFIX + e.name);
            e.name = name;
            UserModelLibrary.entries.set(name, e);
        }
        e.line = UserModelLibrary.toSpiceLine(e);
        UserModelLibrary.store(e);
        UserModelLibrary.sequenceNumber++;
    }

    // write a model's current values as a .model line
    static toSpiceLine(e: UserModelEntry): string {
        let s = ".model " + e.name + " " + e.type.toUpperCase() + "(";
        if (e.model instanceof DiodeModel) {
            const dm = e.model;
            s += "IS=" + dm.saturationCurrent + " RS=" + dm.seriesResistance + " N=" + dm.emissionCoefficient +
                " BV=" + dm.breakdownVoltage;
            const d = dm as any;
            if ("junctionCap" in d)
                s += " CJO=" + d.junctionCap + " VJ=" + d.junctionPot + " M=" + d.junctionExp + " TT=" + d.transitTime;
        } else if (e.model instanceof TransistorModel) {
            const tm = e.model;
            const inv = UserModelLibrary.inverse;
            s += "IS=" + tm.satCur + " BF=" + e.beta + " BR=" + tm.betaR + " NF=" + tm.emissionCoeffF +
                " NR=" + tm.emissionCoeffR + " NE=" + tm.leakBEemissionCoeff + " NC=" + tm.leakBCemissionCoeff +
                " ISE=" + tm.BEleakCur + " ISC=" + tm.BCleakCur + " VAF=" + inv(tm.invEarlyVoltF) +
                " VAR=" + inv(tm.invEarlyVoltR) + " IKF=" + inv(tm.invRollOffF) + " IKR=" + inv(tm.invRollOffR) +
                " CJE=" + tm.junctionCapBE + " CJC=" + tm.junctionCapBC + " VJE=" + tm.junctionPotBE +
                " VJC=" + tm.junctionPotBC + " MJE=" + tm.junctionExpBE + " MJC=" + tm.junctionExpBC +
                " TF=" + tm.transitTimeF + " TR=" + tm.transitTimeR;
        } else {
            const mm = e.model;
            if (mm.isJfet())
                s += "VTO=" + mm.threshold + " BETA=" + mm.beta / 2;
            else
                s += "VTO=" + (e.type === "pmos" ? -mm.threshold : mm.threshold) + " KP=" + mm.beta;
            s += " LAMBDA=" + mm.lambda + " CGS=" + mm.capGS + " CGD=" + mm.capGD;
        }
        return s + ")";
    }

    // menu category of a subcircuit
    static getCategory(subcircuit: string): string {
        const c = UserModelLibrary.getStorage()?.getItem(UserModelLibrary.CATEGORY_PREFIX + subcircuit) ?? null;
        return c == null ? UserModelLibrary.getDefaultCategory(subcircuit) : c;
    }

    // subcircuits drawn with a component symbol go with that component by default
    static getDefaultCategory(subcircuit: string): string {
        const m = SubcircuitModel.getModelWithName(subcircuit);
        return SubcircuitSymbols.getDefaultCategory(m == null ? null : m.symbol);
    }

    static setCategory(subcircuit: string, category: string | null): void {
        const stor = UserModelLibrary.getStorage();
        if (stor == null)
            return;
        if (category == null || category === UserModelLibrary.getDefaultCategory(subcircuit))
            stor.removeItem(UserModelLibrary.CATEGORY_PREFIX + subcircuit);
        else
            stor.setItem(UserModelLibrary.CATEGORY_PREFIX + subcircuit, category);
        UserModelLibrary.sequenceNumber++;
    }

    static removeCategory(subcircuit: string): void {
        UserModelLibrary.getStorage()?.removeItem(UserModelLibrary.CATEGORY_PREFIX + subcircuit);
        UserModelLibrary.sequenceNumber++;
    }

    static renameCategory(oldName: string, newName: string): void {
        const stor = UserModelLibrary.getStorage();
        if (stor == null)
            return;
        const c = stor.getItem(UserModelLibrary.CATEGORY_PREFIX + oldName);
        stor.removeItem(UserModelLibrary.CATEGORY_PREFIX + oldName);
        if (c != null)
            stor.setItem(UserModelLibrary.CATEGORY_PREFIX + newName, c);
        UserModelLibrary.sequenceNumber++;
    }

    static getCategoryLabel(i: number): string {
        // the translations of the menu headings have the old GWT markup in their keys
        const s = UserModelLibrary.categoryLabels[i];
        const t = Locale.LS(s);
        return (t !== s) ? t : Locale.LS("&nbsp;</div>" + s).replace(/&nbsp;<\/div>/gi, "");
    }
}

HookRegistry.getSubcircuitInternalModelNames = () => UserModelLibrary.getSubcircuitInternalModelNames();
