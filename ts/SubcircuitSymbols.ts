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

// symbols a subcircuit (eg imported from a SPICE .subckt) can be drawn with instead of a
// chip box: op-amp subcircuits become models of OpAmpRealElm, the others are drawn by
// SubcircuitSymbolElm.  Kept apart from those elements so the SPICE import needs no UI code.

export class SubcircuitSymbols {
    static readonly SYM_OPAMP = "opamp";
    // pins are listed in post order
    static readonly symbolKeys = [SubcircuitSymbols.SYM_OPAMP, "diode", "npn", "pnp", "nmos", "pmos"];
    static readonly symbolLabels = [
        "Op-amp", "Diode", "Transistor (bipolar, NPN)", "Transistor (bipolar, PNP)",
        "MOSFET (N-Channel)", "MOSFET (P-Channel)",
    ];
    static readonly symbolPins: string[][] = [
        ["inverting input (-)", "non-inverting input (+)", "output (out)", "positive supply (V+)", "negative supply (V-)"],
        ["anode (A)", "cathode (K)"],
        ["base (B)", "collector (C)", "emitter (E)"],
        ["base (B)", "collector (C)", "emitter (E)"],
        ["gate (G)", "source (S)", "drain (D)"],
        ["gate (G)", "source (S)", "drain (D)"],
    ];
    // short pin names for the info box
    static readonly symbolPinNames: string[][] = [
        ["V-in", "V+in", "Vout", "V+", "V-"],
        ["Va", "Vk"],
        ["Vb", "Vc", "Ve"],
        ["Vb", "Vc", "Ve"],
        ["Vg", "Vs", "Vd"],
        ["Vg", "Vs", "Vd"],
    ];
    // menu each symbol goes in by default (op-amps aren't in the menus, see OpAmpRealElm)
    static readonly symbolCategories = ["activeBloc", "active", "active", "active", "active", "active"];

    // menu category of subcircuits without a symbol
    static readonly CAT_SUBCIRCUITS = "subcircuits";

    static getSymbolIndex(sym: string | null): number {
        return sym == null ? -1 : SubcircuitSymbols.symbolKeys.indexOf(sym);
    }

    static getDefaultCategory(sym: string | null): string {
        const i = SubcircuitSymbols.getSymbolIndex(sym);
        return (i < 0) ? SubcircuitSymbols.CAT_SUBCIRCUITS : SubcircuitSymbols.symbolCategories[i];
    }

    // is this a subcircuit model made to be used as an op-amp (by OpAmpRealElm)?
    static isOpAmpModel(m: { symbol: string | null, symbolNodes: number[] | null } | null): boolean {
        return m != null && m.symbol === SubcircuitSymbols.SYM_OPAMP &&
            m.symbolNodes != null && m.symbolNodes.length === 5;
    }
}
