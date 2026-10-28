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
import { Locale } from "./Locale";
import { SpiceModelBuilder } from "./SpiceModelBuilder";
import { SubcircuitModel } from "./SubcircuitModel";
import { UserModelLibrary } from "./UserModelLibrary";

// Exports the database of the imported SPICE models (device models and subcircuits) to a
// readable JSON file, and imports such a file back.  Subcircuits are written with their SPICE
// text (one line per array item) and the layout of their pins, so the file can be edited
// by hand or shared; they are rebuilt from the text when it is imported.

interface PinJson { name: string; node: number; pos: number; side: number }
interface SubcircuitJson {
    name: string;
    scope: string;            // circuit, session or saved
    menu?: string;
    symbol?: string;
    symbolNodes?: number[];
    showLabel?: boolean;
    size?: [number, number];
    pins?: PinJson[];
    spice: string[] | string;
}
interface DatabaseJson {
    format: string;
    version: number;
    deviceModels: { name: string; type: string; line: string }[];
    subcircuits: SubcircuitJson[];
}

export class SpiceModelDatabase {
    static readonly FORMAT = "circuitjs-spice-models";
    static readonly SCOPES = ["circuit", "session", "saved"];

    // subcircuits imported from SPICE: the ones that still have their text
    static getSubcircuits(): SubcircuitModel[] {
        return SubcircuitModel.getModelList().filter(m => !m.builtin && !m.internal && m.spiceText != null);
    }

    static toJson(): string {
        const db: DatabaseJson = { format: SpiceModelDatabase.FORMAT, version: 1, deviceModels: [], subcircuits: [] };
        for (const e of UserModelLibrary.getEntries())
            db.deviceModels.push({ name: e.name, type: e.type, line: e.line });
        for (const m of SpiceModelDatabase.getSubcircuits()) {
            const s: SubcircuitJson = {
                name: m.name,
                scope: SpiceModelDatabase.SCOPES[["local", "global", "persistent"].indexOf(m.getScope())],
                menu: UserModelLibrary.getCategory(m.name),
                spice: [],
            };
            if (m.symbol != null && m.symbolNodes != null) {
                s.symbol = m.symbol;
                s.symbolNodes = m.symbolNodes;
            }
            s.showLabel = m.showLabel();
            s.size = [m.sizeX, m.sizeY];
            s.pins = m.extList.map(p => ({ name: p.name, node: p.node, pos: p.pos, side: p.side }));
            s.spice = m.spiceText!.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
            db.subcircuits.push(s);
        }
        return JSON.stringify(db, null, 2) + "\n";
    }

    // imports a file written by toJson(); models with the same name are replaced.  Returns the
    // number of device models and subcircuits imported, and the problems found in log.
    static fromJson(text: string, log: string[]): { devices: number; subcircuits: number } {
        let db: DatabaseJson;
        try {
            db = JSON.parse(text);
        } catch (e) {
            log.push(Locale.LS("The file is not valid JSON."));
            return { devices: 0, subcircuits: 0 };
        }
        if (db == null || db.format !== SpiceModelDatabase.FORMAT) {
            log.push(Locale.LS("The file is not a SPICE model database."));
            return { devices: 0, subcircuits: 0 };
        }
        const lines = (db.deviceModels ?? []).map(d => d.line).filter(l => typeof l === "string");
        const devices = UserModelLibrary.importModels(lines, log);
        let subcircuits = 0;
        for (const s of db.subcircuits ?? []) {
            try {
                if (SpiceModelDatabase.importSubcircuit(s, log))
                    subcircuits++;
            } catch (e) {
                log.push(s.name + ": " + ((e instanceof Error) ? e.message : String(e)));
            }
        }
        return { devices, subcircuits };
    }

    private static importSubcircuit(s: SubcircuitJson, log: string[]): boolean {
        if (typeof s.name !== "string" || s.name === "" || s.spice == null) {
            log.push(Locale.LS("Subcircuit without a name or SPICE text, skipped."));
            return false;
        }
        const spice = Array.isArray(s.spice) ? s.spice.join("\n") + "\n" : String(s.spice);
        const built = SpiceModelBuilder.build(spice, () => {});
        if (built == null) {
            log.push(s.name + ": " + Locale.LS("can't convert the SPICE text."));
            return false;
        }
        const m = built.model;
        m.name = s.name;
        // pins keep their places when the file has them for every pin
        const pins = Array.isArray(s.pins) ? s.pins : [];
        let placed = 0;
        for (const e of m.extList) {
            const p = pins.find(x => x.name === e.name);
            if (p != null && Number.isFinite(p.pos) && Number.isFinite(p.side)) {
                e.pos = p.pos;
                e.side = p.side;
                placed++;
            }
        }
        if (placed === m.extList.length && s.size != null && s.size[0] > 0 && s.size[1] > 0) {
            m.sizeX = s.size[0];
            m.sizeY = s.size[1];
        } else {
            // west side, one pin below the other
            m.extList.forEach((e, i) => { e.pos = i; e.side = 2; });
            m.sizeX = 2;
            m.sizeY = Math.max(1, m.extList.length);
        }
        if (s.symbol != null && s.symbolNodes != null && s.symbolNodes.every(n => n >= 1 && n <= m.extList.length)) {
            m.symbol = s.symbol;
            m.symbolNodes = s.symbolNodes;
        }
        m.setShowLabel(s.showLabel === true);

        // replace a model with the same name, and put it in its scope as the edit dialog does
        // (the saved copy goes too: saved models are found by name)
        m.setSaved(false);
        SubcircuitModel.localModelMap.delete(s.name);
        SubcircuitModel.globalModelMap.delete(s.name);
        const scope = SpiceModelDatabase.SCOPES.indexOf(s.scope);
        if (scope === 0)
            SubcircuitModel.localModelMap.set(s.name, m);
        else if (scope === 2)
            m.setSaved(true);
        else
            SubcircuitModel.globalModelMap.set(s.name, m);
        SubcircuitModel.sequenceNumber++;
        if (typeof s.menu === "string" && UserModelLibrary.categoryKeys.indexOf(s.menu) >= 0)
            UserModelLibrary.setCategory(s.name, s.menu);
        CirSim.theApp.refreshModels(s.name);
        return true;
    }
}
