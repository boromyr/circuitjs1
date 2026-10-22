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
	var TRACE_COLORS = ['#2ecc71', '#e74c3c', '#b07cd8', '#1abc9c', '#f1c40f', '#95a5a6'];
	var CURSORS = [{ key: 'curA', name: 'A', color: '#f5d142' }, { key: 'curB', name: 'B', color: '#3fd0e8' }];

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
	var geom = null;        // plot area and frequency axis of the last drawing, for the cursors
	var dragCur = -1;       // index in CURSORS of the cursor being dragged
	var interval = 400, lastSweepTime = 0;
	// what the last sweep was made for: the circuit is only swept again when this changes,
	// since finding the operating point runs every element and can disturb ones with memory
	// (Schmitt triggers, gate delays) besides costing time
	var lastSweepKey = null, lastVersion = null;

	var settings = {
		showMag: true,
		showPhase: false,
		fmin: 10,
		fmax: 100000,
		yRange: 'auto',
		yMax: 20,       // custom dB range (yRange 'custom')
		yMin: -60,
		offset: 0,
		source: '',
		output: '',
		cursors: false,
		scale: 'db',    // vertical scale: db, dba, phon or sone (see perceived())
		listen: 85,     // listening level for phon/sone: dB SPL of the peak of the current trace
		curA: null,     // cursor frequencies (Hz), null = not placed yet
		curB: null
	};

	// ------------------------------------------------------------------
	// strings
	// ------------------------------------------------------------------

	var STRINGS = {
		en: {
			custom: 'Custom', yMaxTip: 'Top of the dB scale', yMinTip: 'Bottom of the dB scale',
			title: 'Bode Plot', mag: 'Magnitude', phase: 'Phase', input: 'Input', output: 'Output',
			freq: 'Freq.', hold: 'Hold trace', holdTip: 'Freeze the current trace to compare it with later changes',
			speed: 'Speed', speedTip: 'Simulation Speed (the same as the slider of the simulator)',
			clear: 'Clear held', clearTip: 'Remove the held traces', csv: 'Copy CSV',
			csvTip: 'Copy the data (frequency, dB, phase) to the clipboard', none: '(none)',
			freqAxis: 'Frequency (Hz)', magAxis: 'Magnitude (dB)', phaseAxis: 'Phase (°)',
			scale: 'Scale', scaleTip: 'Vertical scale: voltage gain, or how loud the ear hears each frequency',
			scDb: 'dB (voltage)', scDba: 'dB(A) (ear, low volume)', scPhon: 'Phon (loudness level)', scSone: 'Sone (perceived loudness)',
			listen: 'Listening', listenTip: 'Sound level (dB SPL) of the loudest point of the current trace: the ear hears bass and treble differently at different volumes',
			axDba: 'A-weighted gain (dB(A))', axPhon: 'Loudness level (phon)', axSone: 'Perceived loudness (sone)',
			percInfo: 'Equal-loudness contours ISO 226:2003, peak at {n} dB SPL (outside 20 Hz - 12.5 kHz: estimated from the threshold of hearing).',
			dbaInfo: 'A-weighting (IEC 61672): the ear at low volume, independent of the level.',
			cursors: 'Cursors', cursorsTip: 'Two vertical cursors: drag them (or click in the plot) to read two points and their difference',
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
			custom: 'Personalizzato', yMaxTip: 'Valore massimo della scala in dB', yMinTip: 'Valore minimo della scala in dB',
			title: 'Diagramma di Bode', mag: 'Modulo', phase: 'Fase', input: 'Ingresso', output: 'Uscita',
			freq: 'Freq.', hold: 'Fissa curva', holdTip: 'Congela la curva attuale per confrontarla con le modifiche successive',
			speed: 'Velocità', speedTip: 'Velocità di simulazione (la stessa della barra del simulatore)',
			clear: 'Cancella fissate', clearTip: 'Rimuove le curve fissate', csv: 'Copia CSV',
			csvTip: 'Copia i dati (frequenza, dB, fase) negli appunti', none: '(nessuno)',
			freqAxis: 'Frequenza (Hz)', magAxis: 'Modulo (dB)', phaseAxis: 'Fase (°)',
			scale: 'Scala', scaleTip: 'Scala verticale: guadagno in tensione, oppure quanto forte l\'orecchio sente ogni frequenza',
			scDb: 'dB (tensione)', scDba: 'dB(A) (orecchio, volume basso)', scPhon: 'Phon (livello di sonorità)', scSone: 'Sone (volume percepito)',
			listen: 'Ascolto', listenTip: 'Livello sonoro (dB SPL) del punto più forte della curva attuale: l\'orecchio sente bassi e acuti in modo diverso a volumi diversi',
			axDba: 'Guadagno ponderato A (dB(A))', axPhon: 'Livello di sonorità (phon)', axSone: 'Volume percepito (sone)',
			percInfo: 'Curve isofoniche ISO 226:2003, picco a {n} dB SPL (fuori da 20 Hz - 12,5 kHz: stima dalla soglia dell\'udito).',
			dbaInfo: 'Ponderazione A (IEC 61672): l\'orecchio a basso volume, indipendente dal livello.',
			cursors: 'Cursori', cursorsTip: 'Due cursori verticali: trascinali (o fai clic nel grafico) per leggere due punti e la loro differenza',
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
		// the phase trace always starts hidden; it is shown only on request
		settings.showPhase = false;
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
	// perceived loudness
	// ------------------------------------------------------------------

	// ISO 226:2003 equal-loudness contours: for each frequency, the exponent af, the magnitude
	// of the linear transfer function Lu (dB) and the threshold of hearing Tf (dB SPL)
	var ISO_F = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
		1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500];
	var ISO_AF = [0.532, 0.506, 0.480, 0.455, 0.432, 0.409, 0.387, 0.367, 0.349, 0.330, 0.315, 0.301, 0.288,
		0.276, 0.267, 0.259, 0.253, 0.250, 0.246, 0.244, 0.243, 0.243, 0.243, 0.242, 0.242, 0.245, 0.254, 0.271, 0.301];
	var ISO_LU = [-31.6, -27.2, -23.0, -19.1, -15.9, -13.0, -10.3, -8.1, -6.2, -4.5, -3.1, -2.0, -1.1, -0.4,
		0.0, 0.3, 0.5, 0.0, -2.7, -4.1, -1.0, 1.7, 2.5, 1.2, -2.1, -7.1, -11.2, -10.7, -3.1];
	var ISO_TF = [78.5, 68.7, 59.5, 51.1, 44.0, 37.5, 31.5, 26.5, 22.1, 17.9, 14.4, 11.4, 8.6, 6.2, 4.4,
		3.0, 2.2, 2.4, 3.5, 1.7, -1.3, -4.2, -6.0, -5.4, -1.5, 6.0, 12.6, 13.9, 12.3];

	// Outside 20 Hz - 12.5 kHz the standard has no data, but the ear goes deaf quickly there:
	// the threshold of hearing is taken from ISO 389-7 above (young listeners, free field) and
	// from infrasound measurements below (Moller & Pedersen 2004), the shape terms af and Lu
	// are held at the ends of the table
	var TH_LOW_F = [8, 10, 12.5, 16, 20], TH_LOW = [100, 97, 92, 88, 78.5];
	var TH_HIGH_F = [12500, 14000, 16000, 18000], TH_HIGH = [12.3, 18.4, 40.2, 73.2];

	// y at x on a log x scale through the points (xs, ys), straight on beyond the ends
	function logInterp(xs, ys, x) {
		var i = 1, n = xs.length;
		while (i < n - 1 && xs[i] < x) i++;
		var t = Math.log(x / xs[i - 1]) / Math.log(xs[i] / xs[i - 1]);
		return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
	}

	// the parameters at frequency f, interpolated on a log frequency scale
	function isoParams(f) {
		var n = ISO_F.length;
		if (!(f > ISO_F[0])) return [ISO_AF[0], ISO_LU[0], logInterp(TH_LOW_F, TH_LOW, Math.max(f, 1))];
		if (f >= ISO_F[n - 1]) return [ISO_AF[n - 1], ISO_LU[n - 1], logInterp(TH_HIGH_F, TH_HIGH, f)];
		var i = 1;
		while (ISO_F[i] < f) i++;
		var t = Math.log(f / ISO_F[i - 1]) / Math.log(ISO_F[i] / ISO_F[i - 1]);
		var lin = function (a) { return a[i - 1] + (a[i] - a[i - 1]) * t; };
		return [lin(ISO_AF), lin(ISO_LU), lin(ISO_TF)];
	}

	// loudness level (phon) of a tone of the given sound pressure level (ISO 226:2003, eq. 2),
	// or NaN below the threshold of hearing
	function phon(f, spl) {
		var p = isoParams(f), af = p[0], lu = p[1], tf = p[2];
		if (spl < tf) return NaN;
		var bf = Math.pow(0.4 * Math.pow(10, (spl + lu) / 10 - 9), af) -
			Math.pow(0.4 * Math.pow(10, (tf + lu) / 10 - 9), af) + 0.005135;
		return 40 * Math.log10(bf) + 94;
	}

	// perceived loudness (sone) of a loudness level: twice as loud every 10 phon above 40
	// (Stevens), and the usual power law below, where the doubling rule no longer holds
	function sone(ph) {
		if (!isFinite(ph)) return 0;
		return ph >= 40 ? Math.pow(2, (ph - 40) / 10) : Math.pow(Math.max(ph, 0) / 40, 2.642);
	}

	// A-weighting (IEC 61672), in dB
	function aWeight(f) {
		var f2 = f * f;
		var ra = 148693636 * f2 * f2 /
			((f2 + 424.36) * Math.sqrt((f2 + 11599.29) * (f2 + 544496.41)) * (f2 + 148693636));
		return 20 * Math.log10(ra) + 2.0;
	}

	// the values of a trace on the chosen scale.  For phon and sone the sound level of each
	// frequency is the listening level minus how far the gain is below ref (the peak of the
	// current trace), so held traces compare with it at the same volume knob.
	function perceived(r, ref) {
		var off = settings.offset, mode = settings.scale;
		return r.db.map(function (db, i) {
			if (!isFinite(db) || db < -300) return NaN;
			if (mode === 'dba') return db + off + aWeight(r.f[i]);
			if (mode === 'phon' || mode === 'sone') {
				var ph = phon(r.f[i], settings.listen + db - ref);
				return mode === 'phon' ? ph : sone(ph);
			}
			return db + off;
		});
	}

	function unit() {
		return { db: 'dB', dba: 'dB(A)', phon: 'phon', sone: 'sone' }[settings.scale] || 'dB';
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
		'input[type=range]{width:130px;accent-color:var(--accent);margin:0}' +
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
		'<label title="' + S.cursorsTip + '"><input type="checkbox" id="cbCur"> ' + S.cursors + '</label>' +
		'<span class="sep"></span>' +
		'<label><span class="lbl">' + S.input + '</span> <select id="selSrc"></select></label>' +
		'<label><span class="lbl">' + S.output + '</span> <select id="selOut"></select></label>' +
		'<span class="sep"></span>' +
		'<label><span class="lbl">' + S.freq + '</span> <select id="selFmin"></select> – <select id="selFmax"></select></label>' +
		'<label title="' + S.scaleTip + '"><span class="lbl">' + S.scale + '</span> <select id="selScale">' +
		'<option value="db">' + S.scDb + '</option><option value="dba">' + S.scDba + '</option>' +
		'<option value="phon">' + S.scPhon + '</option><option value="sone">' + S.scSone + '</option></select></label>' +
		'<label id="lbListen" title="' + S.listenTip + '"><span class="lbl">' + S.listen + '</span> ' +
		'<input type="number" id="inListen" step="5" min="20" max="120"> dB SPL</label>' +
		'<label id="lbY"><span class="lbl">dB</span> <select id="selY">' +
		'<option value="auto">Auto</option><option value="0,-48">0 … −48</option>' +
		'<option value="12,-48">+12 … −48</option><option value="0,-80">0 … −80</option>' +
		'<option value="40,-40">+40 … −40</option><option value="60,-60">+60 … −60</option>' +
		'<option value="custom">' + S.custom + '</option></select></label>' +
		'<label id="lbYc"><input type="number" id="inYmax" step="1" title="' + S.yMaxTip + '"> … ' +
		'<input type="number" id="inYmin" step="1" title="' + S.yMinTip + '"></label>' +
		'<label><span class="lbl">Offset</span> <input type="number" id="inOff" step="0.5"> dB</label>' +
		'<label title="' + S.speedTip + '"><span class="lbl">' + S.speed + '</span> <input type="range" id="inSpeed"></label>' +
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
			cbMag: $('cbMag'), cbPhase: $('cbPhase'), cbCur: $('cbCur'), selSrc: $('selSrc'), selOut: $('selOut'),
			selFmin: $('selFmin'), selFmax: $('selFmax'), selY: $('selY'), inOff: $('inOff'),
			lbYc: $('lbYc'), inYmax: $('inYmax'), inYmin: $('inYmin'), inSpeed: $('inSpeed'),
			selScale: $('selScale'), inListen: $('inListen'), lbListen: $('lbListen'), lbY: $('lbY')
		};
		lastSrcKey = lastOutKey = null;
		FREQS_MIN.forEach(function (f) { addOpt(ui.selFmin, f, fmtFreq(f)); });
		FREQS_MAX.forEach(function (f) { addOpt(ui.selFmax, f, fmtFreq(f)); });
		ui.selFmin.value = settings.fmin; ui.selFmax.value = settings.fmax;
		if (ui.selFmin.value === '') ui.selFmin.value = settings.fmin = 10;
		if (ui.selFmax.value === '') ui.selFmax.value = settings.fmax = 100000;
		ui.cbMag.checked = settings.showMag;
		ui.cbPhase.checked = settings.showPhase;
		ui.cbCur.checked = settings.cursors;
		ui.selY.value = settings.yRange;
		if (ui.selY.value === '') ui.selY.value = settings.yRange = 'auto';
		ui.inOff.value = settings.offset;
		// the Simulation Speed slider of the simulator, followed in tick() unless dragged here
		try { ui.inSpeed.min = 0; ui.inSpeed.max = sim.getSimSpeedMax(); ui.inSpeed.value = sim.getSimSpeed(); } catch (e) {}
		ui.inSpeed.oninput = function () { try { sim.setSimSpeed(+ui.inSpeed.value); } catch (e) {} };
		ui.inSpeed.onpointerdown = function () { ui.speedDrag = true; };
		ui.inSpeed.onpointerup = ui.inSpeed.onpointercancel = function () { ui.speedDrag = false; };
		ui.inYmax.value = settings.yMax;
		ui.inYmin.value = settings.yMin;
		ui.selScale.value = settings.scale;
		if (ui.selScale.value === '') ui.selScale.value = settings.scale = 'db';
		ui.inListen.value = settings.listen;
		showScaleControls();

		function changed(recompute) {
			settings.showMag = ui.cbMag.checked;
			settings.showPhase = ui.cbPhase.checked;
			settings.cursors = ui.cbCur.checked;
			settings.fmin = +ui.selFmin.value;
			settings.fmax = +ui.selFmax.value;
			settings.yRange = ui.selY.value;
			settings.offset = parseFloat(ui.inOff.value) || 0;
			var a = parseFloat(ui.inYmax.value), b = parseFloat(ui.inYmin.value);
			if (isFinite(a)) settings.yMax = a;
			if (isFinite(b)) settings.yMin = b;
			settings.scale = ui.selScale.value;
			var lv = parseFloat(ui.inListen.value);
			if (isFinite(lv)) settings.listen = Math.max(0, Math.min(140, lv));
			showScaleControls();
			settings.source = ui.selSrc.value;
			settings.output = ui.selOut.value;
			settings.sourceList = lastSrcKey;
			settings.outputList = lastOutKey;
			saveSettings();
			if (recompute) { lastSweepTime = 0; tick(); } else draw();
		}
		ui.cbMag.onchange = ui.cbPhase.onchange = ui.cbCur.onchange = ui.selY.onchange = function () { changed(false); };
		ui.inOff.oninput = ui.inYmax.oninput = ui.inYmin.oninput = ui.inListen.oninput = function () { changed(false); };
		ui.selScale.onchange = function () { changed(false); };
		ui.selFmin.onchange = ui.selFmax.onchange = ui.selSrc.onchange = ui.selOut.onchange = function () { changed(true); };
		$('btHold').onclick = function () {
			if (!result || !result.f.length) return;
			held.push({ name: currentName(), color: TRACE_COLORS[held.length % TRACE_COLORS.length], r: result });
			draw();
		};
		$('btClear').onclick = function () { held = []; draw(); };
		$('btCsv').onclick = copyCsv;

		hookCursors();
		win.onresize = function () { draw(); saveGeom(); };
		win.onbeforeunload = function () {
			saveGeom();
		};
		draw();
	}

	// the dB range only applies to the dB scales, the listening level only to phon and sone
	function showScaleControls() {
		var dbScale = settings.scale === 'db' || settings.scale === 'dba';
		ui.lbY.style.display = dbScale ? '' : 'none';
		ui.lbYc.style.display = dbScale && settings.yRange === 'custom' ? '' : 'none';
		ui.lbListen.style.display = dbScale ? 'none' : '';
	}

	// mouse on the plot: the hover readout, and dragging the cursors.  A press near a cursor
	// grabs it; anywhere else in the plot it brings the nearest cursor there.
	function hookCursors() {
		var cv = ui.cv;
		var inPlot = function (x, y) {
			return geom && x >= geom.L - 8 && x <= geom.L + geom.pw + 8 && y >= geom.T && y <= geom.T + geom.ph;
		};
		cv.onpointerdown = function (ev) {
			if (!settings.cursors || ev.button !== 0 || !inPlot(ev.offsetX, ev.offsetY)) return;
			var i = cursorNear(ev.offsetX);
			dragCur = i >= 0 ? i : nearestCursor(ev.offsetX);
			if (i < 0) moveCursor(dragCur, ev.offsetX);
			try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
			ev.preventDefault();
			draw();
		};
		cv.onpointermove = function (ev) {
			hover = { x: ev.offsetX, y: ev.offsetY };
			if (dragCur >= 0) moveCursor(dragCur, ev.offsetX);
			cv.style.cursor = dragCur >= 0 || (settings.cursors && inPlot(ev.offsetX, ev.offsetY) &&
				cursorNear(ev.offsetX) >= 0) ? 'ew-resize' : '';
			draw();
		};
		cv.onpointerup = cv.onpointercancel = function (ev) {
			if (dragCur < 0) return;
			// the last move may not have been delivered before the release
			if (ev.type === 'pointerup') moveCursor(dragCur, ev.offsetX);
			dragCur = -1;
			saveSettings();
			draw();
		};
		cv.onpointerleave = function () { if (dragCur < 0) { hover = null; draw(); } };
	}

	// cursor i's frequency on the present axis (placed at a third and two thirds the first time)
	function cursorFreq(i) {
		var f = settings[CURSORS[i].key];
		if (!num(f)) f = geom.Finv(geom.L + geom.pw * (i + 1) / 3);
		return Math.min(Math.max(f, settings.fmin), settings.fmax);
	}
	function cursorNear(x) {
		var best = -1, bd = 8;
		for (var i = 0; i < CURSORS.length; i++) {
			var d = Math.abs(geom.X(cursorFreq(i)) - x);
			if (d <= bd) { best = i; bd = d; }
		}
		return best;
	}
	function nearestCursor(x) {
		return Math.abs(geom.X(cursorFreq(0)) - x) <= Math.abs(geom.X(cursorFreq(1)) - x) ? 0 : 1;
	}
	function moveCursor(i, x) {
		x = Math.min(Math.max(x, geom.L), geom.L + geom.pw);
		settings[CURSORS[i].key] = geom.Finv(x);
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
		// on a perceived scale also its column (phon and sone relative to this trace's peak)
		var extra = settings.scale !== 'db', v = null;
		if (extra) {
			var ref = -Infinity;
			result.db.forEach(function (x) { if (isFinite(x) && x > ref) ref = x; });
			v = perceived(result, ref);
		}
		var lines = ['freq_Hz;magnitude_dB;phase_deg' + (extra ? ';' + unit().replace(/[()]/g, '') : '')];
		for (var i = 0; i < result.f.length; i++)
			lines.push(result.f[i].toPrecision(6) + ';' + (result.db[i] + settings.offset).toFixed(3) + ';' + result.ph[i].toFixed(2) +
				(extra ? ';' + (isFinite(v[i]) ? v[i].toFixed(4) : '') : ''));
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
		if (ui.inSpeed && !ui.speedDrag) try { ui.inSpeed.value = sim.getSimSpeed(); } catch (e) {}
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
			var sweepKey = srcKey + '|' + outKey + '|' + settings.fmin + '|' + settings.fmax;
			var version = sim.getCircuitVersion ? sim.getCircuitVersion() : null;
			// without a DC solution the sweep follows the transient state, so it keeps updating
			if (prevResult && version !== null && sweepKey === lastSweepKey && version === lastVersion &&
					prevResult.op !== 'transient') {
				draw();
				return;
			}
			lastSweepKey = sweepKey; lastVersion = version;
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
				if (settings.scale === 'phon' || settings.scale === 'sone') parts.push(fmt(S.percInfo, settings.listen));
				else if (settings.scale === 'dba') parts.push(S.dbaInfo);
			}
			msg = parts.join(' &nbsp; ');
		}
		ui.status.innerHTML = msg;
	}

	// ------------------------------------------------------------------
	// drawing
	// ------------------------------------------------------------------

	function niceStep(range) {
		var steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 3, 5, 6, 10, 12, 20, 30, 40, 50, 100];
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

		var traces = held.slice();
		if (result) traces.push({ name: S.current, color: '#4f8cff', r: result, main: true });
		// the values on the chosen scale (tr.v), with the peak of the current trace as the reference
		var mode = settings.scale, ref = -Infinity;
		(result ? [result] : held.map(function (h) { return h.r; })).forEach(function (r) {
			r.db.forEach(function (v) { if (isFinite(v) && v > ref) ref = v; });
		});
		traces.forEach(function (tr) { tr.v = perceived(tr.r, ref); });
		var isSone = mode === 'sone', dbScale = mode === 'db' || mode === 'dba';

		// magnitude range
		var ymax, ymin;
		if (settings.yRange === 'auto' || !dbScale) {
			var lo = Infinity, hi = -Infinity;
			traces.forEach(function (tr) {
				tr.v.forEach(function (v) { if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } });
			});
			if (!isFinite(lo)) { lo = isSone ? 0 : -48; hi = isSone ? 1 : 0; }
			if (isSone) lo = 0;
			var minSpan = isSone ? Math.max(hi * 0.2, 0.5) : 12;
			var span = Math.max(hi - lo, minSpan);
			var st = niceStep(span * 1.2);
			ymax = Math.ceil((hi + span * 0.08) / st) * st;
			ymin = isSone ? 0 : Math.floor((lo - span * 0.08) / st) * st;
			if (ymax - ymin < minSpan) ymin = ymax - minSpan;
		} else if (settings.yRange === 'custom') {
			ymax = Math.max(settings.yMax, settings.yMin);
			ymin = Math.min(settings.yMax, settings.yMin);
			if (ymax - ymin < 1) ymin = ymax - 1;
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
		g.fillStyle = '#141414';
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
				g.strokeStyle = m === 1 ? '#4a4a4a' : '#2a2a2a';
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
				g.strokeStyle = v === 0 ? '#5c5c5c' : '#363636';
				line(g, L, y, L + pw, y);
				g.fillStyle = '#9a9a9a';
				g.fillText(String(Math.round(v * 100) / 100), L - 8, y);
			}
			g.save();
			g.translate(16, T + ph / 2); g.rotate(-Math.PI / 2);
			g.textAlign = 'center'; g.fillStyle = '#9a9a9a';
			g.fillText({ db: S.magAxis, dba: S.axDba, phon: S.axPhon, sone: S.axSone }[mode] || S.magAxis, 0, 0);
			g.restore();
		}
		// phase axis
		if (showPh) {
			g.textAlign = 'left'; g.textBaseline = 'middle';
			for (var d = pc - 180; d <= pc + 180; d += 45) {
				var yp = Math.round(YP(d)) + 0.5;
				if (!showMag) { g.strokeStyle = d === 0 ? '#5c5c5c' : '#363636'; line(g, L, yp, L + pw, yp); }
				g.fillStyle = '#e67e22';
				g.fillText(d + '°', L + pw + 8, yp);
			}
			g.save();
			g.translate(W - 10, T + ph / 2); g.rotate(Math.PI / 2);
			g.textAlign = 'center'; g.fillStyle = '#e67e22';
			g.fillText(S.phaseAxis, 0, 0);
			g.restore();
		}
		g.strokeStyle = '#5c5c5c';
		g.strokeRect(L + 0.5, T + 0.5, pw - 1, ph - 1);

		// traces
		g.save();
		g.beginPath(); g.rect(L, T, pw, ph); g.clip();
		traces.forEach(function (tr) {
			if (showMag) plot(g, tr.r.f, tr.v, X, Y, tr.color, tr.main ? 2.2 : 1.6, null);
			if (showPh) plot(g, tr.r.f, tr.r.ph, X, YP, tr.main ? '#e67e22' : tr.color, tr.main ? 1.8 : 1.2, tr.main ? null : [5, 4], true);
		});
		g.restore();

		if (!result) {
			g.fillStyle = '#9a9a9a'; g.textAlign = 'center'; g.textBaseline = 'middle';
			g.font = '14px system-ui,"Segoe UI",sans-serif';
			var noIO = !targets || !targets.sources.length || !targets.outputs.length;
			g.fillText(noIO ? S.needIO : (S[error] || S.singular), L + pw / 2, T + ph / 2);
		}

		// legend for held traces
		if (held.length) {
			g.font = '12px system-ui,"Segoe UI",sans-serif';
			g.textAlign = 'left'; g.textBaseline = 'middle';
			var ly = T + (settings.cursors ? 30 : 14), lx = L + 12;  // below the cursor tags
			traces.forEach(function (tr) {
				g.fillStyle = tr.color; g.fillRect(lx, ly - 1.5, 16, 3);
				g.fillStyle = '#e0e0e0'; g.fillText(tr.main ? S.current : tr.name, lx + 22, ly);
				ly += 17;
			});
		}

		// the two cursors: a line each, dots where they cross the traces, and a table with, for
		// the current trace and every held one, the readings at A and B, their difference
		// (B - A) and the slope between them
		var Finv = function (x) { return Math.pow(10, lf0 + (x - L) / pw * (lf1 - lf0)); };
		geom = { L: L, T: T, pw: pw, ph: ph, X: X, Finv: Finv };
		var showDb = showMag || !showPh, curBox = null;
		if (settings.cursors) {
			var fcs = [cursorFreq(0), cursorFreq(1)];
			CURSORS.forEach(function (c, i) {
				var cx = Math.round(X(fcs[i])) + 0.5;
				g.strokeStyle = c.color; g.lineWidth = i === dragCur ? 2 : 1;
				line(g, cx, T, cx, T + ph);
				g.lineWidth = 1;
				// the tag stays inside the plot when the cursor is at an edge
				var tx = Math.min(Math.max(cx, L + 7), L + pw - 7);
				g.fillStyle = c.color; g.fillRect(tx - 7, T, 14, 15);
				g.fillStyle = '#141414'; g.font = 'bold 11px system-ui,"Segoe UI",sans-serif';
				g.textAlign = 'center'; g.textBaseline = 'middle';
				g.fillText(c.name, tx, T + 8);
			});
			var sgn = function (v) { return v >= 0 ? '+' : ''; };
			// fixed decimals, without a "-0.00" for tiny negative values
			var fx = function (v, d) { var s = v.toFixed(d); return /^-0\.?0*$/.test(s) ? s.slice(1) : s; };
			var u = unit(), dec2 = isSone ? 3 : 2;
			var val = function (db, deg) {
				var s = [];
				if (showDb) s.push(isFinite(db) ? fx(db, dec2) + ' ' + u : '—');
				if (showPh) s.push(isFinite(deg) ? fx(deg, 1) + '°' : '—');
				return s.join('  ');
			};
			var dec = Math.log10(fcs[1] / fcs[0]), dfq = fcs[1] - fcs[0];
			var trows = [];
			traces.slice().reverse().forEach(function (tr) {
				var r = fcs.map(function (fc) { return { db: interp(tr.r.f, tr.v, fc), ph: interp(tr.r.f, tr.r.ph, fc) }; });
				r.forEach(function (p, i) {
					var cx = Math.round(X(fcs[i])) + 0.5;
					if (showMag && isFinite(p.db)) dot(g, cx, Y(p.db), tr.color);
					if (showPh && isFinite(p.ph)) dot(g, cx, YP(p.ph), tr.main ? '#e67e22' : tr.color);
				});
				var ddb = r[1].db - r[0].db, dph = r[1].ph - r[0].ph;
				var d = [];
				// in sone the comparison is a ratio: x2 is twice as loud
				if (showDb && isSone) d.push(r[0].db > 0 && isFinite(r[1].db) ? '×' + fx(r[1].db / r[0].db, 2) : '—');
				else if (showDb) d.push(isFinite(ddb) ? sgn(ddb) + fx(ddb, 2) + ' ' + u : '—');
				if (showPh) d.push(isFinite(dph) ? sgn(dph) + fx(dph, 1) + '°' : '—');
				// the slope between them, as in "-20 dB/decade" of a first-order roll-off
				var slope = showDb && dbScale && isFinite(ddb) && Math.abs(dec) > 1e-3 ? (ddb / dec).toFixed(1) + ' ' + u + '/dec' : '';
				trows.push({ c: tr.color, cells: [tr.main ? S.current : tr.name, val(r[0].db, r[0].ph), val(r[1].db, r[1].ph), d.join('  '), slope] });
			});
			if (trows.length) {
				var head = [{ t: '' }, { t: 'A  ' + fmtFreq(fcs[0]), c: CURSORS[0].color }, { t: 'B  ' + fmtFreq(fcs[1]), c: CURSORS[1].color },
					{ t: 'B−A  ' + (dfq < 0 ? '−' : '') + fmtFreq(Math.abs(dfq)), c: '#ffffff' }, { t: '' }];
				curBox = tableBox(g, head, trows, L, T, pw, ph);
			}
		}

		// hover readout (not while dragging a cursor), kept off the cursor table
		if (hover && dragCur < 0 && result && hover.x >= L && hover.x <= L + pw && hover.y >= T && hover.y <= T + ph) {
			var fh = Finv(hover.x);
			var hx = Math.round(hover.x) + 0.5;
			g.strokeStyle = 'rgba(255,255,255,0.4)'; g.setLineDash([3, 3]);
			line(g, hx, T, hx, T + ph); g.setLineDash([]);
			var rows = ['f = ' + fmtFreq(fh)];
			traces.slice().reverse().forEach(function (tr) {
				var vdb = interp(tr.r.f, tr.v, fh), vph = interp(tr.r.f, tr.r.ph, fh);
				if (showMag && isFinite(vdb)) {
					dot(g, hx, Y(vdb), tr.color);
				}
				if (showPh && isFinite(vph)) dot(g, hx, YP(vph), tr.main ? '#e67e22' : tr.color);
				var s = (tr.main ? '' : tr.name + ': ');
				if (showMag || !showPh) s += isFinite(vdb) ? vdb.toFixed(isSone ? 3 : 2) + ' ' + unit() : '—';
				if (showPh) s += (showMag ? '  ' : '') + vph.toFixed(1) + '°';
				rows.push({ t: s, c: tr.color });
			});
			readoutBox(g, rows, function (bw, bh) {
				var bx = hover.x + 14, by = hover.y + 14;
				if (bx + bw > L + pw) bx = hover.x - bw - 14;
				if (by + bh > T + ph) by = hover.y - bh - 14;
				if (curBox && bx < curBox.x + curBox.w && bx + bw > curBox.x && by < curBox.y + curBox.h && by + bh > curBox.y)
					by = curBox.y + curBox.h + 6;
				return [bx, by];
			});
		}
	}

	// the cursor table at the top right of the plot (left if it does not fit): a heading row of
	// cells {t, c} and rows {c: swatch color, cells: [name, ...]}, columns aligned.
	// Returns its rectangle.
	function tableBox(g, head, rows, L, T, pw, ph) {
		g.font = '12px system-ui,"Segoe UI",sans-serif';
		var n = head.length, wid = [];
		for (var j = 0; j < n; j++) {
			wid[j] = g.measureText(head[j].t).width;
			rows.forEach(function (r) { wid[j] = Math.max(wid[j], g.measureText(r.cells[j]).width); });
		}
		var gap = 16, bw = 20 + 8, bh = (rows.length + 1) * 17 + 8;
		wid.forEach(function (w, j) { bw += w + (j && w ? gap : 0); });
		var bx = L + pw - bw - 8, by = T + 22;
		if (bx < L + 8) bx = L + 8;
		g.fillStyle = 'rgba(30,30,30,0.92)';
		g.fillRect(bx, by, bw, bh);
		g.textBaseline = 'middle';
		var cell = function (t, j, x, y, color) {
			g.fillStyle = color;
			// the name column is left aligned, the numbers right aligned
			if (j === 0) { g.textAlign = 'left'; g.fillText(t, x, y); }
			else { g.textAlign = 'right'; g.fillText(t, x + wid[j], y); }
		};
		var drawRow = function (cells, y, colorOf) {
			var x = bx + 20;
			for (var j = 0; j < n; j++) {
				if (j && wid[j]) x += gap;
				cell(cells[j], j, x, y, colorOf(j));
				x += wid[j];
			}
		};
		drawRow(head.map(function (h) { return h.t; }), by + 12, function (j) { return head[j].c || '#ffffff'; });
		rows.forEach(function (r, i) {
			var y = by + 12 + (i + 1) * 17;
			g.fillStyle = r.c; g.fillRect(bx + 8, y - 1.5, 8, 3);
			drawRow(r.cells, y, function (j) { return j === 0 || j === n - 1 ? '#9a9a9a' : '#e0e0e0'; });
		});
		return { x: bx, y: by, w: bw, h: bh };
	}

	// a box of text rows: a string is a white heading, {t, c} a row with a swatch of color c.
	// place(width, height) gives its top left corner.
	function readoutBox(g, rows, place) {
		if (!rows.length) return;
		g.font = '12px system-ui,"Segoe UI",sans-serif';
		var bw = 0;
		rows.forEach(function (r) { bw = Math.max(bw, g.measureText(r.t || r).width); });
		bw += 20;
		var bh = rows.length * 17 + 8;
		var p = place(bw, bh), bx = p[0], by = p[1];
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
