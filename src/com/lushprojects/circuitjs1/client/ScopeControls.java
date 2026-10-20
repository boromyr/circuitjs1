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

import com.google.gwt.event.dom.client.ChangeEvent;
import com.google.gwt.event.dom.client.ClickEvent;
import com.google.gwt.event.dom.client.ClickHandler;
import com.google.gwt.event.dom.client.ChangeHandler;
import com.google.gwt.event.dom.client.MouseOutEvent;
import com.google.gwt.event.dom.client.MouseOutHandler;
import com.google.gwt.event.dom.client.MouseOverEvent;
import com.google.gwt.event.dom.client.MouseOverHandler;
import com.google.gwt.event.logical.shared.ValueChangeEvent;
import com.google.gwt.event.logical.shared.ValueChangeHandler;
import com.google.gwt.user.client.Command;
import com.google.gwt.user.client.ui.Button;
import com.google.gwt.user.client.ui.CheckBox;
import com.google.gwt.user.client.ui.Composite;
import com.google.gwt.user.client.ui.HorizontalPanel;
import com.google.gwt.user.client.ui.Label;
import com.google.gwt.user.client.ui.ListBox;
import com.google.gwt.user.client.ui.VerticalPanel;
import com.lushprojects.circuitjs1.client.util.Locale;

// quick controls at the bottom of the side panel for the horizontal and vertical scale
// (and the trigger, in manual scale mode) of the active scope, so they can be changed
// without opening the scope properties
public class ScopeControls extends Composite {

    // horizontal slider: scope speeds (sim timesteps per pixel), four steps per doubling over
    // the same 1..1024 range as the properties dialog
    static final int speeds[] = {
	1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112, 128,
	160, 192, 224, 256, 320, 384, 448, 512, 640, 768, 896, 1024
    };
    static final int H_STEPS = speeds.length;
    // vertical slider: 1-2-5 sequence of units/div from Scope.MIN_MAN_SCALE (1n) to 500
    static final int V_STEPS = 36;
    static final double seq125[] = { 1, 2, 5 };
    // trigger level slider resolution: steps per division
    static final int TRIG_STEPS_PER_DIV = 10;

    CirSim sim;
    VerticalPanel panel;
    Label titleLabel, hValueLabel, vValueLabel;
    Scrollbar hBar, vBar;
    ListBox channelBox;
    CheckBox autoBox;
    HorizontalPanel vOptionsRow;
    VerticalPanel trigPanel;
    Label trigValueLabel;
    ListBox trigModeBox;
    Button trigEdgeButton;
    Scrollbar trigBar;

    Scope scope;            // scope the controls currently refer to
    int channel;            // visible plot controlled by the vertical slider
    String channelSignature = "";
    boolean updating;       // set while syncing widgets from the scope, so their handlers do nothing
    boolean hover;          // mouse is over the controls; highlight the scope they act on
    int lastHeight;

    ScopeControls(CirSim sim) {
	this.sim = sim;
	panel = new VerticalPanel();
	panel.addStyleName("scopeControls");

	titleLabel = new Label();
	titleLabel.addStyleName("scopeControlsTitle");
	titleLabel.setWidth((UIManager.VERTICALPANELWIDTH-8) + "px");
	panel.add(titleLabel);

	hValueLabel = new Label();
	panel.add(makeRow(Locale.LS("Horizontal Scale"), hValueLabel));
	hBar = new Scrollbar(Scrollbar.HORIZONTAL, speedToIndex(64), 1, 0, H_STEPS, new Command() {
	    public void execute() { hBarChanged(); }
	});
	panel.add(hBar);

	vValueLabel = new Label();
	panel.add(makeRow(Locale.LS("Vertical Scale"), vValueLabel));
	vBar = new Scrollbar(Scrollbar.HORIZONTAL, 0, 1, 0, V_STEPS, new Command() {
	    public void execute() { vBarChanged(); }
	});
	panel.add(vBar);

	vOptionsRow = new HorizontalPanel();
	vOptionsRow.addStyleName("scopeControlsRow");
	channelBox = new ListBox();
	channelBox.addStyleName("scopeControlsChannel");
	channelBox.addChangeHandler(new ChangeHandler() {
	    public void onChange(ChangeEvent e) {
		if (updating)
		    return;
		channel = channelBox.getSelectedIndex();
		refresh();
	    }
	});
	vOptionsRow.add(channelBox);
	autoBox = new CheckBox(Locale.LS("Auto"));
	autoBox.addValueChangeHandler(new ValueChangeHandler<Boolean>() {
	    public void onValueChange(ValueChangeEvent<Boolean> e) {
		if (updating || scope == null)
		    return;
		if (e.getValue())
		    scope.setManualScale(false, false);
		else
		    scope.setManualScale(true, true);
		refresh();
		sim.repaint();
	    }
	});
	vOptionsRow.add(autoBox);
	panel.add(vOptionsRow);

	// trigger, only shown in manual scale mode, where the level slider has a fixed range
	trigPanel = new VerticalPanel();
	trigValueLabel = new Label();
	trigPanel.add(makeRow(Locale.LS("Trigger"), trigValueLabel));
	HorizontalPanel trigOptionsRow = new HorizontalPanel();
	trigOptionsRow.addStyleName("scopeControlsRow");
	trigModeBox = new ListBox();
	trigModeBox.addStyleName("scopeControlsChannel");
	// same order as the ScopeTrigger.TRIGGER_* constants
	trigModeBox.addItem(Locale.LS("Free Run"));
	trigModeBox.addItem(Locale.LS("Normal"));
	trigModeBox.addItem(Locale.LS("Auto"));
	trigModeBox.addChangeHandler(new ChangeHandler() {
	    public void onChange(ChangeEvent e) {
		if (updating || scope == null)
		    return;
		scope.setTriggerMode(trigModeBox.getSelectedIndex());
		refresh();
		sim.repaint();
	    }
	});
	trigOptionsRow.add(trigModeBox);
	trigEdgeButton = new Button();
	trigEdgeButton.addStyleName("scopeControlsEdge");
	trigEdgeButton.addClickHandler(new ClickHandler() {
	    public void onClick(ClickEvent e) {
		if (scope == null)
		    return;
		scope.trigger.edge = (scope.trigger.edge == ScopeTrigger.TRIGGER_EDGE_RISING) ?
			ScopeTrigger.TRIGGER_EDGE_FALLING : ScopeTrigger.TRIGGER_EDGE_RISING;
		scope.resetGraph();
		refresh();
		sim.repaint();
	    }
	});
	trigOptionsRow.add(trigEdgeButton);
	trigPanel.add(trigOptionsRow);
	trigBar = new Scrollbar(Scrollbar.HORIZONTAL, 0, 1, 0, 81, new Command() {
	    public void execute() { trigBarChanged(); }
	});
	trigPanel.add(trigBar);
	panel.add(trigPanel);

	panel.addDomHandler(new MouseOverHandler() {
	    public void onMouseOver(MouseOverEvent e) { setHover(true); }
	}, MouseOverEvent.getType());
	panel.addDomHandler(new MouseOutHandler() {
	    public void onMouseOut(MouseOutEvent e) { setHover(false); }
	}, MouseOutEvent.getType());

	initWidget(panel);
	setVisible(false);
    }

    // a line with a caption on the left and the current value on the right
    HorizontalPanel makeRow(String caption, Label value) {
	HorizontalPanel row = new HorizontalPanel();
	row.addStyleName("scopeControlsRow");
	row.setWidth((UIManager.VERTICALPANELWIDTH-8) + "px");
	Label cap = new Label(caption);
	row.add(cap);
	value.addStyleName("scopeControlsValue");
	row.add(value);
	row.setCellHorizontalAlignment(value, HorizontalPanel.ALIGN_RIGHT);
	return row;
    }

    void setHover(boolean h) {
	if (hover == h)
	    return;
	hover = h;
	sim.repaint();
    }

    static double vIndexToScale(int n) {
	return Scope.MIN_MAN_SCALE * Math.pow(10, n/3) * seq125[n%3];
    }

    static int vScaleToIndex(double v) {
	int best = 0;
	double bestDist = Double.MAX_VALUE;
	if (!(v > 0))
	    return best;
	for (int n = 0; n != V_STEPS; n++) {
	    double d = Math.abs(Math.log(v/vIndexToScale(n)));
	    if (d < bestDist) {
		bestDist = d;
		best = n;
	    }
	}
	return best;
    }

    // nearest slider position for a speed (it may have been set elsewhere, eg the mouse wheel)
    static int speedToIndex(int speed) {
	int best = 0;
	for (int i = 1; i != H_STEPS; i++)
	    if (Math.abs(Math.log((double) speeds[i]/speed)) < Math.abs(Math.log((double) speeds[best]/speed)))
		best = i;
	return best;
    }

    void hBarChanged() {
	if (updating || scope == null)
	    return;
	sim.scopeManager.setScopeSpeed(scope, speeds[hBar.getValue()]);
	refresh();
	sim.repaint();
    }

    void vBarChanged() {
	if (updating || scope == null || channel >= scope.visiblePlots.size())
	    return;
	if (!scope.isManualScale())
	    scope.setManualScale(true, true);
	scope.setManualScaleValue(channel, vIndexToScale(vBar.getValue()));
	refresh();
	sim.repaint();
    }

    // the trigger watches the first visible plot; its level slider covers the visible
    // range of that plot, in steps of 1/TRIG_STEPS_PER_DIV of a division
    double trigPositionOffset(ScopePlot p) {
	return scope.getGridMaxFromManScale(p)*2.0*p.manVPosition/Scope.V_POSITION_STEPS;
    }

    double trigPosToLevel(ScopePlot p, int pos) {
	return ((double) pos/TRIG_STEPS_PER_DIV - scope.manDivisions/2.0)*p.manScale - trigPositionOffset(p);
    }

    int trigLevelToPos(ScopePlot p, double level) {
	return (int) Math.round(((level + trigPositionOffset(p))/p.manScale + scope.manDivisions/2.0)*TRIG_STEPS_PER_DIV);
    }

    void trigBarChanged() {
	if (updating || scope == null || scope.visiblePlots.size() == 0)
	    return;
	ScopePlot p = scope.visiblePlots.get(0);
	double level = trigPosToLevel(p, trigBar.getValue());
	// avoid rounding noise like 1.0000000002
	scope.trigger.level = Math.round(level/p.manScale*1e6)*p.manScale/1e6;
	refresh();
	sim.repaint();
    }

    String getScopeTitle(Scope s) {
	ScopeManager sm = sim.scopeManager;
	String t = null;
	for (int i = 0; i != sm.scopeCount; i++)
	    if (sm.scopes[i] == s)
		t = Locale.LS("Scope") + " " + (i+1);
	if (t == null && sim.scopeElmArr != null)
	    for (int i = 0; i != sim.scopeElmArr.length; i++)
		if (sim.scopeElmArr[i].elmScope == s)
		    t = Locale.LS("Undocked Scope") + " " + (i+1);
	if (t == null)
	    t = Locale.LS("Scope");
	String l = s.getScopeLabelOrText();
	if (l != null && l.length() > 0)
	    t += " (" + l + ")";
	return t;
    }

    // move a slider to show the scope's current setting, unless the user is dragging it
    static void setBar(Scrollbar bar, int v) {
	if (!bar.dragging && bar.getValue() != v)
	    bar.setValue(v);
    }

    static void setText(Label l, String s) {
	if (!s.equals(l.getText()))
	    l.setText(s);
    }

    // called every frame: follow the active scope and keep the widgets in sync with it
    // (its scales can also change from the mouse wheel, the properties dialog, etc.)
    void refresh() {
	Scope s = sim.scopeManager.getActiveScope();
	if (s != scope) {
	    scope = s;
	    channel = 0;
	    channelSignature = "";
	}
	boolean vis = (scope != null);
	if (vis != isVisible()) {
	    setVisible(vis);
	    if (!vis) {
		hover = false;
		sim.setiFrameHeight();
	    }
	}
	if (scope == null)
	    return;
	boolean layoutChanged = false;

	updating = true;
	setText(titleLabel, getScopeTitle(scope));

	setBar(hBar, speedToIndex(scope.speed));
	setText(hValueLabel, CircuitElm.getUnitText(scope.calcGridStepX(), "s") + "/div");

	// channel list: rebuild only when the visible plots change
	int n = scope.visiblePlots.size();
	String sig = "";
	for (int i = 0; i != n; i++)
	    sig += scope.visiblePlots.get(i).units + ",";
	if (!sig.equals(channelSignature)) {
	    channelSignature = sig;
	    channelBox.clear();
	    for (int i = 0; i != n; i++)
		channelBox.addItem("CH " + (i+1) + " (" + Scope.getScaleUnitsText(scope.visiblePlots.get(i).units) + ")");
	    channelBox.setVisible(n > 1);
	    layoutChanged = true;
	}
	if (channel >= n)
	    channel = 0;
	if (n > 0 && channelBox.getSelectedIndex() != channel)
	    channelBox.setSelectedIndex(channel);

	boolean manual = scope.isManualScale();
	if (autoBox.getValue() != !manual)
	    autoBox.setValue(!manual);
	if (n == 0) {
	    // e.g. X-Y mode, which has no per-channel scale
	    if (vBar.enabled)
		vBar.disable();
	    autoBox.setEnabled(false);
	    setText(vValueLabel, "-");
	} else {
	    if (!vBar.enabled)
		vBar.enable();
	    autoBox.setEnabled(true);
	    ScopePlot p = scope.visiblePlots.get(channel);
	    double v = manual ? p.manScale : scope.getManScaleFromMaxScale(p.units, true);
	    setBar(vBar, vScaleToIndex(v));
	    String units = Scope.getScaleUnitsText(p.units);
	    setText(vValueLabel, manual ? CircuitElm.getUnitText(p.manScale, units) + "/div" : Locale.LS("Auto"));
	}

	// trigger section
	boolean trigVis = manual && n > 0;
	if (trigVis != trigPanel.isVisible()) {
	    trigPanel.setVisible(trigVis);
	    layoutChanged = true;
	}
	if (trigVis) {
	    ScopeTrigger t = scope.trigger;
	    if (trigModeBox.getSelectedIndex() != t.mode)
		trigModeBox.setSelectedIndex(t.mode);
	    boolean rising = (t.edge == ScopeTrigger.TRIGGER_EDGE_RISING);
	    String edgeText = rising ? "\u2191 " + Locale.LS("Rising") : "\u2193 " + Locale.LS("Falling");
	    if (!edgeText.equals(trigEdgeButton.getText()))
		trigEdgeButton.setText(edgeText);
	    boolean active = t.isActive();
	    trigEdgeButton.setVisible(active);
	    if (active != trigBar.isVisible()) {
		trigBar.setVisible(active);
		layoutChanged = true;
	    }
	    ScopePlot p0 = scope.visiblePlots.get(0);
	    if (active) {
		int steps = scope.manDivisions*TRIG_STEPS_PER_DIV;
		if (trigBar.max != steps) {
		    trigBar.max = steps;
		    trigBar.draw();
		}
		setBar(trigBar, Math.max(0, Math.min(steps, trigLevelToPos(p0, t.level))));
		setText(trigValueLabel, (n > 1 ? "CH 1: " : "") + CircuitElm.getUnitText(t.level, Scope.getScaleUnitsText(p0.units)));
	    } else
		setText(trigValueLabel, Locale.LS("Free Run"));
	}
	updating = false;

	// our height may have changed, so resize the iframe above us to keep everything on screen
	int h = getOffsetHeight();
	if (layoutChanged || h != lastHeight) {
	    lastHeight = h;
	    sim.setiFrameHeight();
	}
    }

    boolean highlightScope(Scope s) {
	return hover && s == scope;
    }
}
