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

package com.lushprojects.circuitjs1.client;

import java.util.Collections;
import java.util.HashMap;
import java.util.Vector;

import com.google.gwt.storage.client.Storage;
import com.lushprojects.circuitjs1.client.util.Locale;

// Device models imported from SPICE ".model" lines (diodes, BJTs, JFETs, MOSFETs), kept in
// local storage so they show up in the model list of each component's edit dialog across
// sessions (and stay editable there), and the menu category chosen for each subcircuit.
public class UserModelLibrary {

    static final String MODEL_PREFIX = "spiceModel:";
    static final String CATEGORY_PREFIX = "subcircuitCategory:";

    // menu categories a subcircuit can be placed in; keys are stored, labels are locale keys
    static final String CAT_SUBCIRCUITS = "subcircuits";
    static final String categoryKeys[] = {
	CAT_SUBCIRCUITS, "passive", "input", "output", "active", "activeBloc", "gates", "chips", "achips"
    };
    static final String categoryLabels[] = {
	"&nbsp;</div>Subcircuits", "&nbsp;</div>Passive Components", "&nbsp;</div>Inputs and Sources",
	"&nbsp;</div>Outputs and Labels", "&nbsp;</div>Active Components", "&nbsp;</div>Active Building Blocks",
	"&nbsp;</div>Logic Gates, Input and Output", "&nbsp;</div>Digital Chips", "&nbsp;</div>Analog and Hybrid Chips"
    };

    // an imported device model
    static class Entry implements Comparable<Entry> {
	String name;      // model name, as used by the elements
	String type;      // SPICE type: d, npn, pnp, njf, pjf, nmos, pmos
	String line;      // .model line, re-parsed at startup (regenerated when the model is edited)
	Object model;     // the DiodeModel, TransistorModel or MosfetModel
	double beta = 100; // BJT forward beta (BF), kept only to write it back out

	public int compareTo(Entry e) { return name.compareTo(e.name); }
    }

    static HashMap<String, Entry> entries = new HashMap<String, Entry>();
    static int sequenceNumber = 1;  // bumped whenever the menus need to be rebuilt

    static Storage getStorage() {
	return Storage.getLocalStorageIfSupported();
    }

    static void loadFromStorage() {
	Storage stor = getStorage();
	if (stor == null)
	    return;
	for (int i = 0; i != stor.getLength(); i++) {
	    String key = stor.key(i);
	    if (key == null || !key.startsWith(MODEL_PREFIX))
		continue;
	    try {
		parseModelLine(stor.getItem(key), new StringBuilder());
	    } catch (Exception e) {
		CirSim.console("can't load model " + key + ": " + e);
	    }
	}
	sequenceNumber++;
    }

    static Vector<Entry> getEntries() {
	Vector<Entry> v = new Vector<Entry>(entries.values());
	Collections.sort(v);
	return v;
    }

    // import every ".model" line in a SPICE text, saving them to storage; returns how many
    // were imported, with a report in log
    static int importModels(Vector<String> lines, StringBuilder log) {
	int count = 0;
	for (String line : lines) {
	    if (!line.trim().toLowerCase().startsWith(".model"))
		continue;
	    try {
		Entry e = parseModelLine(line, log);
		if (e == null)
		    continue;
		Storage stor = getStorage();
		if (stor != null)
		    stor.setItem(MODEL_PREFIX + e.name, e.line);
		count++;
	    } catch (Exception ex) {
		log.append("error in line: " + line + "\n");
	    }
	}
	if (count > 0) {
	    sequenceNumber++;
	    CirSim.theApp.updateModels();
	}
	return count;
    }

    static void removeModel(String name) {
	Entry e = entries.remove(name);
	// also take it out of the model lists of the elements
	if (e != null) {
	    if (e.model instanceof DiodeModel && DiodeModel.modelMap != null)
		DiodeModel.modelMap.remove(name);
	    else if (e.model instanceof TransistorModel && TransistorModel.modelMap != null)
		TransistorModel.modelMap.remove(name);
	    else if (e.model instanceof MosfetModel && MosfetModel.modelMap != null)
		MosfetModel.modelMap.remove(name);
	}
	Storage stor = getStorage();
	if (stor != null)
	    stor.removeItem(MODEL_PREFIX + name);
	sequenceNumber++;
    }

    // parse a SPICE number: "4.4e-9", "2.52n", "1meg", "4pF" (trailing units are ignored,
    // and M means milli as in SPICE)
    static double parseNumber(String s) throws Exception {
	s = s.toLowerCase();
	int i = 0, n = s.length();
	while (i < n) {
	    char c = s.charAt(i);
	    if ((c >= '0' && c <= '9') || c == '.' || ((c == '-' || c == '+') && (i == 0 || s.charAt(i-1) == 'e')))
		i++;
	    else if (c == 'e' && i > 0 && i+1 < n && "0123456789+-".indexOf(s.charAt(i+1)) >= 0)
		i++;
	    else
		break;
	}
	double v = Double.parseDouble(s.substring(0, i));
	String suffix = s.substring(i);
	if (suffix.startsWith("meg"))
	    return v*1e6;
	if (suffix.length() == 0)
	    return v;
	switch (suffix.charAt(0)) {
	case 'f': return v*1e-15;
	case 'p': return v*1e-12;
	case 'n': return v*1e-9;
	case 'u': return v*1e-6;
	case 'm': return v*1e-3;
	case 'k': return v*1e3;
	case 'g': return v*1e9;
	case 't': return v*1e12;
	}
	return v;
    }

    // parse ".model NAME TYPE(PARAM=VALUE ...)" and create/update the matching model
    static Entry parseModelLine(String line, StringBuilder log) throws Exception {
	// make "NAME TYPE ( a = 1 , b=2 )" into "NAME TYPE a=1 b=2"
	String s = line.trim().replaceAll("[(),]", " ").replaceAll("\\s*=\\s*", "=");
	String tok[] = s.split("\\s+");
	if (tok.length < 3 || !tok[0].equalsIgnoreCase(".model"))
	    throw new Exception("bad model line");
	String name = tok[1];
	String type = tok[2].toLowerCase();
	HashMap<String, Double> params = new HashMap<String, Double>();
	for (int i = 3; i < tok.length; i++) {
	    int eq = tok[i].indexOf('=');
	    if (eq <= 0)
		continue;
	    try {
		params.put(tok[i].substring(0, eq).toLowerCase(), parseNumber(tok[i].substring(eq+1)));
	    } catch (Exception e) {
		log.append(name + ": " + Locale.LS("ignored parameter") + " " + tok[i] + "\n");
	    }
	}

	Entry e = new Entry();
	e.type = type;
	e.line = line.trim();
	e.name = name;

	if (type.equals("d")) {
	    DiodeModel.createModelMap();
	    if (isBuiltInName(DiodeModel.modelMap, name))
		e.name = name = name + "-spice";
	    DiodeModel dm = DiodeModel.getModelWithName(name);
	    dm.flags = 0;
	    dm.saturationCurrent = get(params, "is", 1e-14);
	    dm.seriesResistance = get(params, "rs", 0);
	    dm.emissionCoefficient = get(params, "n", 1);
	    dm.breakdownVoltage = get(params, "bv", 0);
	    dm.junctionCap = get(params, "cjo", get(params, "cj0", 0));
	    dm.junctionPot = get(params, "vj", 0.75);
	    dm.junctionExp = get(params, "m", 0.33);
	    dm.transitTime = get(params, "tt", 0);
	    dm.description = "SPICE";
	    dm.readOnly = false;
	    e.model = dm;
	    dm.builtIn = dm.internal = dm.oldStyle = false;
	    dm.updateModel();
	} else if (type.equals("npn") || type.equals("pnp")) {
	    TransistorModel.createModelMap();
	    if (isBuiltInName(TransistorModel.modelMap, name))
		e.name = name = name + "-spice";
	    TransistorModel tm = TransistorModel.getModelWithName(name);
	    tm.description = "SPICE";
	    tm.satCur = get(params, "is", 1e-16);
	    tm.betaR = get(params, "br", 1);
	    tm.emissionCoeffF = get(params, "nf", 1);
	    tm.emissionCoeffR = get(params, "nr", 1);
	    tm.leakBEemissionCoeff = get(params, "ne", 1.5);
	    tm.leakBCemissionCoeff = get(params, "nc", 2);
	    tm.BEleakCur = get(params, "ise", 0);
	    tm.BCleakCur = get(params, "isc", 0);
	    tm.invEarlyVoltF = inverse(get(params, "vaf", get(params, "va", 0)));
	    tm.invEarlyVoltR = inverse(get(params, "var", get(params, "vb", 0)));
	    tm.invRollOffF = inverse(get(params, "ikf", get(params, "ik", 0)));
	    tm.invRollOffR = inverse(get(params, "ikr", 0));
	    tm.junctionCapBE = get(params, "cje", 0);
	    tm.junctionCapBC = get(params, "cjc", 0);
	    tm.junctionPotBE = get(params, "vje", get(params, "pe", 0.75));
	    tm.junctionPotBC = get(params, "vjc", get(params, "pc", 0.75));
	    tm.junctionExpBE = get(params, "mje", get(params, "me", 0.33));
	    tm.junctionExpBC = get(params, "mjc", get(params, "mc", 0.33));
	    tm.transitTimeF = get(params, "tf", 0);
	    tm.transitTimeR = get(params, "tr", 0);
	    tm.readOnly = false;
	    e.model = tm;
	    tm.builtIn = tm.internal = false;
	    tm.updateModel();
	    e.beta = get(params, "bf", 100);
	    if (params.containsKey("rb") || params.containsKey("rc") || params.containsKey("re"))
		log.append(name + ": " + Locale.LS("RB/RC/RE not supported, ignored") + "\n");
	} else if (type.equals("njf") || type.equals("pjf") || type.equals("nmos") || type.equals("pmos")) {
	    boolean jfet = type.endsWith("jf");
	    MosfetModel.createModelMap();
	    if (isBuiltInName(MosfetModel.modelMap, name))
		e.name = name = name + "-spice";
	    MosfetModel mm = MosfetModel.getModelWithName(name);
	    mm.description = "SPICE";
	    mm.flags = 0;
	    if (jfet) {
		mm.setJfet();
		// SPICE VTO is negative for depletion JFETs of both polarities
		mm.threshold = get(params, "vto", -2);
		// SPICE: Ids = BETA*(Vgs-VTO)^2; here Ids = beta/2*(Vgs-Vt)^2
		mm.beta = 2*get(params, "beta", 1e-4);
		mm.capGS = get(params, "cgs", 0);
		mm.capGD = get(params, "cgd", 0);
		mm.showBulk = mm.bodyDiode = false;
	    } else {
		// level 1 with W/L = 1: beta = KP. PMOS VTO is given with its real (negative) sign,
		// while the element works with the n-channel equivalent.
		double vto = get(params, "vto", 0);
		mm.threshold = type.equals("pmos") ? -vto : vto;
		mm.beta = get(params, "kp", 2e-5);
		mm.capGS = get(params, "cgs", 0);
		mm.capGD = get(params, "cgd", 0);
		mm.showBulk = mm.bodyDiode = true;
	    }
	    mm.lambda = get(params, "lambda", 0);
	    mm.readOnly = false;
	    e.model = mm;
	    mm.builtIn = mm.internal = mm.oldStyle = false;
	} else {
	    log.append(name + ": " + Locale.LS("unsupported model type") + " " + tok[2] + "\n");
	    return null;
	}
	if (!e.name.equals(tok[1]))
	    log.append(tok[1] + ": " + Locale.LS("a built-in model has this name, imported as") + " " + e.name + "\n");
	log.append(Locale.LS("imported model") + " " + e.name + " (" + tok[2].toUpperCase() + ")\n");
	entries.put(e.name, e);
	return e;
    }

    static boolean isBuiltInName(HashMap map, String name) {
	if (map == null)
	    return false;
	Object o = map.get(name);
	if (o instanceof DiodeModel) return ((DiodeModel) o).builtIn;
	if (o instanceof TransistorModel) return ((TransistorModel) o).builtIn;
	if (o instanceof MosfetModel) return ((MosfetModel) o).builtIn;
	return false;
    }

    static double get(HashMap<String, Double> params, String key, double def) {
	Double d = params.get(key);
	return d == null ? def : d;
    }

    static double inverse(double x) {
	return x == 0 ? 0 : 1/x;
    }

    // called when a model was changed in its edit dialog: if it's one of ours, store the new
    // values (and the new name, if it was renamed)
    static void modelEdited(Object model) {
	Entry e = null;
	for (Entry x : entries.values())
	    if (x.model == model)
		e = x;
	if (e == null)
	    return;
	String name = (model instanceof DiodeModel) ? ((DiodeModel) model).name :
	    (model instanceof TransistorModel) ? ((TransistorModel) model).name : ((MosfetModel) model).name;
	Storage stor = getStorage();
	if (!name.equals(e.name)) {
	    entries.remove(e.name);
	    if (stor != null)
		stor.removeItem(MODEL_PREFIX + e.name);
	    e.name = name;
	    entries.put(name, e);
	}
	e.line = toSpiceLine(e);
	if (stor != null)
	    stor.setItem(MODEL_PREFIX + e.name, e.line);
	sequenceNumber++;
    }

    // write a model's current values as a .model line
    static String toSpiceLine(Entry e) {
	StringBuilder sb = new StringBuilder(".model " + e.name + " " + e.type.toUpperCase() + "(");
	if (e.model instanceof DiodeModel) {
	    DiodeModel dm = (DiodeModel) e.model;
	    sb.append("IS=" + dm.saturationCurrent + " RS=" + dm.seriesResistance + " N=" + dm.emissionCoefficient +
		      " BV=" + dm.breakdownVoltage + " CJO=" + dm.junctionCap + " VJ=" + dm.junctionPot +
		      " M=" + dm.junctionExp + " TT=" + dm.transitTime);
	} else if (e.model instanceof TransistorModel) {
	    TransistorModel tm = (TransistorModel) e.model;
	    sb.append("IS=" + tm.satCur + " BF=" + e.beta + " BR=" + tm.betaR + " NF=" + tm.emissionCoeffF +
		      " NR=" + tm.emissionCoeffR + " NE=" + tm.leakBEemissionCoeff + " NC=" + tm.leakBCemissionCoeff +
		      " ISE=" + tm.BEleakCur + " ISC=" + tm.BCleakCur + " VAF=" + inverse(tm.invEarlyVoltF) +
		      " VAR=" + inverse(tm.invEarlyVoltR) + " IKF=" + inverse(tm.invRollOffF) + " IKR=" + inverse(tm.invRollOffR) +
		      " CJE=" + tm.junctionCapBE + " CJC=" + tm.junctionCapBC + " VJE=" + tm.junctionPotBE +
		      " VJC=" + tm.junctionPotBC + " MJE=" + tm.junctionExpBE + " MJC=" + tm.junctionExpBC +
		      " TF=" + tm.transitTimeF + " TR=" + tm.transitTimeR);
	} else {
	    MosfetModel mm = (MosfetModel) e.model;
	    if (mm.isJfet())
		sb.append("VTO=" + mm.threshold + " BETA=" + mm.beta/2);
	    else
		sb.append("VTO=" + (e.type.equals("pmos") ? -mm.threshold : mm.threshold) + " KP=" + mm.beta);
	    sb.append(" LAMBDA=" + mm.lambda + " CGS=" + mm.capGS + " CGD=" + mm.capGD);
	}
	return sb.append(")").toString();
    }

    // menu category of a subcircuit
    static String getCategory(String subcircuit) {
	Storage stor = getStorage();
	String c = (stor == null) ? null : stor.getItem(CATEGORY_PREFIX + subcircuit);
	return c == null ? getDefaultCategory(subcircuit) : c;
    }

    // subcircuits drawn with a component symbol go with that component by default
    static String getDefaultCategory(String subcircuit) {
	CustomCompositeModel m = CustomCompositeModel.getModelWithName(subcircuit);
	return SubcircuitSymbolElm.getDefaultCategory(m == null ? null : m.symbol);
    }

    static void setCategory(String subcircuit, String category) {
	Storage stor = getStorage();
	if (stor == null)
	    return;
	if (category == null || category.equals(getDefaultCategory(subcircuit)))
	    stor.removeItem(CATEGORY_PREFIX + subcircuit);
	else
	    stor.setItem(CATEGORY_PREFIX + subcircuit, category);
	sequenceNumber++;
    }

    static void removeCategory(String subcircuit) {
	Storage stor = getStorage();
	if (stor != null)
	    stor.removeItem(CATEGORY_PREFIX + subcircuit);
	sequenceNumber++;
    }

    static void renameCategory(String oldName, String newName) {
	Storage stor = getStorage();
	if (stor == null)
	    return;
	String c = stor.getItem(CATEGORY_PREFIX + oldName);
	stor.removeItem(CATEGORY_PREFIX + oldName);
	if (c != null)
	    stor.setItem(CATEGORY_PREFIX + newName, c);
	sequenceNumber++;
    }

    static String getCategoryLabel(int i) {
	return Locale.LS(categoryLabels[i]).replaceAll("&nbsp;</[dD][iI][vV]>", "");
    }
}
