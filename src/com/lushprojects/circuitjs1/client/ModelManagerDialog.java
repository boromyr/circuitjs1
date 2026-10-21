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

import com.google.gwt.event.dom.client.ClickEvent;
import com.google.gwt.event.dom.client.ClickHandler;
import com.google.gwt.user.client.Timer;
import com.google.gwt.user.client.Window;
import com.google.gwt.user.client.ui.Button;
import com.google.gwt.user.client.ui.FlexTable;
import com.google.gwt.user.client.ui.HorizontalPanel;
import com.google.gwt.user.client.ui.Label;
import com.google.gwt.user.client.ui.ScrollPanel;
import com.google.gwt.user.client.ui.TextBox;
import com.google.gwt.user.client.ui.VerticalPanel;
import com.lushprojects.circuitjs1.client.util.Locale;

// lists the imported models (subcircuits and SPICE .model lines) by kind of component,
// with buttons to edit, rename or delete each one

public class ModelManagerDialog extends Dialog {

    // kinds of component the models are grouped by
    static final String groupLabels[] = {
	"Op-amps", "Diodes", "Bipolar transistors", "JFETs", "MOSFETs", "Subcircuits"
    };
    static final int GROUP_OPAMP = 0, GROUP_DIODE = 1, GROUP_BJT = 2, GROUP_JFET = 3,
	GROUP_MOSFET = 4, GROUP_SUBCIRCUIT = 5;

    FlexTable table;
    Timer refreshTimer;
    int lastSeq1, lastSeq2;

    public ModelManagerDialog() {
	super();
	closeOnEnter = true;
	setText(Locale.LS("Imported Models"));
	VerticalPanel vp = new VerticalPanel();
	setWidget(vp);
	table = new FlexTable();
	table.setCellSpacing(2);
	table.setCellPadding(3);
	ScrollPanel sp = new ScrollPanel(table);
	sp.setHeight("400px");
	sp.setWidth("560px");
	vp.add(sp);

	HorizontalPanel hp = new HorizontalPanel();
	hp.addStyleName("topSpace");
	vp.add(hp);
	Button b;
	hp.add(b = new Button(Locale.LS("Import from SPICE...")));
	b.addClickHandler(new ClickHandler() {
	    public void onClick(ClickEvent event) {
		new ImportFromSpiceDialog();
	    }
	});
	hp.add(b = new Button(Locale.LS("Close")));
	b.addClickHandler(new ClickHandler() {
	    public void onClick(ClickEvent event) {
		closeDialog();
	    }
	});

	refresh();
	// the list changes when a model is edited, renamed, deleted or imported in another dialog
	refreshTimer = new Timer() {
	    public void run() {
		if (lastSeq1 != CustomCompositeModel.sequenceNumber || lastSeq2 != UserModelLibrary.sequenceNumber)
		    refresh();
	    }
	};
	refreshTimer.scheduleRepeating(500);
	center();
	show();
    }

    public void closeDialog() {
	refreshTimer.cancel();
	super.closeDialog();
    }

    static int getGroup(CustomCompositeModel m) {
	String s = m.symbol;
	if (s == null)
	    return GROUP_SUBCIRCUIT;
	if (s.equals(SubcircuitSymbolElm.SYM_OPAMP))
	    return GROUP_OPAMP;
	if (s.equals("diode"))
	    return GROUP_DIODE;
	if (s.equals("npn") || s.equals("pnp"))
	    return GROUP_BJT;
	return GROUP_MOSFET;
    }

    static int getGroup(UserModelLibrary.Entry e) {
	if (e.type.equals("d"))
	    return GROUP_DIODE;
	if (e.type.equals("npn") || e.type.equals("pnp"))
	    return GROUP_BJT;
	if (e.type.endsWith("jf"))
	    return GROUP_JFET;
	return GROUP_MOSFET;
    }

    // models the user created or imported (not the built-in ones)
    static Vector<CustomCompositeModel> getSubcircuits() {
	Vector<CustomCompositeModel> v = new Vector<CustomCompositeModel>();
	for (CustomCompositeModel m : CustomCompositeModel.getModelList())
	    if (!m.builtin && !m.internal)
		v.add(m);
	return v;
    }

    void refresh() {
	lastSeq1 = CustomCompositeModel.sequenceNumber;
	lastSeq2 = UserModelLibrary.sequenceNumber;
	table.removeAllRows();
	Vector<CustomCompositeModel> subs = getSubcircuits();
	Vector<UserModelLibrary.Entry> entries = UserModelLibrary.getEntries();
	int row = 0;
	for (int g = 0; g != groupLabels.length; g++) {
	    boolean header = false;
	    for (CustomCompositeModel m : subs) {
		if (getGroup(m) != g)
		    continue;
		if (!header)
		    row = addHeader(row, g);
		header = true;
		row = addSubcircuitRow(row, m);
	    }
	    for (UserModelLibrary.Entry e : entries) {
		if (getGroup(e) != g)
		    continue;
		if (!header)
		    row = addHeader(row, g);
		header = true;
		row = addModelRow(row, e);
	    }
	}
	if (row == 0)
	    table.setWidget(0, 0, new Label(Locale.LS("No imported models.")));
    }

    int addHeader(int row, int g) {
	Label l = new Label(Locale.LS(groupLabels[g]));
	l.getElement().getStyle().setFontWeight(com.google.gwt.dom.client.Style.FontWeight.BOLD);
	if (row > 0)
	    l.getElement().getStyle().setMarginTop(10, com.google.gwt.dom.client.Style.Unit.PX);
	table.setWidget(row, 0, l);
	table.getFlexCellFormatter().setColSpan(row, 0, 5);
	return row+1;
    }

    // where a subcircuit is kept
    static String getScopeText(CustomCompositeModel m) {
	if (m.isSaved())
	    return Locale.LS("Saved");
	if (CustomCompositeModel.globalModelMap.get(m.name) == m)
	    return Locale.LS("This Session");
	return Locale.LS("This Circuit");
    }

    int addSubcircuitRow(int row, final CustomCompositeModel m) {
	table.setWidget(row, 0, new Label(m.name));
	String kind = Locale.LS("Subcircuit");
	if (m.symbol != null)
	    kind += " (" + Locale.LS(SubcircuitSymbolElm.symbolLabels[SubcircuitSymbolElm.getSymbolIndex(m.symbol)]) + ")";
	table.setWidget(row, 1, new Label(kind));
	table.setWidget(row, 2, new Label(getScopeText(m)));
	Button b = new Button(Locale.LS("Modify"));
	b.addClickHandler(new ClickHandler() {
	    public void onClick(ClickEvent event) {
		EditCompositeModelDialog dlg = new EditCompositeModelDialog();
		dlg.setModel(m);
		dlg.createDialog();
		CirSim.dialogShowing = dlg;
		dlg.show();
	    }
	});
	HorizontalPanel hp = new HorizontalPanel();
	hp.add(b);
	hp.add(b = new Button(Locale.LS("Rename")));
	b.addClickHandler(new ClickHandler() {
	    public void onClick(ClickEvent event) {
		renameSubcircuit(m);
	    }
	});
	hp.add(b = new Button(Locale.LS("Delete")));
	b.addClickHandler(new ClickHandler() {
	    public void onClick(ClickEvent event) {
		if (!Window.confirm(Locale.LS("Delete model") + " " + m.name + "?"))
		    return;
		m.remove();
		UserModelLibrary.removeCategory(m.name);
		CirSim.theApp.updateModels();
		CirSim.theApp.needAnalyze();
		refresh();
	    }
	});
	table.setWidget(row, 3, hp);
	return row+1;
    }

    int addModelRow(int row, final UserModelLibrary.Entry e) {
	table.setWidget(row, 0, new Label(e.name));
	table.setWidget(row, 1, new Label(".model " + e.type.toUpperCase()));
	table.setWidget(row, 2, new Label(Locale.LS("Saved")));
	Button b = new Button(Locale.LS("Modify"));
	b.addClickHandler(new ClickHandler() {
	    public void onClick(ClickEvent event) {
		EditDialog dlg;
		if (e.model instanceof DiodeModel) {
		    DiodeModel dm = (DiodeModel) e.model;
		    if (dm.isSimple())
			dm.setForwardVoltage();
		    dlg = new EditDiodeModelDialog(dm, CirSim.theApp, null);
		    CirSim.diodeModelEditDialog = dlg;
		} else if (e.model instanceof TransistorModel) {
		    dlg = new EditTransistorModelDialog((TransistorModel) e.model, CirSim.theApp, null);
		    CirSim.diodeModelEditDialog = dlg;
		} else {
		    dlg = new EditMosfetModelDialog((MosfetModel) e.model, CirSim.theApp, null);
		    CirSim.mosfetModelEditDialog = dlg;
		}
		dlg.show();
	    }
	});
	HorizontalPanel hp = new HorizontalPanel();
	hp.add(b);
	hp.add(b = new Button(Locale.LS("Delete")));
	b.addClickHandler(new ClickHandler() {
	    public void onClick(ClickEvent event) {
		if (!Window.confirm(Locale.LS("Delete model") + " " + e.name + "?"))
		    return;
		UserModelLibrary.removeModel(e.name);
		refresh();
	    }
	});
	table.setWidget(row, 3, hp);
	return row+1;
    }

    // asks for the new name in a dialog of our own: window.prompt() doesn't exist in Electron
    void renameSubcircuit(final CustomCompositeModel m) {
	final TextBox box = new TextBox();
	box.setText(m.name);
	box.setWidth("250px");
	final Dialog dlg = new Dialog() {
	    boolean apply() { return renameSubcircuit(m, box.getText()); }
	};
	dlg.setText(Locale.LS("Rename"));
	VerticalPanel vp = new VerticalPanel();
	dlg.setWidget(vp);
	vp.add(new Label(Locale.LS("New name for") + " " + m.name));
	vp.add(box);
	HorizontalPanel hp = new HorizontalPanel();
	hp.addStyleName("topSpace");
	vp.add(hp);
	Button b;
	hp.add(b = new Button(Locale.LS("OK")));
	b.addClickHandler(new ClickHandler() {
	    public void onClick(ClickEvent event) { dlg.enterPressed(); }
	});
	hp.add(b = new Button(Locale.LS("Cancel")));
	b.addClickHandler(new ClickHandler() {
	    public void onClick(ClickEvent event) { dlg.closeDialog(); }
	});
	CirSim.dialogShowing = dlg;
	dlg.center();
	dlg.show();
	box.setFocus(true);
	box.selectAll();
    }

    // false if the name can't be used (the dialog then stays open)
    boolean renameSubcircuit(CustomCompositeModel m, String newName) {
	newName = newName.trim();
	if (newName.length() == 0 || newName.equals(m.name))
	    return true;
	if (CustomCompositeModel.getModelWithName(newName) != null) {
	    Window.alert(Locale.LS("A model with this name already exists."));
	    return false;
	}
	String oldName = m.name;
	boolean saved = m.isSaved();
	if (saved)
	    m.setSaved(false);
	m.setName(newName);
	if (saved)
	    m.setSaved(true);
	UserModelLibrary.renameCategory(oldName, newName);

	// keep the elements using it
	for (CircuitElm ce : CirSim.theApp.elmList) {
	    if (ce instanceof CustomCompositeElm && ((CustomCompositeElm) ce).modelName.equals(oldName))
		((CustomCompositeElm) ce).modelName = newName;
	    if (ce instanceof SubcircuitSymbolElm && ((SubcircuitSymbolElm) ce).modelName.equals(oldName))
		((SubcircuitSymbolElm) ce).modelName = newName;
	    if (ce instanceof OpAmpRealElm && oldName.equals(((OpAmpRealElm) ce).subcircuitName))
		((OpAmpRealElm) ce).subcircuitName = newName;
	}
	if (oldName.equals(CustomCompositeElm.lastModelName))
	    CustomCompositeElm.lastModelName = newName;
	CirSim.theApp.updateModels();
	CirSim.theApp.needAnalyze();
	refresh();
	return true;
    }
}
