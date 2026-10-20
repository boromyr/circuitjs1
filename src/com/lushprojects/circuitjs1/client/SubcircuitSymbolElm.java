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

import java.util.Vector;

import com.google.gwt.xml.client.Document;
import com.google.gwt.xml.client.Element;
import com.lushprojects.circuitjs1.client.util.Locale;

// instance of a subcircuit (eg imported from a SPICE .subckt) drawn with the symbol of a
// regular component (diode, transistor, MOSFET) instead of a chip box.  The model says which
// symbol to use and which of its nodes goes to each pin of the symbol.  Op-amp subcircuits
// are models of OpAmpRealElm instead.

public class SubcircuitSymbolElm extends CompositeElm {

    // symbols a subcircuit can be imported as; pins are listed in post order
    static final String SYM_OPAMP = "opamp";
    static final String symbolKeys[] = { SYM_OPAMP, "diode", "npn", "pnp", "nmos", "pmos" };
    static final String symbolLabels[] = {
	"Op-amp", "Diode", "Transistor (bipolar, NPN)", "Transistor (bipolar, PNP)",
	"MOSFET (N-Channel)", "MOSFET (P-Channel)"
    };
    static final String symbolPins[][] = {
	{ "inverting input (-)", "non-inverting input (+)", "output (out)", "positive supply (V+)", "negative supply (V-)" },
	{ "anode (A)", "cathode (K)" },
	{ "base (B)", "collector (C)", "emitter (E)" },
	{ "base (B)", "collector (C)", "emitter (E)" },
	{ "gate (G)", "source (S)", "drain (D)" },
	{ "gate (G)", "source (S)", "drain (D)" }
    };
    // short pin names for the info box
    static final String symbolPinNames[][] = {
	{ "V-in", "V+in", "Vout", "V+", "V-" },
	{ "Va", "Vk" },
	{ "Vb", "Vc", "Ve" },
	{ "Vb", "Vc", "Ve" },
	{ "Vg", "Vs", "Vd" },
	{ "Vg", "Vs", "Vd" }
    };
    // menu each symbol goes in by default (op-amps aren't in the menus, see OpAmpRealElm)
    static final String symbolCategories[] = { "activeBloc", "active", "active", "active", "active", "active" };

    static int getSymbolIndex(String sym) {
	for (int i = 0; i != symbolKeys.length; i++)
	    if (symbolKeys[i].equals(sym))
		return i;
	return -1;
    }

    static String getDefaultCategory(String sym) {
	int i = getSymbolIndex(sym);
	return (i < 0) ? UserModelLibrary.CAT_SUBCIRCUITS : symbolCategories[i];
    }

    static final String DEFAULT_SYMBOL = "diode";

    String modelName;
    CustomCompositeModel model;
    String symbol;
    int symbolIndex;
    // flags of the element drawing the symbol
    int symFlags;
    // element used only to draw the symbol
    CircuitElm drawElm;

    public SubcircuitSymbolElm(int xx, int yy) {
	super(xx, yy);
	modelName = "default";
	symbol = DEFAULT_SYMBOL;
	initSymbol(true);
	// no model yet (this is used to register the class, before the models can be loaded,
	// and when loading a file, which then calls undumpXml())
	setNoModel();
    }

    public SubcircuitSymbolElm(int xx, int yy, String name) {
	super(xx, yy);
	modelName = name;
	CustomCompositeModel m = CustomCompositeModel.getModelWithName(name);
	symbol = (m != null && m.symbol != null) ? m.symbol : DEFAULT_SYMBOL;
	initSymbol(true);
	updateModels();
    }

    public SubcircuitSymbolElm(int xa, int ya, int xb, int yb, int f, StringTokenizer st) {
	super(xa, ya, xb, yb, f);
	modelName = CustomLogicModel.unescape(st.nextToken());
	CustomCompositeModel m = CustomCompositeModel.getModelWithName(modelName);
	symbol = (m != null && m.symbol != null) ? m.symbol : DEFAULT_SYMBOL;
	initSymbol(true);
	loadModel(st);
    }

    // set up the element used to draw the symbol
    void initSymbol(boolean defaultFlags) {
	if (symbol.equals("npn"))
	    drawElm = new NTransistorElm(x, y);
	else if (symbol.equals("pnp"))
	    drawElm = new PTransistorElm(x, y);
	else if (symbol.equals("nmos"))
	    drawElm = new NMosfetElm(x, y);
	else if (symbol.equals("pmos"))
	    drawElm = new PMosfetElm(x, y);
	else {
	    symbol = DEFAULT_SYMBOL;
	    drawElm = new DiodeElm(x, y);
	}
	symbolIndex = getSymbolIndex(symbol);
	if (defaultFlags)
	    symFlags = drawElm.flags;
	noDiagonal = drawElm.noDiagonal;
    }

    int getSymbolPinCount() { return symbolPins[symbolIndex].length; }

    void dumpXmlModel(Document doc) {
	if (compElmList != null) {
	    for (int i = 0; i < compElmList.size(); i++)
		compElmList.get(i).dumpXmlModel(doc);
	}
	if (model != null && !(model.builtin || model.dumped))
	    model.dumpXml(doc);
    }

    void dumpXml(Document doc, Element elem) {
	dumpXmlModel(doc);
	super.dumpXml(doc, elem);
	XMLSerializer.dumpAttr(elem, "mo", modelName);
	XMLSerializer.dumpAttr(elem, "sy", symbol);
	XMLSerializer.dumpAttr(elem, "sf", symFlags);
    }

    void undumpXml(XMLDeserializer xml) {
	modelName = xml.parseStringAttr("mo", modelName);
	symbol = xml.parseStringAttr("sy", symbol);
	initSymbol(false);
	symFlags = xml.parseIntAttr("sf", symFlags);
	updateModels();
	super.undumpXml(xml);
    }

    public void updateModels() {
	model = null;
	loadModel(null);
    }

    void loadModel(StringTokenizer st) {
	model = CustomCompositeModel.getModelWithName(modelName);
	int pinCount = getSymbolPinCount();
	if (model == null || model.symbolNodes == null || model.symbolNodes.length != pinCount ||
	    !symbol.equals(model.symbol)) {
	    // model missing or not made for this symbol: draw the symbol without connections
	    setNoModel();
	    return;
	}
	if (st != null)
	    loadComposite(st, model.getNodeList(), model.symbolNodes);
	else
	    loadCompositeXml(model.getElmEntries(), model.symbolNodes);
	allocNodes();
	setPoints();
    }

    void setNoModel() {
	compElmList = new Vector<CircuitElm>();
	numPosts = numNodes = 0;
	posts = new Point[0];
	allocNodes();
	setPoints();
    }

    boolean isConnected() { return numPosts == getSymbolPinCount(); }

    double getPinVoltage(int n) {
	return (n < volts.length) ? volts[n] : 0;
    }

    double getPinCurrent(int n) {
	return (isConnected()) ? getCurrentIntoNode(n) : 0;
    }

    void setPoints() {
	super.setPoints();
	drawElm.x = x;
	drawElm.y = y;
	drawElm.x2 = x2;
	drawElm.y2 = y2;
	drawElm.flags = symFlags;
	drawElm.setPoints();
	boundingBox = drawElm.boundingBox;
	for (int i = 0; i != numPosts; i++)
	    setPost(i, drawElm.getPost(i));
    }

    void draw(Graphics g) {
	int n = getSymbolPinCount();
	for (int i = 0; i != n; i++)
	    drawElm.volts[i] = getPinVoltage(i);
	// currents used by the symbol to draw the dots
	if (drawElm instanceof TransistorElm) {
	    TransistorElm te = (TransistorElm) drawElm;
	    te.ib = -getPinCurrent(0);
	    te.ic = -getPinCurrent(1);
	    te.ie = -getPinCurrent(2);
	} else if (drawElm instanceof MosfetElm) {
	    ((MosfetElm) drawElm).ids = -getPinCurrent(2);
	} else
	    drawElm.current = -getPinCurrent(0);
	drawElm.setSelected(needsHighlight());
	drawElm.draw(g);
	boundingBox = drawElm.boundingBox;
	drawPosts(g);
    }

    void addRoutingObstacle(WireRouter router) {
	drawElm.addRoutingObstacle(router);
    }

    // flips are done by the drawn element (which knows how its symbol flips), then copied back
    void syncDrawElm() {
	drawElm.x = x; drawElm.y = y; drawElm.x2 = x2; drawElm.y2 = y2;
	drawElm.flags = symFlags;
    }

    void copyFromDrawElm() {
	x = drawElm.x; y = drawElm.y; x2 = drawElm.x2; y2 = drawElm.y2;
	symFlags = drawElm.flags;
	setPoints();
    }

    void flipX(int c2, int count) {
	syncDrawElm();
	drawElm.flipX(c2, count);
	copyFromDrawElm();
    }

    void flipY(int c2, int count) {
	syncDrawElm();
	drawElm.flipY(c2, count);
	copyFromDrawElm();
    }

    void flipXY(int xmy, int count) {
	syncDrawElm();
	drawElm.flipXY(xmy, count);
	copyFromDrawElm();
    }

    boolean canFlipX() { return drawElm.canFlipX(); }
    boolean canFlipY() { return drawElm.canFlipY(); }

    // the subcircuit nodes are normally all connected to each other through its components
    public boolean getConnection(int n1, int n2) { return true; }

    int getDumpType() { return 437; }
    String getXmlDumpType() { return "scs"; }

    String getElmType() { return drawElm.getElmType(); }

    void getInfo(String arr[]) {
	String name = Locale.LS(symbolLabels[symbolIndex]);
	if (model == null) {
	    arr[0] = name + " (" + Locale.LS("missing: ") + modelName + ")";
	    return;
	}
	arr[0] = name + " (" + model.name + ")";
	if (!isConnected())
	    return;
	String names[] = symbolPinNames[symbolIndex];
	for (int i = 0; i != names.length && i+1 < arr.length; i++)
	    arr[i+1] = names[i] + " = " + getVoltageText(volts[i]);
    }

    Vector<CustomCompositeModel> models;

    public EditInfo getEditInfo(int n) {
	if (n == 0) {
	    String label = (model == null) ? (Locale.LS("Model not found: ") + modelName) : "Model Name";
	    EditInfo ei = new EditInfo(label, 0, -1, -1);
	    // only the models made for this symbol
	    models = new Vector<CustomCompositeModel>();
	    ei.choice = new Choice();
	    for (CustomCompositeModel ccm : CustomCompositeModel.getModelList()) {
		if (!symbol.equals(ccm.symbol))
		    continue;
		models.add(ccm);
		ei.choice.add(ccm.name);
		if (ccm == model)
		    ei.choice.select(models.size()-1);
	    }
	    return ei;
	}
	return null;
    }

    public void setEditValue(int n, EditInfo ei) {
	if (n == 0) {
	    int i = ei.choice.getSelectedIndex();
	    if (i < 0 || i >= models.size())
		return;
	    modelName = models.get(i).name;
	    updateModels();
	}
    }
}
