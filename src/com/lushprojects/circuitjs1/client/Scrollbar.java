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

import com.google.gwt.canvas.client.Canvas;
import com.google.gwt.user.client.ui.Composite;
import com.google.gwt.user.client.ui.VerticalPanel;
import com.google.gwt.canvas.dom.client.Context2d;
import com.google.gwt.event.dom.client.ClickHandler;
import com.google.gwt.event.dom.client.ClickEvent;
import com.google.gwt.event.dom.client.MouseDownHandler;
import com.google.gwt.event.dom.client.MouseDownEvent;
import com.google.gwt.event.dom.client.MouseMoveHandler;
import com.google.gwt.event.dom.client.MouseMoveEvent;
import com.google.gwt.event.dom.client.MouseUpHandler;
import com.google.gwt.event.dom.client.MouseUpEvent;
import com.google.gwt.event.dom.client.MouseOutEvent;
import com.google.gwt.event.dom.client.MouseOutHandler;
import com.google.gwt.event.dom.client.MouseOverEvent;
import com.google.gwt.event.dom.client.MouseOverHandler;
import com.google.gwt.user.client.Command;
import com.google.gwt.user.client.Event;
import com.google.gwt.dom.client.NativeEvent;
import com.google.gwt.dom.client.Touch;
import com.google.gwt.event.dom.client.MouseWheelEvent;
import com.google.gwt.event.dom.client.MouseWheelHandler;
import com.google.gwt.event.dom.client.TouchCancelEvent;
import com.google.gwt.event.dom.client.TouchCancelHandler;
import com.google.gwt.event.dom.client.TouchEndEvent;
import com.google.gwt.event.dom.client.TouchEndHandler;
import com.google.gwt.event.dom.client.TouchMoveEvent;
import com.google.gwt.event.dom.client.TouchMoveHandler;
import com.google.gwt.event.dom.client.TouchStartEvent;
import com.google.gwt.event.dom.client.TouchStartHandler;


public class Scrollbar extends  Composite implements 
	ClickHandler, MouseDownHandler, MouseMoveHandler, MouseUpHandler, MouseOutHandler, MouseOverHandler,
	MouseWheelHandler, TouchStartHandler, TouchCancelHandler, TouchEndHandler, TouchMoveHandler {
	
	static int HORIZONTAL =1;
	static int HMARGIN=2;
	static int SCROLLHEIGHT=22;
	static int ARROWWIDTH=12;	// clickable step area at each end
	static int TRACKWIDTH=4;
	static int THUMBRADIUS=9;	// outer ring of the thumb
	static int DOTRADIUS=5;		// accent dot inside the thumb (grows on hover, shrinks when pressed)

	// colors, overridable by the page stylesheet (see dark-theme.css); defaults follow the
	// Windows 11 light theme
	static String fgColor, disabledColor, trackColor, barColor, thumbColor, thumbBorderColor;

	static void loadColors() {
		if (fgColor != null)
			return;
		fgColor          = getCssColor("--cirjs-scrollbar-fg", "#5d5d5d");
		disabledColor    = getCssColor("--cirjs-scrollbar-disabled", "#c4c4c4");
		trackColor       = getCssColor("--cirjs-scrollbar-track", "#8a8a8a");
		barColor         = getCssColor("--cirjs-scrollbar-bar", "#005fb8");
		thumbColor       = getCssColor("--cirjs-scrollbar-thumb", "#ffffff");
		thumbBorderColor = getCssColor("--cirjs-scrollbar-thumb-border", "#d6d6d6");
	}

	static native double devicePixelRatio() /*-{
		return $wnd.devicePixelRatio || 1;
	}-*/;

	static native String getCssColor(String name, String def) /*-{
		var v = $wnd.getComputedStyle($doc.documentElement).getPropertyValue(name);
		v = v ? v.trim() : "";
		return v.length > 0 ? v : def;
	}-*/;

	Canvas can;
	VerticalPanel pan;
	Context2d g;
	int min;
	int max;
	int val;
	double stepSize; // step size in scrollbar units (0 = continuous)
	boolean dragging=false;
	boolean hover=false;
	boolean enabled=true;
	double pixelRatio;
	Command command=null;
	CircuitElm attachedElm=null;
	int VERTICALPANELWIDTH;

	public Scrollbar(int orientation, int value, int visible, int minimum, int maximum) {
		VERTICALPANELWIDTH = UIManager.VERTICALPANELWIDTH;
		min=minimum;
		max=maximum-1;
		val=value;
		 pan = new VerticalPanel();
		can = Canvas.createIfSupported();
		can.setWidth(VERTICALPANELWIDTH+"px");
		can.setHeight(SCROLLHEIGHT+"px");
		pan.add(can);
		g=can.getContext2d();
		loadColors();
		can.addClickHandler( this);
		can.addMouseDownHandler(this);
		can.addMouseUpHandler(this);
		can.addMouseMoveHandler(this);
		can.addMouseOutHandler(this);
		can.addMouseOverHandler(this);
		can.addMouseWheelHandler(this);
		
		// our hack from CirSim doesn't work here so we have to handle touch events explicitly
		can.addTouchStartHandler(this);
		can.addTouchMoveHandler(this);
		can.addTouchEndHandler(this);
		can.addTouchCancelHandler(this);
		
		this.draw();
		initWidget(pan);
	}
	
	public Scrollbar(int orientation, int value, int visible, int minimum, int maximum, 
			Command cmd, CircuitElm e) {
		this(orientation,value,visible,minimum,maximum);
		this.command=cmd;
		attachedElm=e;
	}
	
	public Scrollbar(int orientation, int value, int visible, int minimum, int maximum, Command cmd) {
		this(orientation, value, visible, minimum, maximum);
		this.command=cmd;
	}
	
	// x range travelled by the thumb centre
	int trackStart() { return HMARGIN+ARROWWIDTH+THUMBRADIUS; }
	int trackEnd() { return VERTICALPANELWIDTH-HMARGIN-ARROWWIDTH-THUMBRADIUS; }

	void draw() {
		// draw in CSS pixels on a backing store at device resolution, so it stays sharp
		// with display scaling; re-checked on every draw since browser zoom changes it
		double ratio = devicePixelRatio();
		if (ratio != pixelRatio) {
			pixelRatio = ratio;
			can.setCoordinateSpaceWidth((int) Math.round(VERTICALPANELWIDTH*ratio));
			can.setCoordinateSpaceHeight((int) Math.round(SCROLLHEIGHT*ratio));
		}
		g.setTransform(ratio, 0, 0, ratio, 0, 0);
		g.clearRect(0, 0, VERTICALPANELWIDTH, SCROLLHEIGHT);
		g.setLineCap("round");
		g.setLineJoin("round");
		double cy = SCROLLHEIGHT/2.0;

		// step chevrons
		g.setStrokeStyle(enabled ? fgColor : disabledColor);
		g.setLineWidth(1.5);
		g.beginPath();
		double ax = HMARGIN+ARROWWIDTH/2.0;
		g.moveTo(ax+2, cy-4);
		g.lineTo(ax-2, cy);
		g.lineTo(ax+2, cy+4);
		ax = VERTICALPANELWIDTH-HMARGIN-ARROWWIDTH/2.0;
		g.moveTo(ax-2, cy-4);
		g.lineTo(ax+2, cy);
		g.lineTo(ax-2, cy+4);
		g.stroke();

		// track, with the part up to the thumb filled in the accent color
		int x0 = trackStart(), x1 = trackEnd();
		double p = x0+((x1-x0)*((double)(val-min)))/(max-min);
		g.setLineWidth(TRACKWIDTH);
		g.setStrokeStyle(enabled ? trackColor : disabledColor);
		g.beginPath();
		g.moveTo(p, cy);
		g.lineTo(x1, cy);
		g.stroke();
		String accent = disabledColor;
		if (enabled)
			accent = (attachedElm!=null && attachedElm.needsHighlight()) ? CircuitElm.selectColor.getHexValue() : barColor;
		g.setStrokeStyle(accent);
		g.beginPath();
		g.moveTo(x0, cy);
		g.lineTo(p, cy);
		g.stroke();

		// thumb: a ring in the control color around an accent dot
		g.setFillStyle(thumbBorderColor);
		g.beginPath();
		g.arc(p, cy, THUMBRADIUS, 0, 2*Math.PI);
		g.fill();
		g.setFillStyle(thumbColor);
		g.beginPath();
		g.arc(p, cy, THUMBRADIUS-1, 0, 2*Math.PI);
		g.fill();
		double dot = !enabled ? DOTRADIUS : dragging ? DOTRADIUS-1 : hover ? DOTRADIUS+1.5 : DOTRADIUS;
		g.setFillStyle(accent);
		g.beginPath();
		g.arc(p, cy, dot, 0, 2*Math.PI);
		g.fill();
	}

	int calcValueFromPos(int x){
		int v;
		int x0 = trackStart(), x1 = trackEnd();
		v= min+(int) Math.round((max-min)*((double)(x-x0))/(x1-x0));
		if (v<min)
			v=min;
		if (v>max)
			v=max;
		return snapToStep(v);
	}

	int snapToStep(int v) {
		if (stepSize > 0) {
			v = (int) (Math.round((v - min) / stepSize) * stepSize) + min;
			if (v < min) v = min;
			if (v > max) v = max;
		}
		return v;
	}

	void setStepSize(double step) {
		stepSize = step;
	}
	
	public void onMouseDown(MouseDownEvent e){
//		GWT.log("Down");
		dragging=false;
		e.preventDefault();
		doMouseDown(e.getX(), true);
	}
	
	void doMouseDown(int x, boolean mouse) {
	    if (enabled){
		int step = (stepSize > 0) ? Math.max(1, (int) Math.round(stepSize)) : 1;
		if (x < HMARGIN+ARROWWIDTH ) {
		    val = snapToStep(Math.max(min, val - step));
		}
		else {
		    if (x > VERTICALPANELWIDTH-HMARGIN-ARROWWIDTH ) {
			val = snapToStep(Math.min(max, val + step));
		    }
		    else {
			val=calcValueFromPos(x);	
			dragging=true;
			
			// setCapture doesn't work on touch for some reason; touchend/touchmoved events
			// don't get sent
			if (mouse)
			    Event.setCapture(can.getElement());
		    }
		}
		draw();
		if (command!=null)
		    command.execute();
	    }
	}
	
	native boolean noButtonsDown(NativeEvent e) /*-{
	    return e.buttons == 0;
	}-*/;
	
	public void onMouseMove(MouseMoveEvent e){
//		GWT.log("Move");
		e.preventDefault();
		
		// we don't always get the mouse up event so make sure the button is still down
		if (dragging && noButtonsDown(e.getNativeEvent())) {
		    Event.releaseCapture(can.getElement());
		    dragging = false;
		    draw();
		    return;
		}
		doMouseMove(e.getX());
	}
	
	void doMouseMove(int x) {
	    if (enabled) {
		if (dragging) {
		    val=calcValueFromPos(x);	
		    draw();
		    if (command!=null)
			command.execute();
		}
	    }
	}
	
	public void onMouseUp(MouseUpEvent e){
//		GWT.log("Up");
		e.preventDefault();
		Event.releaseCapture(can.getElement());
		if (enabled && dragging) {
			val=calcValueFromPos(e.getX());
			dragging=false;
			// released outside: the mouseout was skipped while dragging
			hover = e.getX() >= 0 && e.getX() < VERTICALPANELWIDTH && e.getY() >= 0 && e.getY() < SCROLLHEIGHT;
			draw();
			if (command!=null)
				command.execute();
		}
	}
	
	public void onMouseOut(MouseOutEvent e){
//		GWT.log("Out");
//		e.preventDefault();
	    	if (dragging)
	    	    return;
		hover = false;
		draw();
		if (enabled && attachedElm!=null && attachedElm.isMouseElm())
			CirSim.theApp.mouse.setMouseElm(null);
	}

	public void onMouseOver(MouseOverEvent e){
		hover = true;
		draw();
		if (enabled && attachedElm!=null)
			 CirSim.theApp.mouse.setMouseElm(attachedElm);
	}
	
	// one step every mouse notch (3 units); a touchpad's small steps add up
	double wheelSteps;

	public void onMouseWheel(MouseWheelEvent e) {
		e.preventDefault();
		if (!enabled)
			return;
		wheelSteps += MouseManager.wheelDeltaY(e)/3;
		int n = (int) wheelSteps;
		if (n != 0) {
			wheelSteps -= n;
			setValue(val+n);
		}
	}
	
	public void onClick(ClickEvent e) {
//		GWT.log("Click");
		e.preventDefault();
//		if (e.getX()<HMARGIN+SCROLLHEIGHT ) {
//			if (val>min)
//				val--;
//		}
//		else {
//			if (e.getX()>VERTICALPANELWIDTH-HMARGIN-SCROLLHEIGHT ) {
//				if (val<max)
//					val++;
//			}
//			else {
//				val=calcValueFromPos(e.getX());			}
//		}
//		draw();
		
	}
	
	public int getValue(){
		return val;
	}
	
	public void setValue(int i){
		if (i<min)
			i=min;
		else if (i>max)
			i=max;
		val =i;
		draw();
		if (command!=null)
			command.execute();
	}
	
	public void enable() {
		enabled=true;
		draw();
	}
	
	public void disable() {
		enabled=false;
		dragging=false;
		draw();
	}

	public void onTouchMove(TouchMoveEvent e) {
//	    GWT.log("touchmove");
	    e.preventDefault();
	    Touch t = e.getTouches().get(0);
	    doMouseMove(t.getRelativeX(getElement()));
	}

	public void onTouchEnd(TouchEndEvent event) {
//	    GWT.log("touchend");;
	    event.preventDefault();
	    if (enabled && dragging) {
		dragging=false;
		draw();
		if (command!=null)
		    command.execute();
	    }
	}

	public void onTouchCancel(TouchCancelEvent event) {
//	    GWT.log("touchcancel");;
	    event.preventDefault();
	    dragging = false;
	}

	public void onTouchStart(TouchStartEvent event) {
//	    GWT.log("touchstart");
	    event.preventDefault();
	    dragging=false;
	    Touch t = event.getTouches().get(0);
	    doMouseDown(t.getRelativeX(getElement()), false);
	}
	
}
