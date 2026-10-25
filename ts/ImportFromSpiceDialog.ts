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

import { Dialog } from "./Dialog";
import { EditSubcircuitModelDialog } from "./EditSubcircuitModelDialog";
import { Locale } from "./Locale";
import { SpiceHeader, SpiceImport } from "./SpiceImport";
import { SpiceModelBuilder } from "./SpiceModelBuilder";
import { SubcircuitModel } from "./SubcircuitModel";
import { SubcircuitSymbols } from "./SubcircuitSymbols";
import { UserModelLibrary } from "./UserModelLibrary";

// imports a SPICE .subckt as a subcircuit (drawn as a chip, or as the component chosen
// in the list, with its pins connected to the chosen nodes), or .model lines into the
// model library

export class ImportFromSpiceDialog extends Dialog {
    private textArea: HTMLTextAreaElement;
    private outputArea: HTMLTextAreaElement;
    // component type to create: Subcircuit, or one of SubcircuitSymbols.symbolKeys
    private typeList: HTMLSelectElement;
    private pinPanel: HTMLDivElement;
    // subcircuit node connected to each pin of the chosen symbol
    private pinLists: HTMLSelectElement[] | null = null;
    private header: SpiceHeader = new SpiceHeader();
    private lastSignature: string = "";

    constructor() {
        super();
        // Enter adds lines to the text
        this.closeOnEnter = false;
        this.dialogEl.style.width = "330px";

        const title = document.createElement("div");
        title.textContent = Locale.LS("Import Subcircuit from Spice");
        title.style.fontWeight = "bold";
        title.style.marginBottom = "6px";
        this.dialogEl.appendChild(title);

        const addLabel = (parent: HTMLElement, text: string) => {
            const d = document.createElement("div");
            d.textContent = Locale.LS(text);
            parent.appendChild(d);
            return d;
        };
        addLabel(this.dialogEl, "Paste the text file for your subcircuit here...");
        addLabel(this.dialogEl, "or .model lines (diodes, BJTs, JFETs, MOSFETs) to add them to the model lists");

        const makeArea = (h: string) => {
            const ta = document.createElement("textarea");
            ta.spellcheck = false;
            ta.style.width = "100%";
            ta.style.height = h;
            ta.style.boxSizing = "border-box";
            ta.style.display = "block";
            ta.style.marginTop = "4px";
            this.dialogEl.appendChild(ta);
            return ta;
        };
        this.textArea = makeArea("200px");
        this.textArea.wrap = "off";
        this.textArea.addEventListener("input", () => this.analyzeText());
        this.outputArea = makeArea("100px");
        this.outputArea.readOnly = true;

        const tp = document.createElement("div");
        tp.style.display = "flex";
        tp.style.alignItems = "center";
        tp.style.gap = "8px";
        tp.style.marginTop = "6px";
        tp.appendChild(Object.assign(document.createElement("span"), { textContent: Locale.LS("Component type:") }));
        this.typeList = document.createElement("select");
        this.typeList.appendChild(Object.assign(document.createElement("option"), { textContent: Locale.LS("Subcircuit") }));
        for (const s of SubcircuitSymbols.symbolLabels)
            this.typeList.appendChild(Object.assign(document.createElement("option"), { textContent: Locale.LS(s) }));
        this.typeList.addEventListener("change", () => this.buildPinPanel());
        tp.appendChild(this.typeList);
        this.dialogEl.appendChild(tp);
        this.pinPanel = document.createElement("div");
        this.dialogEl.appendChild(this.pinPanel);

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
        addButton("OK", () => this.parseCircuit());
        addButton("Cancel", () => this.closeDialog());
        // imported models can be edited or deleted in the model manager
        addButton("Imported Models...", () => (window as any).ModelManagerDialog?.open());
        this.dialogEl.appendChild(hp);

        this.show();
        this.textArea.focus();
    }

    // look at the .subckt line and the comments to guess the component type and its pins
    private analyzeText(): void {
        this.header = SpiceImport.analyzeHeader(this.textArea.value);
        const h = this.header;
        if (!h.found) {
            this.lastSignature = "";
            this.typeList.selectedIndex = 0;
            this.buildPinPanel();
            return;
        }
        // only guess again when the header changes, so we don't undo the user's choices
        const sig = h.text + "|" + h.nodes.join(",") + "|" + h.descs.join(",");
        if (sig === this.lastSignature)
            return;
        this.lastSignature = sig;
        this.typeList.selectedIndex = SubcircuitSymbols.getSymbolIndex(SpiceImport.guessSymbol(h)) + 1;
        this.buildPinPanel();
    }

    private getSelectedSymbol(): string | null {
        const i = this.typeList.selectedIndex;
        return (i <= 0) ? null : SubcircuitSymbols.symbolKeys[i - 1];
    }

    // one list of subcircuit nodes for each pin of the chosen symbol, with a guess selected
    private buildPinPanel(): void {
        this.pinPanel.innerHTML = "";
        this.pinLists = null;
        const sym = this.getSelectedSymbol();
        if (sym == null)
            return;
        const h = this.header;
        const pins = SubcircuitSymbols.symbolPins[SubcircuitSymbols.getSymbolIndex(sym)];
        const nodeForPin = SpiceImport.guessPinNodes(h, sym);
        if (nodeForPin == null) {
            this.pinPanel.textContent = Locale.LS("The subcircuit has too few nodes for this component.");
            return;
        }

        this.pinPanel.appendChild(Object.assign(document.createElement("div"),
            { textContent: Locale.LS("Subcircuit node for each pin:") }));
        this.pinLists = [];
        for (let p = 0; p !== pins.length; p++) {
            const row = document.createElement("div");
            row.style.display = "flex";
            row.style.alignItems = "center";
            row.style.marginTop = "2px";
            const l = document.createElement("span");
            l.textContent = Locale.LS(pins[p]);
            l.style.width = "170px";
            l.style.flex = "none";
            row.appendChild(l);
            const lb = document.createElement("select");
            for (let i = 0; i !== h.nodes.length; i++) {
                const d = h.descs[i];
                const n = h.nodes[i];
                const opt = document.createElement("option");
                opt.textContent = (d === n) ? n : n + " (" + d + ")";
                opt.value = String(i + 1);
                lb.appendChild(opt);
            }
            lb.selectedIndex = nodeForPin[p];
            row.appendChild(lb);
            this.pinLists.push(lb);
            this.pinPanel.appendChild(row);
        }
    }

    private output(str: string): void {
        this.outputArea.value += str + "\n";
    }

    private parseCircuit(): void {
        const text = this.textArea.value;
        const lines = SpiceImport.getLines(text);
        this.outputArea.value = "";

        // only .model lines: add them to the library (and the menus) instead of making a subcircuit
        if (SpiceImport.isModelLibrary(lines)) {
            const log: string[] = [];
            const n = UserModelLibrary.importModels(lines, log);
            for (const s of log)
                this.output(s);
            if (n > 0)
                this.output(Locale.LS("Done. Choose the model in the component's edit dialog (eg Draw > Diode, then Edit)."));
            return;
        }

        const built = SpiceModelBuilder.build(text, s => this.output(s));
        if (built == null)
            return;
        const { model: ccm, sub } = built;

        // draw it as the chosen component, with its pins connected to the chosen nodes
        const sym = this.getSelectedSymbol();
        if (sym != null) {
            if (this.pinLists == null) {
                this.output(Locale.LS("The subcircuit has too few nodes for this component."));
                return;
            }
            const symNodes: number[] = [];
            for (let i = 0; i !== this.pinLists.length; i++) {
                symNodes.push(parseInt(this.pinLists[i].value));
                if (symNodes[i] > sub.extList.length) {
                    this.output(Locale.LS("The pins don't match the subcircuit nodes."));
                    return;
                }
                for (let j = 0; j !== i; j++)
                    if (symNodes[j] === symNodes[i]) {
                        this.output(Locale.LS("Two pins are connected to the same node."));
                        return;
                    }
            }
            if (sub.extList.length > symNodes.length)
                this.output(Locale.LS("Nodes not connected to a pin are left unconnected."));
            ccm.symbol = sym;
            ccm.symbolNodes = symNodes;
        }

        const dlg = new EditSubcircuitModelDialog();
        dlg.defaultName = sub.displayName;
        if (!dlg.loadModel(ccm))
            return;
        this.closeDialog();
        dlg.createDialog();
    }
}

(window as any).ImportFromSpiceDialog = ImportFromSpiceDialog;
