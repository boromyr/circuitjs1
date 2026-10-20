package com.lushprojects.circuitjs1.client;

import com.google.gwt.core.client.JavaScriptObject;
import com.google.gwt.core.client.JsArray;

public class JSInterface {

    CirSim app;

    JSInterface(CirSim app) {
	this.app = app;
    }

    void setExtVoltage(String name, double v) {
	int i;
	for (i = 0; i != app.elmList.size(); i++) {
	    CircuitElm ce = app.getElm(i);
	    if (ce instanceof ExtVoltageElm) {
		ExtVoltageElm eve = (ExtVoltageElm) ce;
		if (eve.getName().equals(name))
		    eve.setVoltage(v);
	    }
	}
    }

    native JsArray<JavaScriptObject> getJSArray() /*-{ return []; }-*/;

    JsArray<JavaScriptObject> getJSElements() {
	int i;
	JsArray<JavaScriptObject> arr = getJSArray();
	for (i = 0; i != app.elmList.size(); i++) {
	    CircuitElm ce = app.getElm(i);
	    ce.addJSMethods();
	    arr.push(ce.getJavaScriptObject());
	}
	return arr;
    }

    double getLabeledNodeVoltage(String name) { return app.sim.getLabeledNodeVoltage(name); }

    // Delegate methods for JSNI access
    void setSimRunning(boolean run) { app.setSimRunning(run); }
    boolean simIsRunning() { return app.simIsRunning(); }
    void doExportAsSVGFromAPI() { app.imageExporter.doExportAsSVGFromAPI(); }
    String dumpCircuit() { return app.dumpCircuit(); }
    void importCircuitFromText(String t, boolean s) { app.importCircuitFromText(t, s); }
    double getTime() { return app.sim.t; }
    double getTimeStep() { return app.sim.timeStep; }
    void setTimeStep(double ts) { app.sim.timeStep = ts; }
    double getMaxTimeStep() { return app.sim.maxTimeStep; }
    String getACTargets() { return app.sim.acAnalysis.getTargetsJSON(); }
    String acSweep(String src, String out, double fmin, double fmax, int n) { return app.sim.acAnalysis.sweepJSON(src, out, fmin, fmax, n); }
    boolean fftSelect(String out, int n) { return app.sim.fftCapture.select(out, n); }
    JavaScriptObject fftSamples() { return app.sim.fftCapture.samples(); }
    void fftClear() { app.sim.fftCapture.clear(); }
    void fftStop() { app.sim.fftCapture.stop(); }
    JavaScriptObject fftStatus() { return app.sim.fftCapture.status(); }
    void fftSetFast(boolean f) { app.sim.fftCapture.fast = f; }
    void setMaxTimeStep(double ts) { app.sim.maxTimeStep = app.sim.timeStep = ts; }

    native void setupJSInterface() /*-{
	var that = this;
	$wnd.CircuitJS1 = {
	    setSimRunning: $entry(function(run) { that.@com.lushprojects.circuitjs1.client.JSInterface::setSimRunning(Z)(run); } ),
	    getTime: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::getTime()(); } ),
	    getTimeStep: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::getTimeStep()(); } ),
	    setTimeStep: $entry(function(ts) { that.@com.lushprojects.circuitjs1.client.JSInterface::setTimeStep(D)(ts); } ), // don't use this, see #843
	    getMaxTimeStep: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::getMaxTimeStep()(); } ),
	    setMaxTimeStep: $entry(function(ts) { that.@com.lushprojects.circuitjs1.client.JSInterface::setMaxTimeStep(D)(ts); } ),
	    isRunning: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::simIsRunning()(); } ),
	    getNodeVoltage: $entry(function(n) { return that.@com.lushprojects.circuitjs1.client.JSInterface::getLabeledNodeVoltage(Ljava/lang/String;)(n); } ),
	    setExtVoltage: $entry(function(n, v) { that.@com.lushprojects.circuitjs1.client.JSInterface::setExtVoltage(Ljava/lang/String;D)(n, v); } ),
	    getElements: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::getJSElements()(); } ),
	    getCircuitAsSVG: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::doExportAsSVGFromAPI()(); } ),
	    exportCircuit: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::dumpCircuit()(); } ),
	    importCircuit: $entry(function(circuit, subcircuitsOnly) { return that.@com.lushprojects.circuitjs1.client.JSInterface::importCircuitFromText(Ljava/lang/String;Z)(circuit, subcircuitsOnly); }),
	    // small-signal frequency response, used by bodeplot.js (results are JSON strings, see ACAnalysis)
	    getACTargets: $entry(function() { return JSON.parse(that.@com.lushprojects.circuitjs1.client.JSInterface::getACTargets()()); }),
	    acSweep: $entry(function(src, out, fmin, fmax, n) { return JSON.parse(that.@com.lushprojects.circuitjs1.client.JSInterface::acSweep(Ljava/lang/String;Ljava/lang/String;DDI)(src, out, fmin, fmax, n)); }),
	    // voltage of an output recorded at every time step, used by fftplot.js (see FFTCapture)
	    fftSelect: $entry(function(out, n) { return that.@com.lushprojects.circuitjs1.client.JSInterface::fftSelect(Ljava/lang/String;I)(out, n); }),
	    fftSamples: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::fftSamples()(); }),
	    fftClear: $entry(function() { that.@com.lushprojects.circuitjs1.client.JSInterface::fftClear()(); }),
	    fftStop: $entry(function() { that.@com.lushprojects.circuitjs1.client.JSInterface::fftStop()(); }),
	    fftStatus: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::fftStatus()(); }),
	    fftSetFast: $entry(function(f) { that.@com.lushprojects.circuitjs1.client.JSInterface::fftSetFast(Z)(!!f); })
	};
	var hook = $wnd.oncircuitjsloaded;
	if (hook)
	    hook($wnd.CircuitJS1);
    }-*/;

    native void callUpdateHook() /*-{
	var hook = $wnd.CircuitJS1.onupdate;
	if (hook)
	    hook($wnd.CircuitJS1);
    }-*/;

    native void callAnalyzeHook() /*-{
	var hook = $wnd.CircuitJS1.onanalyze;
	if (hook)
	    hook($wnd.CircuitJS1);
    }-*/;

    native void callTimeStepHook() /*-{
	var hook = $wnd.CircuitJS1.ontimestep;
	if (hook)
	    hook($wnd.CircuitJS1);
    }-*/;

    native void callSVGRenderedHook(String svgData) /*-{
	var hook = $wnd.CircuitJS1.onsvgrendered;
	if (hook)
	    hook($wnd.CircuitJS1, svgData);
    }-*/;
}
