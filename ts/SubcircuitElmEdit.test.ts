import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CircuitElm } from "./CircuitElm";
import { CirSim } from "./CirSim";
import { EditInfo } from "./EditInfo";
import { SubcircuitElm } from "./SubcircuitElm";
import { SubcircuitModel } from "./SubcircuitModel";

// The edit dialog of a subcircuit, without a DOM: the element is made from the prototype
// with just the fields the dialog reads.

function model(name: string): SubcircuitModel {
    const m = new SubcircuitModel();
    m.name = name;
    return m;
}

function elm(m: SubcircuitModel, viewable: boolean): any {
    const e: any = Object.create(SubcircuitElm.prototype);
    e.model = m;
    e.modelName = m.name;
    e.highVoltage = 0;
    e.models = [];
    e.canViewComponents = () => viewable;
    e.propagateHighVoltage = () => {};
    e.buildDisplayElmList = (): any[] => [];
    return e;
}

describe("subcircuit edit dialog", () => {
    let pushed: any[];
    let savedApp: any;
    let savedDialog: any;

    beforeEach(() => {
        pushed = [];
        // (the built-in subcircuits need a DOM)
        (SubcircuitModel.registry as any).initialized = true;
        savedApp = (CircuitElm as any).app;
        savedDialog = (CirSim as any).editDialog;
        (CircuitElm as any).app = { ui: { pushSubcircuit: (cce: any) => pushed.push(cce) } };
        (CirSim as any).editDialog = { closeDialog: () => {} };
        SubcircuitModel.registry.clearLocal();
        SubcircuitModel.registry.globalMap.clear();
    });

    afterEach(() => {
        (CircuitElm as any).app = savedApp;
        (CirSim as any).editDialog = savedDialog;
        SubcircuitModel.registry.clearLocal();
        SubcircuitModel.registry.globalMap.clear();
    });

    it("applying the high logic voltage doesn't open the components view", () => {
        const e = elm(model("A"), false);
        const ei = e.getEditInfo(2) as EditInfo;
        expect(ei.name).toContain("High Logic Voltage");
        ei.value = 3.3;
        e.setEditValue(2, ei);
        expect(pushed).toEqual([]);
        expect(e.highVoltage).toBe(3.3);
    });

    it("the View Components button still opens the view, only once", () => {
        const e = elm(model("A"), true);
        e.setEditValue(2, e.getEditInfo(2));
        expect(pushed).toEqual([e]);
    });

    it("selects the model by name when the element holds a replaced copy", () => {
        SubcircuitModel.registry.setLocal(model("AAA"));
        SubcircuitModel.registry.setLocal(model("TLV"));
        const e = elm(model("TLV"), false);
        const ei = e.getEditInfo(0) as EditInfo;
        expect(ei.choice!.items[ei.choice!.getSelectedIndex()]).toBe("TLV");
    });

    it("lists the model when it isn't in the list at all", () => {
        SubcircuitModel.registry.setLocal(model("AAA"));
        const e = elm(model("ZZZ"), false);
        const ei = e.getEditInfo(0) as EditInfo;
        expect(ei.choice!.items[ei.choice!.getSelectedIndex()]).toBe("ZZZ");
    });
});
