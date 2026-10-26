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
import { Dialog } from "./Dialog";
import { DiodeModel } from "./DiodeModel";
import { ExportAsLocalFileDialog } from "./ExportAsLocalFileDialog";
import { EditDiodeModelDialog } from "./EditDiodeModelDialog";
import { EditMosfetModelDialog } from "./EditMosfetModelDialog";
import { EditSubcircuitModelDialog } from "./EditSubcircuitModelDialog";
import { EditTransistorModelDialog } from "./EditTransistorModelDialog";
import { ImportFromSpiceDialog } from "./ImportFromSpiceDialog";
import { SpiceModelDatabase } from "./SpiceModelDatabase";
import { Locale } from "./Locale";
import { MosfetModel } from "./MosfetModel";
import { SubcircuitElm } from "./SubcircuitElm";
import { SubcircuitModel } from "./SubcircuitModel";
import { SubcircuitSymbols } from "./SubcircuitSymbols";
import { TransistorModel } from "./TransistorModel";
import { UserModelEntry, UserModelLibrary } from "./UserModelLibrary";

// lists the imported models (subcircuits and SPICE .model lines) by kind of component,
// with buttons to edit, rename or delete each one

export class ModelManagerDialog extends Dialog {

    // kinds of component the models are grouped by
    static readonly groupLabels = ["Op-amps", "Diodes", "Bipolar transistors", "JFETs", "MOSFETs", "Subcircuits"];
    static readonly GROUP_OPAMP = 0;
    static readonly GROUP_DIODE = 1;
    static readonly GROUP_BJT = 2;
    static readonly GROUP_JFET = 3;
    static readonly GROUP_MOSFET = 4;
    static readonly GROUP_SUBCIRCUIT = 5;

    private table: HTMLTableElement;
    private refreshTimer: ReturnType<typeof setInterval>;
    private lastSeq1: number = -1;
    private lastSeq2: number = -1;

    static open(): void {
        new ModelManagerDialog().show();
    }

    constructor() {
        super();
        this.closeOnEnter = true;

        const title = document.createElement("div");
        title.textContent = Locale.LS("Imported Models");
        title.style.fontWeight = "bold";
        title.style.marginBottom = "6px";
        this.dialogEl.appendChild(title);

        const sp = document.createElement("div");
        sp.style.height = "400px";
        sp.style.width = "560px";
        sp.style.maxWidth = "80vw";
        sp.style.overflow = "auto";
        this.table = document.createElement("table");
        this.table.style.borderSpacing = "2px";
        sp.appendChild(this.table);
        this.dialogEl.appendChild(sp);

        const hp = document.createElement("div");
        hp.style.display = "flex";
        hp.style.gap = "8px";
        hp.style.marginTop = "8px";
        const addButton = (label: string, handler: () => void) => {
            const b = document.createElement("button");
            b.textContent = Locale.LS(label);
            b.addEventListener("click", handler);
            hp.appendChild(b);
        };
        addButton("Import from SPICE...", () => new ImportFromSpiceDialog());
        addButton("Export Database...", () => this.exportDatabase());
        addButton("Import Database...", () => this.importDatabase());
        addButton("Close", () => this.closeDialog());
        this.dialogEl.appendChild(hp);

        this.refresh();
        // the list changes when a model is edited, renamed, deleted or imported in another dialog
        this.refreshTimer = setInterval(() => {
            if (this.lastSeq1 !== SubcircuitModel.sequenceNumber || this.lastSeq2 !== UserModelLibrary.sequenceNumber)
                this.refresh();
        }, 500);
    }

    // all the imported models in a JSON file
    private exportDatabase(): void {
        new ExportAsLocalFileDialog(SpiceModelDatabase.toJson(), "spice-models.json", "Export Database").show();
    }

    private importDatabase(): void {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json,text/plain";
        input.addEventListener("change", () => {
            const f = input.files?.[0];
            if (f == null)
                return;
            f.text().then(text => {
                const log: string[] = [];
                const n = SpiceModelDatabase.fromJson(text, log);
                CirSim.theApp.updateModels();
                CirSim.theApp.needAnalyze();
                this.refresh();
                CirSim.theApp.ui.showToast(Locale.LS("Imported models") + ": " + n.devices + ", " +
                    Locale.LS("Subcircuits").toLowerCase() + ": " + n.subcircuits);
                if (log.length > 0)
                    window.alert(log.join("\n"));
            });
        });
        input.click();
    }

    closeDialog(): void {
        clearInterval(this.refreshTimer);
        super.closeDialog();
    }

    static getSubcircuitGroup(m: SubcircuitModel): number {
        const s = m.symbol;
        if (s == null)
            return ModelManagerDialog.GROUP_SUBCIRCUIT;
        if (s === SubcircuitSymbols.SYM_OPAMP)
            return ModelManagerDialog.GROUP_OPAMP;
        if (SubcircuitSymbols.isDiode(s))
            return ModelManagerDialog.GROUP_DIODE;
        if (SubcircuitSymbols.isBjt(s))
            return ModelManagerDialog.GROUP_BJT;
        if (SubcircuitSymbols.isJfet(s))
            return ModelManagerDialog.GROUP_JFET;
        return ModelManagerDialog.GROUP_MOSFET;
    }

    static getEntryGroup(e: UserModelEntry): number {
        if (e.type === "d")
            return ModelManagerDialog.GROUP_DIODE;
        if (e.type === "npn" || e.type === "pnp")
            return ModelManagerDialog.GROUP_BJT;
        if (e.type.endsWith("jf"))
            return ModelManagerDialog.GROUP_JFET;
        return ModelManagerDialog.GROUP_MOSFET;
    }

    // models the user created or imported (not the built-in ones)
    static getSubcircuits(): SubcircuitModel[] {
        return SubcircuitModel.getModelList().filter(m => !m.builtin && !m.internal);
    }

    private refresh(): void {
        this.lastSeq1 = SubcircuitModel.sequenceNumber;
        this.lastSeq2 = UserModelLibrary.sequenceNumber;
        this.table.innerHTML = "";
        const subs = ModelManagerDialog.getSubcircuits();
        const entries = UserModelLibrary.getEntries();
        let rows = 0;
        for (let g = 0; g !== ModelManagerDialog.groupLabels.length; g++) {
            let header = false;
            const addHeader = () => {
                if (header)
                    return;
                header = true;
                const td = this.addRow().insertCell();
                td.colSpan = 4;
                td.textContent = Locale.LS(ModelManagerDialog.groupLabels[g]);
                td.style.fontWeight = "bold";
                if (rows > 0)
                    td.style.paddingTop = "10px";
                rows++;
            };
            for (const m of subs) {
                if (ModelManagerDialog.getSubcircuitGroup(m) !== g)
                    continue;
                addHeader();
                this.addSubcircuitRow(m);
                rows++;
            }
            for (const e of entries) {
                if (ModelManagerDialog.getEntryGroup(e) !== g)
                    continue;
                addHeader();
                this.addModelRow(e);
                rows++;
            }
        }
        if (rows === 0)
            this.addRow().insertCell().textContent = Locale.LS("No imported models.");
    }

    private addRow(): HTMLTableRowElement {
        return this.table.insertRow();
    }

    private addCell(row: HTMLTableRowElement, text: string): HTMLTableCellElement {
        const td = row.insertCell();
        td.textContent = text;
        td.style.padding = "3px";
        return td;
    }

    private addButtons(row: HTMLTableRowElement, buttons: [string, () => void][]): void {
        const td = row.insertCell();
        td.style.whiteSpace = "nowrap";
        for (const [label, handler] of buttons) {
            const b = document.createElement("button");
            b.textContent = Locale.LS(label);
            b.addEventListener("click", handler);
            td.appendChild(b);
        }
    }

    // where a subcircuit is kept
    static getScopeText(m: SubcircuitModel): string {
        if (m.isSaved())
            return Locale.LS("Saved");
        if (SubcircuitModel.globalModelMap.get(m.name) === m)
            return Locale.LS("This Session");
        return Locale.LS("This Circuit");
    }

    private addSubcircuitRow(m: SubcircuitModel): void {
        const row = this.addRow();
        this.addCell(row, m.name);
        let kind = Locale.LS("Subcircuit");
        if (m.symbol != null)
            kind += " (" + Locale.LS(SubcircuitSymbols.symbolLabels[SubcircuitSymbols.getSymbolIndex(m.symbol)]) + ")";
        this.addCell(row, kind);
        this.addCell(row, ModelManagerDialog.getScopeText(m));
        this.addButtons(row, [
            ["Modify", () => {
                const dlg = new EditSubcircuitModelDialog();
                dlg.setModel(m);
                dlg.createDialog();
            }],
            ["Rename", () => this.askNewName(m)],
            ["Delete", () => {
                if (!window.confirm(Locale.LS("Delete model") + " " + m.name + "?"))
                    return;
                m.remove();
                UserModelLibrary.removeCategory(m.name);
                CirSim.theApp.updateModels();
                CirSim.theApp.needAnalyze();
                this.refresh();
            }],
        ]);
    }

    private addModelRow(e: UserModelEntry): void {
        const row = this.addRow();
        this.addCell(row, e.name);
        this.addCell(row, ".model " + e.type.toUpperCase());
        this.addCell(row, Locale.LS("Saved"));
        this.addButtons(row, [
            ["Modify", () => {
                const app = CirSim.theApp;
                if (e.model instanceof DiodeModel) {
                    if (e.model.isSimple())
                        e.model.setForwardVoltage();
                    CirSim.diodeModelEditDialog = new EditDiodeModelDialog(e.model, app, null);
                    CirSim.diodeModelEditDialog.show();
                } else if (e.model instanceof TransistorModel) {
                    CirSim.diodeModelEditDialog = new EditTransistorModelDialog(e.model, app, null);
                    CirSim.diodeModelEditDialog.show();
                } else if (e.model instanceof MosfetModel) {
                    CirSim.mosfetModelEditDialog = new EditMosfetModelDialog(e.model, app, null);
                    CirSim.mosfetModelEditDialog.show();
                }
            }],
            ["Delete", () => {
                if (!window.confirm(Locale.LS("Delete model") + " " + e.name + "?"))
                    return;
                UserModelLibrary.removeModel(e.name);
                this.refresh();
            }],
        ]);
    }

    // asks for the new name in a dialog of our own: window.prompt() doesn't exist in Electron
    private askNewName(m: SubcircuitModel): void {
        const box = document.createElement("input");
        box.type = "text";
        box.value = m.name;
        box.style.width = "250px";
        box.style.display = "block";
        const self = this;
        const dlg = new (class extends Dialog {
            constructor() {
                super();
                this.dialogEl.appendChild(Object.assign(document.createElement("div"),
                    { textContent: Locale.LS("Rename"), style: "font-weight: bold; margin-bottom: 6px" }));
                this.dialogEl.appendChild(Object.assign(document.createElement("div"),
                    { textContent: Locale.LS("New name for") + " " + m.name }));
                this.dialogEl.appendChild(box);
                const hp = document.createElement("div");
                hp.style.display = "flex";
                hp.style.gap = "8px";
                hp.style.marginTop = "8px";
                const ok = document.createElement("button");
                ok.textContent = Locale.LS("OK");
                ok.addEventListener("click", () => this.enterPressed());
                const cancel = document.createElement("button");
                cancel.textContent = Locale.LS("Cancel");
                cancel.addEventListener("click", () => this.closeDialog());
                hp.appendChild(ok);
                hp.appendChild(cancel);
                this.dialogEl.appendChild(hp);
            }
            apply(): boolean { return self.renameSubcircuit(m, box.value); }
        })();
        dlg.show();
        box.focus();
        box.select();
    }

    // false if the name can't be used (the dialog then stays open)
    renameSubcircuit(m: SubcircuitModel, newName: string): boolean {
        newName = newName.trim();
        if (newName.length === 0 || newName === m.name)
            return true;
        if (SubcircuitModel.getModelWithName(newName) != null) {
            window.alert(Locale.LS("A model with this name already exists."));
            return false;
        }
        const oldName = m.name;
        const saved = m.isSaved();
        // a circuit's copy of a saved model hides the saved one: renaming it renames the saved model
        const shadowed = SubcircuitModel.globalModelMap.get(oldName);
        if (saved && shadowed != null && shadowed !== m)
            SubcircuitModel.globalModelMap.delete(oldName);
        if (saved)
            m.setSaved(false);
        m.setName(newName);
        if (saved)
            m.setSaved(true);
        UserModelLibrary.renameCategory(oldName, newName);

        // keep the elements using it
        for (const ce of CirSim.theApp.elmList as any[]) {
            if (ce.isSubcircuitElm() && ce.modelName === oldName)
                ce.modelName = newName;
            if (ce.getSubcircuitModelName?.() === oldName) {
                if ("subcircuitName" in ce)
                    ce.subcircuitName = newName;
                else
                    ce.modelName = newName;
            }
        }
        if (SubcircuitElm.lastModelName === oldName)
            SubcircuitElm.lastModelName = newName;
        CirSim.theApp.updateModels();
        CirSim.theApp.needAnalyze();
        this.refresh();
        return true;
    }
}

(window as any).ModelManagerDialog = ModelManagerDialog;
