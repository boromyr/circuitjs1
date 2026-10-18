/*
 * Bode plot (gain / phase vs. frequency) for CircuitJS1.
 *
 * The frequency response is computed by the simulator itself (ACAnalysis.java,
 * exported as CircuitJS1.getACTargets() / CircuitJS1.acSweep()): the circuit is
 * linearized at its operating point, so transistors, JFETs, op-amps and any other
 * stage after a tone stack are included.  This file only draws the result, in a
 * separate, freely movable window (window.open + about:blank, filled from here)
 * that refreshes automatically while the circuit runs or changes.
 *
 * Opened from the menu (Scopes > Bode Plot..., or Bode in the menu bar).
 */
(function () {
	'use strict';

	var WIN_NAME = 'circuitjs-bode';
	var STORE = 'bodePlot.';
	var NPOINTS = 400;
	var TRACE_COLORS = ['#27ae60', '#c0392b', '#8e44ad', '#16a085', '#d4a017', '#7f8c8d'];

	var sim = null;
	var win = null;
	var ui = null;
	var timer = null;
	var lastSrcKey = null, lastOutKey = null;
	var targets = null;     // {sources:[], outputs:[]}
	var result = null;      // {f:[], db:[], ph:[]}
	var error = null;       // error code from acSweep
	var held = [];          // frozen traces for comparison
	var hover = null;       // {x, y}
	var interval = 400, lastSweepTime = 0;

	var settings = {
		showMag: true,
		showPhase: false,
		fmin: 10,
		fmax: 100000,
		yRange: 'auto',
		offset: 0,
		source: '',
		output: ''
	};

	// ------------------------------------------------------------------
	// strings
	// ------------------------------------------------------------------

	var STRINGS = {
		en: {
			title: 'Bode Plot', mag: 'Magnitude', phase: 'Phase', input: 'Input', output: 'Output',
			freq: 'Freq.', hold: 'Hold trace', holdTip: 'Freeze the current trace to compare it with later changes',
			clear: 'Clear held', clearTip: 'Remove the held traces', csv: 'Copy CSV',
			csvTip: 'Copy the data (frequency, dB, phase) to the clipboard', none: '(none)',
			freqAxis: 'Frequency (Hz)', magAxis: 'Magnitude (dB)', phaseAxis: 'Phase (°)',
			current: 'current', trace: 'trace', copied: 'Data copied to the clipboard ({n} points).',
			popup: 'Could not open the Bode plot window (popup blocked?).',
			noSource: 'No voltage source: add one to use as the input.',
			noOutput: 'No output: add a labeled node, an Output or a voltmeter.',
			needIO: 'Needs a source as input and a labeled node as output',
			notready: 'Waiting for the circuit...', singular: 'The circuit cannot be solved',
			disconnected: 'The output is not connected to the input',
			ok: 'Small-signal AC analysis at the DC operating point (transistors, op-amps and other stages included), {n} points.',
			transient: 'No DC operating point found: using the present state of the simulation.',
			node: 'Node «{n}»', out: 'Output #{n}', probe: 'Voltmeter #{n}',
			src: { VoltageElm: 'Source', DCVoltageElm: 'Source', ACVoltageElm: 'AC source', RailElm: 'Rail',
				ACRailElm: 'AC rail', VarRailElm: 'Variable rail', SquareRailElm: 'Square rail', ClockElm: 'Clock',
				AntennaElm: 'Antenna', SweepElm: 'Sweep', AudioInputElm: 'Audio input', NoiseElm: 'Noise' }
		},
		it: {
			title: 'Diagramma di Bode', mag: 'Modulo', phase: 'Fase', input: 'Ingresso', output: 'Uscita',
			freq: 'Freq.', hold: 'Fissa curva', holdTip: 'Congela la curva attuale per confrontarla con le modifiche successive',
			clear: 'Cancella fissate', clearTip: 'Rimuove le curve fissate', csv: 'Copia CSV',
			csvTip: 'Copia i dati (frequenza, dB, fase) negli appunti', none: '(nessuno)',
			freqAxis: 'Frequenza (Hz)', magAxis: 'Modulo (dB)', phaseAxis: 'Fase (°)',
			current: 'attuale', trace: 'curva', copied: 'Dati copiati negli appunti ({n} punti).',
			popup: 'Impossibile aprire la finestra del diagramma di Bode (popup bloccato?).',
			noSource: 'Nessun generatore di tensione: aggiungine uno come ingresso.',
			noOutput: 'Nessuna uscita: aggiungi un\'etichetta (Labeled Node), un Output o un voltmetro.',
			needIO: 'Serve un generatore come ingresso e un nodo etichettato come uscita',
			notready: 'In attesa del circuito...', singular: 'Circuito non risolvibile',
			disconnected: 'L\'uscita non è collegata all\'ingresso',
			ok: 'Analisi AC di piccolo segnale nel punto di lavoro DC (transistor, operazionali e altri stadi inclusi), {n} punti.',
			transient: 'Punto di lavoro DC non trovato: uso lo stato attuale della simulazione.',
			node: 'Nodo «{n}»', out: 'Uscita (Output) #{n}', probe: 'Voltmetro #{n}',
			src: { VoltageElm: 'Generatore', DCVoltageElm: 'Generatore', ACVoltageElm: 'Generatore AC', RailElm: 'Rail',
				ACRailElm: 'Rail AC', VarRailElm: 'Rail variabile', SquareRailElm: 'Rail onda quadra', ClockElm: 'Clock',
				AntennaElm: 'Antenna', SweepElm: 'Sweep', AudioInputElm: 'Ingresso audio', NoiseElm: 'Rumore' }
		}
	};
	var S = STRINGS[(navigator.language || 'en').slice(0, 2).toLowerCase()] || STRINGS.en;
	function fmt(s, n) { return s.replace('{n}', n); }

	function load(k, d) {
		try {
			var v = localStorage.getItem(STORE + k);
			return v == null ? d : JSON.parse(v);
		} catch (e) { return d; }
	}
	function save(k, v) {
		try { localStorage.setItem(STORE + k, JSON.stringify(v)); } catch (e) {}
	}
	(function () {
		var s = load('settings', null);
		if (s) for (var k in settings) if (s.hasOwnProperty(k)) settings[k] = s[k];
	})();
	function saveSettings() { save('settings', settings); }

	function num(v) { return typeof v === 'number' && isFinite(v); }

	// ------------------------------------------------------------------
	// data from the simulator
	// ------------------------------------------------------------------

	function sourceLabel(s) {
		var l = (S.src[s.type] || s.type.replace(/Elm$/, '')) + ' #' + s.num;
		if (s.ac && s.freq > 0) l += ' (' + fmtFreq(s.freq) + ')';
		return l;
	}
	function outputLabel(o) {
		if (o.key[0] === 'L') return fmt(S.node, o.name);
		if (o.key[0] === 'O') return fmt(S.out, o.num);
		return fmt(S.probe, o.num);
	}

	function sweep(srcKey, outKey) {
		var r = sim.acSweep(srcKey, outKey, settings.fmin, settings.fmax, NPOINTS);
		if (!r.ok) return { error: r.error };
		var db = r.db.map(function (v) { return v === null ? NaN : v; });
		var ph = r.ph.map(function (v) { return v === null ? NaN : v; });
		// unwrap the phase so inverting stages (around +-180 deg) give a continuous curve
		var prev = null;
		for (var i = 0; i < ph.length; i++) {
			if (!isFinite(ph[i])) continue;
			if (prev !== null) ph[i] -= 360 * Math.round((ph[i] - prev) / 360);
			prev = ph[i];
		}
		return { f: r.f, db: db, ph: ph, op: r.op };
	}

	// ------------------------------------------------------------------
	// formatting helpers
	// ------------------------------------------------------------------

	function fmtFreq(f) {
		if (f >= 1e6) return trim(f / 1e6) + ' MHz';
		if (f >= 1e3) return trim(f / 1e3) + ' kHz';
		return trim(f) + ' Hz';
	}
	function fmtAxisFreq(f) {
		if (f >= 1e6) return (f / 1e6) + 'M';
		if (f >= 1e3) return (f / 1e3) + 'k';
		return '' + f;
	}
	function trim(v) {
		var s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
		return s.indexOf('.') < 0 ? s : s.replace(/\.?0+$/, '');
	}

	// ------------------------------------------------------------------
	// window / UI
	// ------------------------------------------------------------------

	var CSS = '' +
		':root{--bg:#1e1e1e;--panel:#252526;--text:#e0e0e0;--dim:#9a9a9a;--border:#3c3c3c;--accent:#3a6ea5}' +
		'*{box-sizing:border-box}' +
		'html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font:13px system-ui,"Segoe UI",sans-serif;overflow:hidden}' +
		'#root{display:flex;flex-direction:column;height:100%}' +
		'.bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding:8px 12px;background:var(--panel);border-bottom:1px solid var(--border)}' +
		'.bar label{display:inline-flex;align-items:center;gap:5px;color:var(--text);white-space:nowrap}' +
		'.bar .lbl{color:var(--dim)}' +
		'select,input[type=number],button{background:#2d2d2d;color:var(--text);border:1px solid var(--border);border-radius:3px;padding:3px 6px;font:inherit}' +
		'select:focus,input:focus,button:focus{outline:1px solid var(--accent)}' +
		'button{cursor:pointer}button:hover{background:#3a3a3a}' +
		'input[type=number]{width:62px}' +
		'input[type=checkbox]{accent-color:var(--accent);width:15px;height:15px;margin:0}' +
		'.sep{width:1px;align-self:stretch;background:var(--border)}' +
		'#wrap{flex:1;position:relative;min-height:120px}' +
		'canvas{position:absolute;inset:0;width:100%;height:100%;display:block}' +
		'.status{padding:5px 12px;color:var(--dim);font-size:12px;border-top:1px solid var(--border);background:var(--panel);min-height:26px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
		'.status b{color:#e6b450;font-weight:600}';

	function html() {
		return '' +
		'<div id="root">' +
		'<div class="bar">' +
		'<label><input type="checkbox" id="cbMag"> ' + S.mag + '</label>' +
		'<label><input type="checkbox" id="cbPhase"> ' + S.phase + '</label>' +
		'<span class="sep"></span>' +
		'<label><span class="lbl">' + S.input + '</span> <select id="selSrc"></select></label>' +
		'<label><span class="lbl">' + S.output + '</span> <select id="selOut"></select></label>' +
		'<span class="sep"></span>' +
		'<label><span class="lbl">' + S.freq + '</span> <select id="selFmin"></select> – <select id="selFmax"></select></label>' +
		'<label><span class="lbl">dB</span> <select id="selY">' +
		'<option value="auto">Auto</option><option value="0,-48">0 … −48</option>' +
		'<option value="12,-48">+12 … −48</option><option value="0,-80">0 … −80</option>' +
		'<option value="40,-40">+40 … −40</option><option value="60,-60">+60 … −60</option></select></label>' +
		'<label><span class="lbl">Offset</span> <input type="number" id="inOff" step="0.5"> dB</label>' +
		'<span class="sep"></span>' +
		'<button id="btHold" title="' + S.holdTip + '">' + S.hold + '</button>' +
		'<button id="btClear" title="' + S.clearTip + '">' + S.clear + '</button>' +
		'<button id="btCsv" title="' + S.csvTip + '">' + S.csv + '</button>' +
		'</div>' +
		'<div id="wrap"><canvas id="cv"></canvas></div>' +
		'<div class="status" id="status"></div>' +
		'</div>';
	}

	var FREQS_MIN = [1, 2, 5, 10, 20, 50, 100];
	var FREQS_MAX = [1000, 10000, 20000, 50000, 100000, 1000000, 10000000];

	function open() {
		if (!sim) return;
		if (win && !win.closed) { win.focus(); return; }
		var g = load('geom', null);
		var feat = 'width=' + (g ? g.w : 980) + ',height=' + (g ? g.h : 600);
		if (g && num(g.x) && num(g.y)) feat += ',left=' + g.x + ',top=' + g.y;
		win = window.open('', WIN_NAME, feat);
		if (!win) {
			alert(S.popup);
			return;
		}
		buildUI();
		// some engines replace the initial about:blank document once it "loads"
		setTimeout(function () { if (win && !win.closed && !win.document.getElementById('root')) buildUI(); }, 300);
		lastSweepTime = 0;
		if (!timer) timer = setInterval(tick, 100);
		tick();
	}

	function buildUI() {
		var d = win.document;
		d.open();
		d.write('<!doctype html><html><head><meta charset="utf-8"><title>' + S.title + ' — CircuitJS</title><style>' +
			CSS + '</style></head><body>' + html() + '</body></html>');
		d.close();
		var $ = function (id) { return d.getElementById(id); };
		ui = {
			doc: d, cv: $('cv'), wrap: $('wrap'), status: $('status'),
			cbMag: $('cbMag'), cbPhase: $('cbPhase'), selSrc: $('selSrc'), selOut: $('selOut'),
			selFmin: $('selFmin'), selFmax: $('selFmax'), selY: $('selY'), inOff: $('inOff')
		};
		lastSrcKey = lastOutKey = null;
		FREQS_MIN.forEach(function (f) { addOpt(ui.selFmin, f, fmtFreq(f)); });
		FREQS_MAX.forEach(function (f) { addOpt(ui.selFmax, f, fmtFreq(f)); });
		ui.selFmin.value = settings.fmin; ui.selFmax.value = settings.fmax;
		if (ui.selFmin.value === '') ui.selFmin.value = settings.fmin = 10;
		if (ui.selFmax.value === '') ui.selFmax.value = settings.fmax = 100000;
		ui.cbMag.checked = settings.showMag;
		ui.cbPhase.checked = settings.showPhase;
		ui.selY.value = settings.yRange;
		if (ui.selY.value === '') ui.selY.value = settings.yRange = 'auto';
		ui.inOff.value = settings.offset;

		function changed(recompute) {
			settings.showMag = ui.cbMag.checked;
			settings.showPhase = ui.cbPhase.checked;
			settings.fmin = +ui.selFmin.value;
			settings.fmax = +ui.selFmax.value;
			settings.yRange = ui.selY.value;
			settings.offset = parseFloat(ui.inOff.value) || 0;
			settings.source = ui.selSrc.value;
			settings.output = ui.selOut.value;
			settings.sourceList = lastSrcKey;
			settings.outputList = lastOutKey;
			saveSettings();
			if (recompute) { lastSweepTime = 0; tick(); } else draw();
		}
		ui.cbMag.onchange = ui.cbPhase.onchange = ui.selY.onchange = function () { changed(false); };
		ui.inOff.oninput = function () { changed(false); };
		ui.selFmin.onchange = ui.selFmax.onchange = ui.selSrc.onchange = ui.selOut.onchange = function () { changed(true); };
		$('btHold').onclick = function () {
			if (!result || !result.f.length) return;
			held.push({ name: currentName(), color: TRACE_COLORS[held.length % TRACE_COLORS.length], r: result });
			draw();
		};
		$('btClear').onclick = function () { held = []; draw(); };
		$('btCsv').onclick = copyCsv;

		ui.cv.onmousemove = function (ev) { hover = { x: ev.offsetX, y: ev.offsetY }; draw(); };
		ui.cv.onmouseleave = function () { hover = null; draw(); };
		win.onresize = function () { draw(); saveGeom(); };
		win.onbeforeunload = function () {
			saveGeom();
		};
		draw();
	}

	function addOpt(sel, value, text) {
		var o = sel.ownerDocument.createElement('option');
		o.value = value; o.textContent = text;
		sel.appendChild(o);
	}

	function saveGeom() {
		try {
			if (win && !win.closed)
				save('geom', { x: win.screenX, y: win.screenY, w: win.outerWidth, h: win.outerHeight });
		} catch (e) {}
	}

	function currentName() {
		var s = ui.selOut.options[ui.selOut.selectedIndex];
		return (s ? s.textContent : S.trace) + ' #' + (held.length + 1);
	}

	function copyCsv() {
		if (!result) return;
		var lines = ['freq_Hz;magnitude_dB;phase_deg'];
		for (var i = 0; i < result.f.length; i++)
			lines.push(result.f[i].toPrecision(6) + ';' + (result.db[i] + settings.offset).toFixed(3) + ';' + result.ph[i].toFixed(2));
		var text = lines.join('\n');
		var done = function () { setStatus(fmt(S.copied, result.f.length)); };
		try {
			win.navigator.clipboard.writeText(text).then(done, fallback);
		} catch (e) { fallback(); }
		function fallback() {
			var ta = ui.doc.createElement('textarea');
			ta.value = text; ui.doc.body.appendChild(ta); ta.select();
			try { ui.doc.execCommand('copy'); done(); } catch (e) {}
			ta.remove();
		}
	}

	var statusOverride = null;
	function setStatus(msg) {
		statusOverride = msg;
		setTimeout(function () { statusOverride = null; updateStatus(); }, 2500);
		updateStatus();
	}

	// Fill a selector when the choices change.  The previous choice (in this window, or saved)
	// is kept if it was made with these same choices, i.e. in the same circuit, or if keep(o)
	// accepts it anyway; otherwise autoPick chooses (so a supply rail picked as the input of
	// one circuit is not reused for the next one).
	function syncSelect(sel, list, label, want, wantList, autoPick, keep) {
		var key = list.map(function (o) { return o.key + '=' + label(o); }).join('|');
		var prevKey = sel === ui.selSrc ? lastSrcKey : lastOutKey;
		if (key !== prevKey) {
			var cands = [sel.value, want];
			sel.innerHTML = '';
			if (!list.length) addOpt(sel, '', S.none);
			list.forEach(function (o) { addOpt(sel, o.key, label(o)); });
			var pick = null;
			for (var c = 0; c < cands.length && !pick; c++)
				list.forEach(function (o) {
					if (!pick && cands[c] && o.key === cands[c] && (wantList === key || keep(o))) pick = o;
				});
			if (!pick && list.length) pick = autoPick(list);
			sel.value = pick ? pick.key : '';
			if (sel === ui.selSrc) lastSrcKey = key; else lastOutKey = key;
		}
		return sel.value;
	}

	function pickSource(list) {
		for (var i = 0; i < list.length; i++) if (list[i].ac) return list[i];
		return list[0];
	}
	function pickOutput(list) {
		for (var i = 0; i < list.length; i++) if (/out/i.test(list[i].key)) return list[i];
		for (i = 0; i < list.length; i++) if (list[i].key[0] === 'O') return list[i];
		for (i = 0; i < list.length; i++) if (list[i].key[0] === 'P') return list[i];
		return list[list.length - 1];
	}

	function tick() {
		if (!win || win.closed) {
			if (timer) { clearInterval(timer); timer = null; }
			win = null; ui = null;
			return;
		}
		if (!ui || !win.document.getElementById('root')) buildUI();
		var now = Date.now();
		if (now - lastSweepTime < interval) return;
		lastSweepTime = now;
		try {
			targets = sim.getACTargets();
			var srcKey = syncSelect(ui.selSrc, targets.sources, sourceLabel, settings.source, settings.sourceList,
				pickSource, function (o) { return o.ac; });
			var outKey = syncSelect(ui.selOut, targets.outputs, outputLabel, settings.output, settings.outputList,
				pickOutput, function () { return true; });
			if (srcKey !== settings.source || outKey !== settings.output ||
					lastSrcKey !== settings.sourceList || lastOutKey !== settings.outputList) {
				settings.source = srcKey; settings.output = outKey;
				settings.sourceList = lastSrcKey; settings.outputList = lastOutKey;
				saveSettings();
			}
			var prevResult = result;
			result = null; error = null;
			if (srcKey && outKey) {
				var t0 = Date.now();
				var r = sweep(srcKey, outKey);
				// keep the sweep cost to a small fraction of the time on large circuits
				interval = Math.max(200, 8 * (Date.now() - t0));
				// keep the last plot while the circuit is being rebuilt
				if (r.error === 'notready' && prevResult) result = prevResult;
				else if (r.error) error = r.error; else result = r;
			}
		} catch (e) {
			console.log('bodeplot: ' + e);
			error = 'exception';
		}
		draw();
	}

	function updateStatus() {
		if (!ui) return;
		var msg = statusOverride;
		if (!msg) {
			var parts = [];
			if (targets) {
				if (!targets.sources.length) parts.push('<b>' + S.noSource + '</b>');
				if (!targets.outputs.length) parts.push('<b>' + S.noOutput + '</b>');
			}
			if (error && S[error]) parts.push('<b>' + S[error] + '</b>');
			if (!parts.length && result) {
				parts.push(fmt(S.ok, NPOINTS));
				if (result.op === 'transient') parts.push(S.transient);
			}
			msg = parts.join(' &nbsp; ');
		}
		ui.status.innerHTML = msg;
	}

	// ------------------------------------------------------------------
	// drawing
	// ------------------------------------------------------------------

	function niceStep(range) {
		var steps = [1, 2, 3, 5, 6, 10, 12, 20, 30, 40, 50, 100];
		for (var i = 0; i < steps.length; i++) if (range / steps[i] <= 10) return steps[i];
		return 200;
	}

	function draw() {
		if (!ui || !win || win.closed) return;
		updateStatus();
		var cv = ui.cv, dpr = win.devicePixelRatio || 1;
		var W = ui.wrap.clientWidth, H = ui.wrap.clientHeight;
		if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
			cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
		}
		var g = cv.getContext('2d');
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.fillStyle = '#1e1e1e';
		g.fillRect(0, 0, W, H);

		var showMag = settings.showMag, showPh = settings.showPhase;
		var L = 62, Rm = showPh ? 58 : 22, T = 16, B = 46;
		var pw = W - L - Rm, ph = H - T - B;
		if (pw < 40 || ph < 40) return;

		var off = settings.offset;
		var traces = held.slice();
		if (result) traces.push({ name: S.current, color: '#2f5fd0', r: result, main: true });

		// magnitude range
		var ymax, ymin;
		if (settings.yRange === 'auto') {
			var lo = Infinity, hi = -Infinity;
			traces.forEach(function (tr) {
				tr.r.db.forEach(function (v) { if (isFinite(v) && v > -300) { v += off; if (v < lo) lo = v; if (v > hi) hi = v; } });
			});
			if (!isFinite(lo)) { lo = -48; hi = 0; }
			var span = Math.max(hi - lo, 12);
			var st = niceStep(span * 1.2);
			ymax = Math.ceil((hi + span * 0.08) / st) * st;
			ymin = Math.floor((lo - span * 0.08) / st) * st;
			if (ymax - ymin < 12) ymin = ymax - 12;
		} else {
			var p = settings.yRange.split(',');
			ymax = +p[0]; ymin = +p[1];
		}
		var ystep = niceStep(ymax - ymin);

		var lf0 = Math.log10(settings.fmin), lf1 = Math.log10(settings.fmax);
		var X = function (f) { return L + (Math.log10(f) - lf0) / (lf1 - lf0) * pw; };
		var Y = function (db) { return T + (ymax - db) / (ymax - ymin) * ph; };
		// phase axis: 360 deg wide, centered (in 45 deg steps) on the traces
		var plo = Infinity, phi = -Infinity;
		traces.forEach(function (tr) {
			tr.r.ph.forEach(function (v) { if (isFinite(v)) { if (v < plo) plo = v; if (v > phi) phi = v; } });
		});
		var pc = isFinite(plo) ? Math.round((plo + phi) / 2 / 45) * 45 : 0;
		var YP = function (deg) { return T + (pc + 180 - deg) / 360 * ph; };

		// plot area
		g.fillStyle = '#ffffff';
		g.fillRect(L, T, pw, ph);
		g.lineWidth = 1;
		// frequency grid
		g.font = '12px system-ui,"Segoe UI",sans-serif';
		g.textAlign = 'center'; g.textBaseline = 'top';
		for (var dec = Math.floor(lf0); dec <= Math.ceil(lf1); dec++) {
			for (var m = 1; m < 10; m++) {
				var f = m * Math.pow(10, dec);
				if (f < settings.fmin * 0.999 || f > settings.fmax * 1.001) continue;
				var x = Math.round(X(f)) + 0.5;
				g.strokeStyle = m === 1 ? '#c9c9c9' : '#ececec';
				line(g, x, T, x, T + ph);
				if (m === 1) { g.fillStyle = '#9a9a9a'; g.fillText(fmtAxisFreq(f), x, T + ph + 6); }
			}
		}
		g.fillStyle = '#9a9a9a';
		g.fillText(S.freqAxis, L + pw / 2, T + ph + 24);

		// dB grid
		if (showMag || !showPh) {
			g.textAlign = 'right'; g.textBaseline = 'middle';
			for (var v = Math.ceil(ymin / ystep) * ystep; v <= ymax + 1e-9; v += ystep) {
				var y = Math.round(Y(v)) + 0.5;
				g.strokeStyle = v === 0 ? '#c0c0c0' : '#e3e3e3';
				line(g, L, y, L + pw, y);
				g.fillStyle = '#9a9a9a';
				g.fillText(String(Math.round(v * 10) / 10), L - 8, y);
			}
			g.save();
			g.translate(16, T + ph / 2); g.rotate(-Math.PI / 2);
			g.textAlign = 'center'; g.fillStyle = '#9a9a9a';
			g.fillText(S.magAxis, 0, 0);
			g.restore();
		}
		// phase axis
		if (showPh) {
			g.textAlign = 'left'; g.textBaseline = 'middle';
			for (var d = pc - 180; d <= pc + 180; d += 45) {
				var yp = Math.round(YP(d)) + 0.5;
				if (!showMag) { g.strokeStyle = d === 0 ? '#c0c0c0' : '#e3e3e3'; line(g, L, yp, L + pw, yp); }
				g.fillStyle = '#e67e22';
				g.fillText(d + '°', L + pw + 8, yp);
			}
			g.save();
			g.translate(W - 10, T + ph / 2); g.rotate(Math.PI / 2);
			g.textAlign = 'center'; g.fillStyle = '#e67e22';
			g.fillText(S.phaseAxis, 0, 0);
			g.restore();
		}
		g.strokeStyle = '#8a8a8a';
		g.strokeRect(L + 0.5, T + 0.5, pw - 1, ph - 1);

		// traces
		g.save();
		g.beginPath(); g.rect(L, T, pw, ph); g.clip();
		traces.forEach(function (tr) {
			if (showMag) plot(g, tr.r.f, tr.r.db, X, function (v) { return Y(v + off); }, tr.color, tr.main ? 2.2 : 1.6, null);
			if (showPh) plot(g, tr.r.f, tr.r.ph, X, YP, tr.main ? '#e67e22' : tr.color, tr.main ? 1.8 : 1.2, tr.main ? null : [5, 4], true);
		});
		g.restore();

		if (!result) {
			g.fillStyle = '#777'; g.textAlign = 'center'; g.textBaseline = 'middle';
			g.font = '14px system-ui,"Segoe UI",sans-serif';
			var noIO = !targets || !targets.sources.length || !targets.outputs.length;
			g.fillText(noIO ? S.needIO : (S[error] || S.singular), L + pw / 2, T + ph / 2);
		}

		// legend for held traces
		if (held.length) {
			g.font = '12px system-ui,"Segoe UI",sans-serif';
			g.textAlign = 'left'; g.textBaseline = 'middle';
			var ly = T + 14, lx = L + 12;
			traces.forEach(function (tr) {
				g.fillStyle = tr.color; g.fillRect(lx, ly - 1.5, 16, 3);
				g.fillStyle = '#333'; g.fillText(tr.main ? S.current : tr.name, lx + 22, ly);
				ly += 17;
			});
		}

		// hover readout
		if (hover && result && hover.x >= L && hover.x <= L + pw && hover.y >= T && hover.y <= T + ph) {
			var fh = Math.pow(10, lf0 + (hover.x - L) / pw * (lf1 - lf0));
			var hx = Math.round(hover.x) + 0.5;
			g.strokeStyle = 'rgba(0,0,0,0.35)'; g.setLineDash([3, 3]);
			line(g, hx, T, hx, T + ph); g.setLineDash([]);
			var rows = ['f = ' + fmtFreq(fh)];
			traces.slice().reverse().forEach(function (tr) {
				var vdb = interp(tr.r.f, tr.r.db, fh), vph = interp(tr.r.f, tr.r.ph, fh);
				if (showMag && isFinite(vdb)) {
					dot(g, hx, Y(vdb + off), tr.color);
				}
				if (showPh && isFinite(vph)) dot(g, hx, YP(vph), tr.main ? '#e67e22' : tr.color);
				var s = (tr.main ? '' : tr.name + ': ');
				if (showMag || !showPh) s += (vdb + off).toFixed(2) + ' dB';
				if (showPh) s += (showMag ? '  ' : '') + vph.toFixed(1) + '°';
				rows.push({ t: s, c: tr.color });
			});
			g.font = '12px system-ui,"Segoe UI",sans-serif';
			var bw = 0;
			rows.forEach(function (r) { bw = Math.max(bw, g.measureText(r.t || r).width); });
			bw += 20;
			var bh = rows.length * 17 + 8;
			var bx = hover.x + 14, by = hover.y + 14;
			if (bx + bw > L + pw) bx = hover.x - bw - 14;
			if (by + bh > T + ph) by = hover.y - bh - 14;
			g.fillStyle = 'rgba(30,30,30,0.92)';
			g.fillRect(bx, by, bw, bh);
			g.textAlign = 'left'; g.textBaseline = 'middle';
			rows.forEach(function (r, i) {
				var yy = by + 12 + i * 17;
				if (typeof r === 'string') { g.fillStyle = '#ffffff'; g.fillText(r, bx + 8, yy); return; }
				g.fillStyle = r.c; g.fillRect(bx + 8, yy - 1.5, 8, 3);
				g.fillStyle = '#e0e0e0'; g.fillText(r.t, bx + 20, yy);
			});
		}
	}

	function line(g, x0, y0, x1, y1) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
	function dot(g, x, y, c) { g.fillStyle = c; g.beginPath(); g.arc(x, y, 3.5, 0, 2 * Math.PI); g.fill(); }

	function plot(g, fs, vs, X, Y, color, width, dash, wraps) {
		g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round';
		g.setLineDash(dash || []);
		g.beginPath();
		var pen = false, prev = null;
		for (var i = 0; i < fs.length; i++) {
			var v = vs[i];
			if (!isFinite(v) || v < -300) { pen = false; continue; }
			// break the line at +-180 phase wraps
			if (wraps && prev !== null && Math.abs(v - prev) > 180) pen = false;  // held traces may differ by 360
			var x = X(fs[i]), y = Y(v);
			if (pen) g.lineTo(x, y); else g.moveTo(x, y);
			pen = true; prev = v;
		}
		g.stroke();
		g.setLineDash([]);
		g.lineWidth = 1;
	}

	function interp(fs, vs, f) {
		if (!fs.length) return NaN;
		if (f <= fs[0]) return vs[0];
		for (var i = 1; i < fs.length; i++) {
			if (fs[i] >= f) {
				var t = (Math.log(f) - Math.log(fs[i - 1])) / (Math.log(fs[i]) - Math.log(fs[i - 1]));
				return vs[i - 1] + (vs[i] - vs[i - 1]) * t;
			}
		}
		return vs[vs.length - 1];
	}

	// ------------------------------------------------------------------
	// startup
	// ------------------------------------------------------------------

	window.addEventListener('beforeunload', function () {
		saveGeom();
		if (win && !win.closed) win.close();
	});

	function init(api) {
		sim = api;
	}

	var prevHook = window.oncircuitjsloaded;
	window.oncircuitjsloaded = function (api) {
		if (typeof prevHook === 'function') { try { prevHook(api); } catch (e) { console.log(e); } }
		init(api);
	};
	if (window.CircuitJS1) init(window.CircuitJS1);

	window.CircuitJSBode = { open: open };
})();
