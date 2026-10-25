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

import { DiodeModel } from "./DiodeModel";
import { MosfetModel } from "./MosfetModel";
import { SpiceImport, type SpiceSubcircuit } from "./SpiceImport";
import { SubcircuitModel } from "./SubcircuitModel";
import { TransistorModel } from "./TransistorModel";

// builds the subcircuit model of a SPICE .subckt (no UI: see ImportFromSpiceDialog, which
// asks what to draw, and EditSubcircuitModelDialog, which edits the SPICE text afterwards)

export class SpiceModelBuilder {
    // null (with the reason logged) if the text can't be converted
    static build(text: string, log: (s: string) => void): { model: SubcircuitModel; sub: SpiceSubcircuit } | null {
        const sub = new SpiceImport(log).parse(text);
        if (sub == null)
            return null;

        // the device models of the elements are written into the subcircuit's definition (so
        // it works in other sessions and circuits), unless already marked as written
        DiodeModel.clearDumpedFlags();
        TransistorModel.clearDumpedFlags();
        MosfetModel.clearDumpedFlags();
        const model = new SubcircuitModel();
        model.extList = sub.extList;
        model.convertOldFormatToXml(sub.elmDump, sub.dump);
        SpiceModelBuilder.nameJfetModels(model, sub.name);
        model.spiceText = text;
        return { model, sub };
    }

    // the JFETs get their model from old-style parameters, under a generic name ("old-jfet-2")
    // that other circuits may use for other values: name those models after the subcircuit
    private static nameJfetModels(ccm: SubcircuitModel, prefix: string): void {
        const root = ccm.elmDoc!.documentElement;
        const renamed = new Map<string, string>();
        for (const child of Array.from(root.children)) {
            const mo = child.getAttribute("mo");
            const m = (mo == null || child.tagName === "mm") ? null : MosfetModel.modelMap?.get(mo);
            if (m == null || !m.oldStyle || !m.isJfet())
                continue;
            let name = renamed.get(mo!);
            if (name == null) {
                name = prefix + "-jfet" + (renamed.size + 1);
                const nm = MosfetModel.getModelWithNameOrCopy(name, m, true);
                nm.flags = m.flags;
                nm.threshold = m.threshold;
                nm.beta = m.beta;
                nm.showBulk = nm.bodyDiode = false;
                nm.oldStyle = false;
                renamed.set(mo!, name);
            }
            child.setAttribute("mo", name);
        }
        // and the model definitions written with the elements
        for (const child of Array.from(root.children)) {
            const nm = child.getAttribute("nm");
            if (child.tagName === "mm" && nm != null && renamed.has(nm))
                child.setAttribute("nm", renamed.get(nm)!);
        }
    }
}
