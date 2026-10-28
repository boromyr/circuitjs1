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

import { ExprParser, ExprState } from "./Expr";
import { UserModelLibrary } from "./UserModelLibrary";

// Netlist rewriting done before SpiceImport converts a subcircuit: the subcircuits it
// instantiates (X lines, with PARAMS:) are expanded into it, voltage-controlled switches (S
// lines with a VSWITCH model) become VALUE current sources, and PSpice ABM expressions
// (VALUE {...}) are translated to CircuitJS expressions.  Vendor models (eg Texas
// Instruments) are written like this.

class SubcktDef {
    name: string = "";
    // the .subckt line as written, to keep the case of the name
    line: string = "";
    pins: string[] = [];
    // default values as written: they can use other parameters, so they are evaluated for
    // each instance (see instanceParams)
    params = new Map<string, string>();
    body: string[] = [];
    // .model lines inside the subcircuit, by model name
    models = new Map<string, string>();
}

// numbers in expressions: no "e+" exponents, which the expression parser would read as an addition
// (rounded, so 10u is not 0.000009999999999999999)
function formatNumber(x: number): string {
    return String(Number(x.toPrecision(15))).replace("e+", "e");
}

export class SpiceNetlist {
    private subckts = new Map<string, SubcktDef>();
    // .model lines outside the subcircuits
    private globalModels = new Map<string, string>();
    private globalParams = new Map<string, string>();
    // lines of the expanded subcircuit
    private out: string[] = [];
    // models used by the expanded subcircuit, by their (possibly renamed) name
    private outModels = new Map<string, string>();
    private log: (s: string) => void;

    private constructor(log: (s: string) => void) {
        this.log = log;
    }

    // the subcircuit to import: the first one that no other subcircuit uses
    static findTopSubckt(lines: string[]): string | null {
        const names: string[] = [];
        const used = new Set<string>();
        let inSub = false;
        for (const line of lines) {
            const t = line.trim().toLowerCase();
            const tok = t.split(/[\s()]+/).filter(x => x.length > 0);
            if (tok.length === 0)
                continue;
            if (tok[0] === ".subckt" && tok.length > 1) {
                names.push(tok[1]);
                inSub = true;
            } else if (tok[0] === ".ends")
                inSub = false;
            else if (inSub && tok[0].startsWith("x"))
                used.add(SpiceNetlist.getXSubcktName(tok));
        }
        for (const n of names)
            if (!used.has(n))
                return n;
        return names.length > 0 ? names[0] : null;
    }

    // name of the subcircuit an X line uses: the last token before the parameters
    private static getXSubcktName(tok: string[]): string {
        return tok[SpiceNetlist.paramStart(tok, 1) - 1];
    }

    // index of the first token of the parameters (params:, x=1, or x = 1 with spaces), or the
    // number of tokens if there are none
    private static paramStart(tok: string[], from: number): number {
        for (let i = from; i < tok.length; i++) {
            if (tok[i] === "params:")
                return i;
            const eq = tok[i].indexOf('=');
            if (eq > 0)
                return i;
            // "= 1k" or "=": the name of the parameter is the token before
            if (eq === 0)
                return Math.max(from, i - 1);
        }
        return tok.length;
    }

    // expand the top subcircuit in the lines (as returned by SpiceImport.getLines()).  The
    // result has one .subckt (with the top's name, as written), the lines of all the
    // subcircuits it uses, and the models after .ends; null (with the reason logged) if it
    // can't be done
    static flatten(lines: string[], log: (s: string) => void): string[] | null {
        const sn = new SpiceNetlist(log);
        if (!sn.readDefinitions(lines))
            return null;
        const top = SpiceNetlist.findTopSubckt(lines);
        if (top == null)
            return lines;
        const def = sn.subckts.get(top)!;
        sn.out.push(def.line);
        const pinMap = new Map<string, string>();
        for (const p of def.pins)
            pinMap.set(p, p);
        if (!sn.expand(def, "", pinMap, sn.instanceParams(def, new Map()), 0))
            return null;
        sn.out.push(".ends");
        for (const [name, line] of sn.globalModels)
            if (!sn.outModels.has(name))
                sn.outModels.set(name, line);
        for (const line of sn.outModels.values())
            sn.out.push(line);
        return sn.out;
    }

    private readDefinitions(lines: string[]): boolean {
        let cur: SubcktDef | null = null;
        for (const line of lines) {
            const t = line.trim();
            const lt = t.toLowerCase();
            if (lt.length === 0 || lt.startsWith("*"))
                continue;
            const tok = lt.split(/[\s()]+/).filter(x => x.length > 0);
            if (tok[0] === ".subckt") {
                if (cur != null) {
                    this.log("nested .subckt definitions not supported");
                    return false;
                }
                cur = new SubcktDef();
                cur.line = t;
                cur.name = tok[1];
                cur.pins = tok.slice(2, SpiceNetlist.paramStart(tok, 2));
                SpiceNetlist.readRawParams(SpiceNetlist.afterPins(lt), cur.params);
                this.subckts.set(cur.name, cur);
                continue;
            }
            if (tok[0] === ".ends") {
                cur = null;
                continue;
            }
            if (tok[0] === ".model" && tok.length > 1) {
                (cur != null ? cur.models : this.globalModels).set(tok[1], t);
                continue;
            }
            if (tok[0] === ".param") {
                if (cur != null)
                    SpiceNetlist.readRawParams(lt.substring(6), cur.params);
                else
                    this.readParams(lt.substring(6), this.globalParams, this.globalParams);
                continue;
            }
            if (cur != null)
                cur.body.push(lt);
        }
        return true;
    }

    // the part of a .subckt or X line after "params:" (or from the first x=1)
    private static afterPins(lt: string): string {
        const ix = lt.indexOf("params:");
        if (ix >= 0)
            return lt.substring(ix + 7);
        const m = /\s[a-z_][a-z0-9_]*\s*=/.exec(lt);
        return (m == null) ? "" : lt.substring(m.index);
    }

    private static readonly PARAM_RE = /([a-z_][a-z0-9_]*)\s*=\s*(\{[^{}]*\}|[^\s]+)/g;

    // read x=1 y={2*x} into params, evaluating the values with the parameters in scope
    private readParams(s: string, params: Map<string, string>, scope: Map<string, string>): void {
        for (const m of s.matchAll(SpiceNetlist.PARAM_RE))
            params.set(m[1], this.paramValue(m[2], scope));
    }

    // read x=1 y={2*x} into params, with the values as written
    private static readRawParams(s: string, params: Map<string, string>): void {
        for (const m of s.matchAll(SpiceNetlist.PARAM_RE))
            params.set(m[1], m[2]);
    }

    // parameters of an instance of def: the global ones, the values the instance gives (already
    // evaluated), then the defaults of the others, in order, so they can use the ones before
    private instanceParams(def: SubcktDef, given: Map<string, string>): Map<string, string> {
        const params = new Map(this.globalParams);
        for (const [k, v] of given)
            params.set(k, v);
        for (const [k, v] of def.params)
            if (!given.has(k))
                params.set(k, this.paramValue(v, params));
        return params;
    }

    // a parameter value as a number if possible, otherwise as an expression in parentheses
    private paramValue(v: string, scope: Map<string, string>): string {
        let s = v.trim();
        if (!s.startsWith("{"))
            s = "{" + s + "}";
        s = SpiceNetlist.substParams(s, scope);
        try {
            const x = SpiceNetlist.evalConst(s.substring(1, s.length - 1));
            if (x != null)
                return formatNumber(x);
        } catch (e) {
            // not a constant
        }
        return "(" + s.substring(1, s.length - 1) + ")";
    }

    // value of an expression with only numbers in it, or null
    static evalConst(s: string): number | null {
        const inputs: string[] = [];
        let e: string;
        try {
            e = SpiceNetlist.translateExpr(s, inputs);
        } catch (err) {
            // eg a name that is not a parameter
            return null;
        }
        if (inputs.length > 0)
            return null;
        const parser = new ExprParser(e);
        const expr = parser.parseExpression();
        if (parser.gotError() != null)
            return null;
        const x = expr.eval(new ExprState(0));
        return isFinite(x) ? x : null;
    }

    // replace the parameters inside { } with their values (but not inside v() or i())
    static substParams(s: string, params: Map<string, string>): string {
        if (params.size === 0)
            return s;
        let out = "";
        let depth = 0;
        let i = 0;
        const isWord = (c: string) => /[a-z0-9_.$]/.test(c);
        while (i < s.length) {
            const ch = s.charAt(i);
            if (ch === '{' || ch === '}') {
                depth += (ch === '{') ? 1 : -1;
                out += ch;
                i++;
                continue;
            }
            if (depth <= 0 || !/[a-z_]/.test(ch) || (i > 0 && isWord(s.charAt(i - 1)))) {
                out += ch;
                i++;
                continue;
            }
            const id = /^[a-z_][a-z0-9_]*/.exec(s.substring(i))![0];
            let j = i + id.length;
            while (j < s.length && s.charAt(j) === ' ')
                j++;
            if ((id === "v" || id === "i") && s.charAt(j) === '(') {
                const k = s.indexOf(')', j);
                const end = (k < 0) ? s.length : k + 1;
                out += s.substring(i, end);
                i = end;
                continue;
            }
            const v = params.get(id);
            if (v != null && s.charAt(j) !== '(')
                out += v.startsWith("-") ? "(" + v + ")" : v;
            else
                out += id;
            i += id.length;
        }
        return out;
    }

    // add the lines of a subcircuit instance to the output.  prefix makes the names of its
    // elements and internal nodes unique; pinMap gives the outer node of each pin
    private expand(def: SubcktDef, prefix: string, pinMap: Map<string, string>,
            params: Map<string, string>, depth: number): boolean {
        if (depth > 20) {
            this.log("subcircuits nested too deeply: " + def.name);
            return false;
        }
        const mapNode = (n: string) => (n === "0") ? "0" : (pinMap.get(n) ?? prefix + n);
        const mapName = (n: string) => (prefix.length === 0) ? n : n.charAt(0) + prefix + n;
        const mapModel = (n: string) => {
            const line = def.models.get(n);
            if (line == null)
                return n;
            // models of the instantiated subcircuits are named after them
            const name = (depth === 0) ? n : def.name + "_" + n;
            if (!this.outModels.has(name))
                this.outModels.set(name, line.replace(/^(\.model\s+)\S+/i, "$1" + name));
            return name;
        };
        // node names in v() and source names in i()
        const mapExpr = (s: string) => s.replace(/\b([vi])\s*\(([^()]*)\)/g, (_m, f: string, args: string) =>
            f + "(" + args.split(",").map(a => (f === "v") ? mapNode(a.trim()) : mapName(a.trim())).join(",") + ")");

        for (const raw of def.body) {
            const line = SpiceNetlist.substParams(raw, params);
            const name = line.split(/\s+/)[0];
            const c = name.charAt(0);
            const take = (n: number): string[] | null => {
                const m = new RegExp("^\\S+" + "\\s+([^\\s()]+)".repeat(n) + "\\s*(.*)$").exec(line);
                return (m == null) ? null : m.slice(1);
            };
            let res: string[] | null;

            if (c === 'x') {
                const tok = line.split(/[\s()]+/).filter(x => x.length > 0);
                const subName = SpiceNetlist.getXSubcktName(tok);
                const sub = this.subckts.get(subName);
                if (sub == null) {
                    this.log("subcircuit not found: " + subName);
                    return false;
                }
                const nodes = tok.slice(1, tok.indexOf(subName, 1));
                if (nodes.length !== sub.pins.length) {
                    this.log(name + ": " + sub.pins.length + " nodes expected for " + subName);
                    return false;
                }
                const pm = new Map<string, string>();
                for (let i = 0; i !== nodes.length; i++)
                    pm.set(sub.pins[i], mapNode(nodes[i]));
                // parameters of the subcircuit: the ones given here (evaluated with ours), and its defaults
                const given = new Map<string, string>();
                this.readParams(SpiceNetlist.afterPins(line), given, params);
                if (!this.expand(sub, prefix + name + ".", pm, this.instanceParams(sub, given), depth + 1))
                    return false;
                continue;
            }

            if (c === 's') {
                res = take(4);
                const mod = (res == null) ? null : res[4].split(/\s+/)[0];
                const ml = (mod == null) ? null : (def.models.get(mod) ?? this.globalModels.get(mod));
                if (res == null || ml == null || !/\bvswitch\b/.test(ml.toLowerCase())) {
                    this.log("can't understand switch: " + line);
                    return false;
                }
                const ns = res.slice(0, 4).map(mapNode);
                this.out.push("g" + mapName(name).substring(1) + " " + ns[0] + " " + ns[1] + " value {" +
                    SpiceNetlist.switchExpr(ml.toLowerCase(), ns) + "}");
                continue;
            }

            // number of nodes before the value or model
            const nodeCount = ("rcldvibefgh".indexOf(c) >= 0) ? 2 : ("qj".indexOf(c) >= 0) ? 3 : (c === 'm') ? 4 : -1;
            if (nodeCount < 0 || (res = take(nodeCount)) == null) {
                // let SpiceImport report it
                this.out.push(line);
                continue;
            }
            const nodes = res.slice(0, nodeCount).map(mapNode);
            let rest = res[nodeCount];
            if ("dqjm".indexOf(c) >= 0)
                rest = rest.replace(/^\S+/, m => mapModel(m));
            else if ("efgh".indexOf(c) >= 0 || c === 'b')
                rest = this.mapSourceRest(c, rest, mapNode, mapName, mapExpr);
            else if (rest.startsWith("{")) {
                // value given by an expression
                const k = rest.indexOf('}');
                const x = SpiceNetlist.evalConst(rest.substring(1, k < 0 ? rest.length : k));
                if (x == null) {
                    this.log("can't compute value: " + line);
                    return false;
                }
                rest = formatNumber(x) + ((k < 0) ? "" : rest.substring(k + 1));
            }
            this.out.push(mapName(name) + " " + nodes.join(" ") + " " + rest);
        }
        return true;
    }

    // map the nodes and source names after the output nodes of a controlled source
    private mapSourceRest(c: string, rest: string, mapNode: (n: string) => string,
            mapName: (n: string) => string, mapExpr: (s: string) => string): string {
        if (c === 'b' || /^(value|table|laplace)\b/.test(rest))
            return mapExpr(rest);
        const m = /^poly\s*\(\s*(\d+)\s*\)\s*(.*)$/.exec(rest);
        const cc = (c === 'f' || c === 'h');
        if (m == null) {
            // linear: two control nodes or a voltage source, then the gain
            const tok = rest.split(/\s+/);
            if (cc)
                return mapName(tok[0]) + " " + tok.slice(1).join(" ");
            return mapNode(tok[0]) + " " + mapNode(tok[1]) + " " + tok.slice(2).join(" ");
        }
        const dim = parseInt(m[1]);
        const tok = m[2].split(/[\s(),]+/).filter(x => x.length > 0);
        let s = "poly(" + dim + ")";
        let i = 0;
        for (let d = 0; d !== dim; d++) {
            if (cc)
                s += " " + mapName(tok[i++]);
            else {
                s += " (" + mapNode(tok[i]) + "," + mapNode(tok[i + 1]) + ")";
                i += 2;
            }
        }
        return s + " " + tok.slice(i).join(" ");
    }

    // conductance of a PSpice voltage-controlled switch: the resistance changes smoothly (on
    // a log scale) from Roff at Voff to Ron at Von
    private static switchExpr(model: string, ns: string[]): string {
        const get = (k: string, def: number) => {
            const m = new RegExp("\\b" + k + "\\s*=\\s*([^\\s(),]+)").exec(model);
            return (m == null) ? def : UserModelLibrary.parseNumber(m[1]);
        };
        const ron = get("ron", 1), roff = get("roff", 1e6), von = get("von", 1), voff = get("voff", 0);
        const vout = "v(" + ns[0] + "," + ns[1] + ")";
        const vc = "v(" + ns[2] + "," + ns[3] + ")";
        const f = formatNumber;
        if (von === voff)
            return vout + "*if(" + vc + ">" + f(von) + "," + f(1 / ron) + "," + f(1 / roff) + ")";
        const vm = (von + voff) / 2, vd = von - voff;
        const lm = Math.log(Math.sqrt(ron * roff)), lr = Math.log(ron / roff);
        // R = exp(lm + 3*lr*x/(2*vd) - 2*lr*x^3/vd^3), x = vc - vm limited to +-vd/2
        const x = "limit(" + vc + "-(" + f(vm) + ")," + f(-vd / 2) + "," + f(vd / 2) + ")";
        return vout + "*exp(-(" + f(lm) + "+(" + f(3 * lr / (2 * vd)) + ")*" + x +
            "-(" + f(2 * lr / (vd * vd * vd)) + ")*pwrs(" + x + ",3)))";
    }

    // translate a PSpice expression to a CircuitJS one.  The node voltages it uses, v(n) or
    // v(n1,n2), become the inputs a, b, c... (their nodes are added to inputs); ground is 0.
    // Throws if the expression can't be translated
    static translateExpr(text: string, inputs: string[]): string {
        const toks = SpiceNetlist.tokenizeExpr(text.toLowerCase());
        const input = (n: string): string => {
            if (n === "0")
                return "0";
            let i = inputs.indexOf(n);
            if (i < 0) {
                i = inputs.length;
                inputs.push(n);
            }
            if (i >= 9)
                throw new Error("too many inputs");
            return String.fromCharCode(97 + i);
        };
        let pos = 0;
        // translate the tokens up to the closing parenthesis (or ',' at depth 0 if args)
        const translate = (args: boolean): string => {
            let out = "";
            let depth = 0;
            while (pos < toks.length) {
                const t = toks[pos];
                if (args && depth === 0 && (t === "," || t === ")" || t === "}"))
                    return out;
                pos++;
                if (t === "(" || t === "{") {
                    depth++;
                    out += "(";
                } else if (t === ")" || t === "}") {
                    depth--;
                    out += ")";
                } else if (t.startsWith("v(")) {
                    const nodes = t.substring(2, t.length - 1).split(",").map(x => x.trim());
                    out += (nodes.length === 1) ? input(nodes[0]) : "(" + input(nodes[0]) + "-" + input(nodes[1]) + ")";
                } else if (t.startsWith("i(")) {
                    throw new Error("currents not supported: " + t);
                } else if (/^[0-9.]/.test(t)) {
                    out += formatNumber(UserModelLibrary.parseNumber(t));
                } else if (/^[a-z_]/.test(t)) {
                    if (toks[pos] === "(") {
                        pos++;
                        const a: string[] = [];
                        while (pos < toks.length) {
                            a.push(translate(true));
                            const sep = toks[pos++];
                            if (sep !== ",")
                                break;
                        }
                        out += SpiceNetlist.translateFunc(t, a);
                    } else if (t === "time")
                        out += "t";
                    else if (t === "pi")
                        out += "pi";
                    else if (t === "temp")
                        out += "27";
                    else
                        throw new Error("unknown name: " + t);
                } else {
                    const ops: Record<string, string> = { "**": "^", "&": "&&", "|": "||", "~": "!", "=": "==", "<>": "!=" };
                    out += ops[t] ?? t;
                }
            }
            return out;
        };
        const e = translate(false);
        if (pos < toks.length)
            throw new Error("unexpected " + toks[pos]);
        return e;
    }

    private static translateFunc(f: string, a: string[]): string {
        const n = (k: number) => {
            if (a.length !== k)
                throw new Error(f + ": " + k + " arguments expected");
        };
        // in parentheses unless it's a number or an input
        const p = (x: string) => /^[a-z0-9.]+$/.test(x) ? x : "(" + x + ")";
        switch (f) {
            case "if": n(3); return "(" + p(a[0]) + "?" + p(a[1]) + ":" + p(a[2]) + ")";
            case "limit": n(3); return "clamp(" + a[0] + ",min(" + a[1] + "," + a[2] + "),max(" + a[1] + "," + a[2] + "))";
            case "log": case "ln": n(1); return "log(" + a[0] + ")";
            case "log10": n(1); return "(log(" + a[0] + ")/2.302585092994046)";
            case "sgn": n(1); return "(" + p(a[0]) + ">0?1:(" + p(a[0]) + "<0?-1:0))";
            case "pow": n(2); return "(" + p(a[0]) + "^" + p(a[1]) + ")";
            case "pwr": case "pwrs": n(2); return f + "(" + a[0] + "," + a[1] + ")";
            case "min": case "max": return f + "(" + a.join(",") + ")";
            case "abs": case "sqrt": case "exp": case "sin": case "cos": case "tan": case "atan":
            case "asin": case "acos": case "sinh": case "cosh": case "tanh": case "floor": case "ceil":
                n(1); return f + "(" + a[0] + ")";
        }
        throw new Error("function not supported: " + f);
    }

    // numbers (with SPICE suffixes), names, v(...)/i(...) as one token, operators
    private static tokenizeExpr(s: string): string[] {
        const toks: string[] = [];
        let i = 0;
        while (i < s.length) {
            const rest = s.substring(i);
            let m = /^\s+/.exec(rest);
            if (m == null)
                m = /^[vi]\s*\([^()]*\)/.exec(rest);
            if (m == null)
                m = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?[a-z]*/.exec(rest);
            if (m == null)
                m = /^[a-z_][a-z0-9_]*/.exec(rest);
            if (m == null)
                m = /^(\*\*|<=|>=|==|!=|<>|&&|\|\|)/.exec(rest);
            const t = (m == null) ? s.charAt(i) : m[0];
            i += t.length;
            if (/^\s/.test(t))
                continue;
            // v(...) without the spaces, && and || as & and |
            toks.push(/^[vi]\s*\(/.test(t) ? t.replace(/\s+/g, "") : (t === "&&") ? "&" : (t === "||") ? "|" : t);
        }
        return toks;
    }
}
