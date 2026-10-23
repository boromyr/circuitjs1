/*
 * FFT spectrum analyzer for CircuitJS1.
 *
 * The simulator records the voltage of the chosen output at every time step
 * (FFTCapture.ts, exported as CircuitJS1.fftSelect() / fftSamples()).  This
 * file resamples the last N samples on a uniform grid (the simulation time step),
 * applies a window, transforms them and measures the usual figures: fundamental,
 * harmonics, THD and THD+N.  It is shown in a separate,
 * freely movable window (window.open + about:blank, filled from here), like the
 * Bode plot (bodeplot.js), and refreshes while the simulation runs.
 *
 * Opened from the menu (Scopes > FFT Spectrum..., or FFT in the menu bar).
 */
(function () {
	'use strict';

	var WIN_NAME = 'circuitjs-fft';
	var STORE = 'fftPlot.';
	var TRACE_COLORS = ['#2ecc71', '#e74c3c', '#b07cd8', '#1abc9c', '#f1c40f', '#95a5a6'];
	var SIZES = [1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144];
	var FMAX = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
	var CURSORS = [{ key: 'curA', name: 'A', color: '#f5d142' }, { key: 'curB', name: 'B', color: '#3fd0e8' }];

	// coherent gain, equivalent noise bandwidth and the half width (in bins) of the main
	// lobe, which is summed to get the power of a tone and left out of the noise
	var WINDOWS = {
		rect: { lobe: 1, f: function () { return 1; } },
		hann: { lobe: 2, f: function (x) { return 0.5 - 0.5 * Math.cos(2 * Math.PI * x); } },
		hamming: { lobe: 2, f: function (x) { return 0.54 - 0.46 * Math.cos(2 * Math.PI * x); } },
		// 7-term Blackman-Harris: sidelobes below -177 dB.  With the 4-term one (-92 dB, falling
		// 6 dB/octave) a strong tone leaks a floor and a skirt whose level changes with its phase
		// at every refresh, unless the block holds a whole number of its periods (see plan())
		bh: { lobe: 7, f: function (x) {
			var a = 2 * Math.PI * x;
			return 0.27105140069342 - 0.43329793923448 * Math.cos(a) + 0.21812299954311 * Math.cos(2 * a) -
				0.06592544638803 * Math.cos(3 * a) + 0.01081174209837 * Math.cos(4 * a) -
				0.00077658482522 * Math.cos(5 * a) + 0.00001388721735 * Math.cos(6 * a);
		} },
		bh4: { lobe: 4, f: function (x) {
			var a = 2 * Math.PI * x;
			return 0.35875 - 0.48829 * Math.cos(a) + 0.14128 * Math.cos(2 * a) - 0.01168 * Math.cos(3 * a);
		} },
		flattop: { lobe: 5, f: function (x) {
			var a = 2 * Math.PI * x;
			return 0.21557895 - 0.41663158 * Math.cos(a) + 0.277263158 * Math.cos(2 * a) -
				0.083578947 * Math.cos(3 * a) + 0.006947368 * Math.cos(4 * a);
		} }
	};

	var sim = null;
	var win = null;
	var ui = null;
	var timer = null;
	var lastOutKey = null;
	var targets = null;     // {outputs:[]}
	var spec = null;        // last spectrum, see analyze()
	var meas = null;        // measurements of spec
	var progress = 0;       // fraction of the samples needed that are recorded
	var held = [];          // frozen spectra for comparison
	var hover = null;       // {x, y}
	var geom = null;        // plot area and frequency axis of the last drawing, for the cursors
	var dragCur = -1;       // index in CURSORS of the cursor being dragged
	var interval = 200, lastTime = 0;
	var avg = null;         // {key, sum:[], n, list:[]} power average
	var lastSampleT = null;
	var winCache = {};

	var settings = {
		output: '',
		outputList: '',
		size: 'auto',
		window: 'bh',
		scale: 'dbv',
		logFreq: true,
		fmax: 'auto',
		yRange: 'auto',
		yMax: 0,
		yMin: -140,
		averages: 1,
		harmonics: 10,
		markers: true,
		fast: false,
		logVolts: false,
		cursors: false,
		curA: null,     // cursor frequencies (Hz), null = not placed yet
		curB: null
	};

	// ------------------------------------------------------------------
	// strings
	// ------------------------------------------------------------------

	var STRINGS = {
		en: {
			title: 'FFT Spectrum', output: 'Signal', points: 'Points', window: 'Window', scale: 'Scale',
			freqAxis: 'Frequency (Hz)', fmax: 'Max', log: 'Log', avg: 'Average', harm: 'Harmonics',
			markers: 'Markers', cursors: 'Cursors', cursorsTip: 'Two vertical cursors: drag them (or click in the plot) to read two points and their difference',
			logV: 'Log V', logVTip: 'Logarithmic voltage axis, so that small components are visible too', fast: 'Fast acquisition',
			speed: 'Speed', speedTip: 'Simulation Speed (the same as the slider of the simulator)',
			fastTip: 'While acquiring, run the simulation as fast as the computer allows, then back to the set speed', dbRange: 'dB', custom: 'Custom', auto: 'Auto', none: '(none)',
			hold: 'Hold trace', holdTip: 'Freeze the current spectrum to compare it with later changes',
			clear: 'Clear held', clearTip: 'Remove the held traces', csv: 'Copy CSV',
			csvTip: 'Copy the spectrum (frequency, V RMS, dBV) to the clipboard',
			restart: 'Restart', restartTip: 'Discard the recorded samples and the average, and acquire again',
			copied: 'Spectrum copied to the clipboard ({n} bins).', current: 'current', trace: 'trace',
			popup: 'Could not open the FFT window (popup blocked?).',
			noOutput: 'No signal: add a labeled node, an Output or a voltmeter.',
			needOut: 'Needs a labeled node, an Output or a voltmeter as the signal',
			acquiring: 'Acquiring: {n}%', paused: 'Start the simulation to acquire the samples',
			wins: { rect: 'Rectangular', hann: 'Hann', hamming: 'Hamming', bh: 'Blackman-Harris 7', bh4: 'Blackman-Harris 4', flattop: 'Flat top' },
			scales: { dbv: 'dBV (RMS)', dbc: 'dBc (rel. fundamental)', vrms: 'V RMS', vpk: 'V peak' },
			axis: { dbv: 'Level (dBV)', dbc: 'Level (dBc)', vrms: 'Amplitude (V RMS)', vpk: 'Amplitude (V peak)' },
			m: {
				title: 'Measurements', fund: 'Fundamental', level: 'Level', dc: 'DC', rms: 'RMS (total)', vpp: 'Peak-peak',
				thd: 'THD', thdn: 'THD+N',
				harmonics: 'Harmonics', h: 'H', freq: 'Freq.', noFund: 'No tone found'
			},
			info: 'N = {N}, fs = {fs}, Δf = {df}, T = {T}, {w}{avg}', avgOf: ', average {a}/{b}',
			lowRes: 'Resolution too low for this frequency: use more points (or Auto)',
			lowResAuto: 'Resolution too low for this frequency: lower the maximum frequency',
			node: 'Node «{n}»', out: 'Output #{n}', probe: 'Voltmeter #{n}',
			step: 'The time step changed: acquisition restarted.'
		},
		it: {
			title: 'Spettro FFT', output: 'Segnale', points: 'Punti', window: 'Finestra', scale: 'Scala',
			freqAxis: 'Frequenza (Hz)', fmax: 'Max', log: 'Log', avg: 'Media', harm: 'Armoniche',
			markers: 'Marcatori', cursors: 'Cursori', cursorsTip: 'Due cursori verticali: trascinali (o fai clic nel grafico) per leggere due punti e la loro differenza',
			logV: 'Log V', logVTip: 'Asse delle tensioni logaritmico, per vedere anche le componenti piccole', fast: 'Acquisizione veloce',
			speed: 'Velocità', speedTip: 'Velocità di simulazione (la stessa della barra del simulatore)',
			fastTip: 'Durante l\'acquisizione la simulazione va alla massima velocità possibile, poi torna alla velocità impostata', dbRange: 'dB', custom: 'Personalizzato', auto: 'Auto', none: '(nessuno)',
			hold: 'Fissa curva', holdTip: 'Congela lo spettro attuale per confrontarlo con le modifiche successive',
			clear: 'Cancella fissate', clearTip: 'Rimuove le curve fissate', csv: 'Copia CSV',
			csvTip: 'Copia lo spettro (frequenza, V RMS, dBV) negli appunti',
			restart: 'Ricomincia', restartTip: 'Scarta i campioni registrati e la media, e riacquisisce',
			copied: 'Spettro copiato negli appunti ({n} righe).', current: 'attuale', trace: 'curva',
			popup: 'Impossibile aprire la finestra FFT (popup bloccato?).',
			noOutput: 'Nessun segnale: aggiungi un\'etichetta (Labeled Node), un Output o un voltmetro.',
			needOut: 'Serve un nodo etichettato, un Output o un voltmetro come segnale',
			acquiring: 'Acquisizione: {n}%', paused: 'Avvia la simulazione per acquisire i campioni',
			wins: { rect: 'Rettangolare', hann: 'Hann', hamming: 'Hamming', bh: 'Blackman-Harris 7', bh4: 'Blackman-Harris 4', flattop: 'Flat top' },
			scales: { dbv: 'dBV (RMS)', dbc: 'dBc (rel. fondamentale)', vrms: 'V RMS', vpk: 'V picco' },
			axis: { dbv: 'Livello (dBV)', dbc: 'Livello (dBc)', vrms: 'Ampiezza (V RMS)', vpk: 'Ampiezza (V picco)' },
			m: {
				title: 'Misure', fund: 'Fondamentale', level: 'Livello', dc: 'DC', rms: 'RMS (totale)', vpp: 'Picco-picco',
				thd: 'THD', thdn: 'THD+N',
				harmonics: 'Armoniche', h: 'H', freq: 'Freq.', noFund: 'Nessun tono trovato'
			},
			info: 'N = {N}, fs = {fs}, Δf = {df}, T = {T}, {w}{avg}', avgOf: ', media {a}/{b}',
			lowRes: 'Risoluzione insufficiente per questa frequenza: usa più punti (o Auto)',
			lowResAuto: 'Risoluzione insufficiente per questa frequenza: riduci la frequenza massima',
			node: 'Nodo «{n}»', out: 'Uscita (Output) #{n}', probe: 'Voltmetro #{n}',
			step: 'Il passo temporale è cambiato: acquisizione ricominciata.'
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
		if (settings.size !== 'auto' && SIZES.indexOf(settings.size) < 0) settings.size = 'auto';
		if (!WINDOWS[settings.window]) settings.window = 'bh';
		// fast acquisition overrides the simulation speed, so it is never turned on by itself:
		// each session starts with it off
		settings.fast = false;
	})();
	function saveSettings() { save('settings', settings); }

	function num(v) { return typeof v === 'number' && isFinite(v); }

	// ------------------------------------------------------------------
	// formatting helpers
	// ------------------------------------------------------------------

	function trim(v) {
		var a = Math.abs(v);
		var s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
		return s.indexOf('.') < 0 ? s : s.replace(/\.?0+$/, '');
	}
	function fmtFreq(f) {
		if (f >= 1e6) return trim(f / 1e6) + ' MHz';
		if (f >= 1e3) return trim(f / 1e3) + ' kHz';
		return trim(f) + ' Hz';
	}
	function fmtFreqPrecise(f, df) {
		// enough digits to show a tenth of a bin
		var u = f >= 1e6 ? 1e6 : f >= 1e3 ? 1e3 : 1, name = u === 1e6 ? ' MHz' : u === 1e3 ? ' kHz' : ' Hz';
		var d = Math.max(0, Math.min(6, Math.ceil(-Math.log10(df / 10 / u))));
		return (f / u).toFixed(d) + name;
	}
	function fmtAxisFreq(f) {
		if (f >= 1e6) return trim(f / 1e6) + 'M';
		if (f >= 1e3) return trim(f / 1e3) + 'k';
		return trim(f);
	}
	function fmtV(v) {
		var a = Math.abs(v);
		if (a === 0) return '0 V';
		if (a >= 1) return v.toPrecision(4) + ' V';
		if (a >= 1e-3) return (v * 1e3).toPrecision(4) + ' mV';
		if (a >= 1e-6) return (v * 1e6).toPrecision(4) + ' µV';
		if (a >= 1e-9) return (v * 1e9).toPrecision(4) + ' nV';
		if (a >= 1e-12) return (v * 1e12).toPrecision(4) + ' pV';
		if (a >= 1e-15) return (v * 1e15).toPrecision(4) + ' fV';
		return v.toExponential(3) + ' V';
	}
	function fmtAxisV(v) {
		var a = Math.abs(v);
		if (a === 0) return '0';
		if (a >= 1) return trim(v);
		if (a >= 1e-3) return trim(v * 1e3) + 'm';
		if (a >= 1e-6) return trim(v * 1e6) + 'µ';
		if (a >= 1e-9) return trim(v * 1e9) + 'n';
		if (a >= 1e-12) return trim(v * 1e12) + 'p';
		return trim(v * 1e15) + 'f';
	}
	function fmtPct(r) {
		var p = r * 100;
		if (p >= 10) return p.toFixed(2) + ' %';
		if (p >= 0.01) return p.toFixed(4) + ' %';
		return p.toExponential(2) + ' %';
	}
	function fmtTime(t) {
		if (t >= 1) return trim(t) + ' s';
		if (t >= 1e-3) return trim(t * 1e3) + ' ms';
		return trim(t * 1e6) + ' µs';
	}
	function fmtDb(v) { return isFinite(v) ? v.toFixed(2) + ' dB' : '—'; }
	function db20(x) { return x > 0 ? 20 * Math.log10(x) : -Infinity; }
	function db10(x) { return x > 0 ? 10 * Math.log10(x) : -Infinity; }

	// ------------------------------------------------------------------
	// data from the simulator
	// ------------------------------------------------------------------

	function outputLabel(o) {
		if (o.key[0] === 'L') return fmt(S.node, o.name);
		if (o.key[0] === 'O') return fmt(S.out, o.num);
		return fmt(S.probe, o.num);
	}

	// the last n samples on a uniform grid of step dt ending at the last sample, by linear
	// interpolation; null (with progress set) if fewer have been recorded
	function resample(t, v, n, dt) {
		var len = t.length;
		if (len < 2) { progress = 0; return null; }
		var tEnd = t[len - 1], tStart = tEnd - (n - 1) * dt;
		if (t[0] > tStart + dt * 1e-6) {
			progress = Math.max(0, Math.min(0.999, (tEnd - t[0]) / ((n - 1) * dt)));
			return null;
		}
		progress = 1;
		var out = new Float64Array(n);
		var j = 0;
		for (var i = 0; i < n; i++) {
			var ti = tStart + i * dt;
			while (j < len - 2 && t[j + 1] < ti) j++;
			var t0 = t[j], t1 = t[j + 1];
			var a = t1 > t0 ? (ti - t0) / (t1 - t0) : 0;
			if (a < 0) a = 0; else if (a > 1) a = 1;
			out[i] = v[j] + (v[j + 1] - v[j]) * a;
		}
		return out;
	}

	function blockStats(x) {
		var mean = 0, sq = 0, lo = Infinity, hi = -Infinity;
		for (var i = 0; i < x.length; i++) {
			var v = x[i];
			mean += v; sq += v * v;
			if (v < lo) lo = v; if (v > hi) hi = v;
		}
		return { mean: mean / x.length, rms: Math.sqrt(sq / x.length), vpp: hi - lo };
	}

	function windowTable(name, n) {
		var key = name + n;
		if (winCache[key]) return winCache[key];
		var f = WINDOWS[name].f, w = new Float64Array(n), sum = 0, sum2 = 0;
		for (var i = 0; i < n; i++) { w[i] = f(i / n); sum += w[i]; sum2 += w[i] * w[i]; }
		winCache = {};
		return (winCache[key] = { w: w, cg: sum / n, enbw: n * sum2 / (sum * sum) });
	}

	// cos and -sin of 2 pi k / n for k < n/2, each computed on its own: the usual recurrence
	// from one twiddle factor to the next drifts, and leaves a floor at -250 dB with 64k points
	// (-230 dB with 256k), within the range of the plot
	var twCache = {};
	function twiddles(n) {
		if (twCache[n]) return twCache[n];
		var c = new Float64Array(n / 2), s = new Float64Array(n / 2);
		for (var k = 0; k < n / 2; k++) { c[k] = Math.cos(2 * Math.PI * k / n); s[k] = -Math.sin(2 * Math.PI * k / n); }
		if (Object.keys(twCache).length > 4) twCache = {};
		return (twCache[n] = { c: c, s: s });
	}

	// in-place radix-2 FFT of re/im (length a power of 2)
	function fft(re, im) {
		var n = re.length, i, j, k, len, tw = twiddles(n);
		for (i = 1, j = 0; i < n; i++) {
			var bit = n >> 1;
			for (; j & bit; bit >>= 1) j ^= bit;
			j ^= bit;
			if (i < j) {
				var tr = re[i]; re[i] = re[j]; re[j] = tr;
				var ti = im[i]; im[i] = im[j]; im[j] = ti;
			}
		}
		for (len = 2; len <= n; len <<= 1) {
			var half = len >> 1, step = n / len;
			for (i = 0; i < n; i += len) {
				for (k = 0; k < half; k++) {
					var a = i + k, b = a + half, cr = tw.c[k * step], ci = tw.s[k * step];
					var xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
					re[b] = re[a] - xr; im[b] = im[a] - xi;
					re[a] += xr; im[a] += xi;
				}
			}
		}
	}

	// chirp of Bluestein's algorithm for length n, and the FFT of its conjugate laid out for
	// a circular convolution of length m (a power of 2, at least 2n - 1)
	var czCache = null;
	function chirp(n) {
		if (czCache && czCache.n === n) return czCache;
		var m = 1;
		while (m < 2 * n - 1) m <<= 1;
		var wr = new Float64Array(n), wi = new Float64Array(n), br = new Float64Array(m), bi = new Float64Array(m);
		for (var i = 0; i < n; i++) {
			// exp(-i pi i^2 / n), with i^2 reduced first (exact for any length used here)
			var a = Math.PI * ((i * i) % (2 * n)) / n;
			wr[i] = Math.cos(a); wi[i] = -Math.sin(a);
		}
		br[0] = 1;
		for (i = 1; i < n; i++) { br[i] = br[m - i] = wr[i]; bi[i] = bi[m - i] = -wi[i]; }
		fft(br, bi);
		return (czCache = { n: n, m: m, wr: wr, wi: wi, br: br, bi: bi });
	}

	// DFT of a real block of any length: re/im of bins 0 to n/2.  A power of 2 goes straight to
	// the FFT, other lengths (a whole number of periods, see plan()) through Bluestein's
	// algorithm, a convolution with a chirp done with two more FFTs
	function dft(x) {
		var n = x.length, nb = (n >> 1) + 1, i, re, im;
		if ((n & (n - 1)) === 0) {
			re = Float64Array.from(x); im = new Float64Array(n);
			fft(re, im);
			return { re: re, im: im };
		}
		var cz = chirp(n), m = cz.m, ar = new Float64Array(m), ai = new Float64Array(m);
		for (i = 0; i < n; i++) { ar[i] = x[i] * cz.wr[i]; ai[i] = x[i] * cz.wi[i]; }
		fft(ar, ai);
		// times the transform of the conjugate chirp, conjugated: the next FFT is then the inverse one
		for (i = 0; i < m; i++) {
			var r = ar[i] * cz.br[i] - ai[i] * cz.bi[i], q = ar[i] * cz.bi[i] + ai[i] * cz.br[i];
			ar[i] = r; ai[i] = -q;
		}
		fft(ar, ai);
		re = new Float64Array(nb); im = new Float64Array(nb);
		for (var k = 0; k < nb; k++) {
			var cr = ar[k] / m, ci = -ai[k] / m;
			re[k] = cr * cz.wr[k] - ci * cz.wi[k];
			im[k] = cr * cz.wi[k] + ci * cz.wr[k];
		}
		return { re: re, im: im };
	}

	// spectrum of the block x: rms[k] is the RMS amplitude of a tone at bin k, pw[k] the
	// power of bin k corrected for the window's noise bandwidth (so that summing a tone's
	// lobe or a band of noise gives its power)
	function analyze(x, dt, sumPower) {
		var n = x.length, wt = windowTable(settings.window, n);
		var xw = new Float64Array(n);
		var mean = 0, sq = 0, lo = Infinity, hi = -Infinity;
		for (var i = 0; i < n; i++) {
			var v = x[i];
			mean += v; sq += v * v;
			if (v < lo) lo = v; if (v > hi) hi = v;
			xw[i] = v * wt.w[i];
		}
		var X = dft(xw), re = X.re, im = X.im;
		var nb = (n >> 1) + 1, p2 = new Float64Array(nb);
		var norm = 1 / (n * wt.cg);
		// DC as the windowed mean (bin 0, with its sign): a plain mean over a block that is not
		// a whole number of periods still contains part of the signal
		mean = re[0] * norm;
		for (var k = 0; k < nb; k++) {
			var a = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * norm;
			// one-sided: bins other than DC and Nyquist carry half of the tone each side
			var pk = (k === 0 || 2 * k === n) ? a : 2 * a;
			// squared RMS amplitude (DC is its own RMS value)
			p2[k] = k === 0 ? pk * pk : pk * pk / 2;
		}
		// power average over the last spectra
		if (sumPower) p2 = sumPower(p2);
		var rms = new Float64Array(nb), pw = new Float64Array(nb);
		for (k = 0; k < nb; k++) { rms[k] = Math.sqrt(p2[k]); pw[k] = p2[k] / wt.enbw; }
		return {
			n: n, dt: dt, df: 1 / (n * dt), rms: rms, pw: pw, lobe: WINDOWS[settings.window].lobe,
			mean: mean, totalRms: Math.sqrt(sq / n), vpp: hi - lo
		};
	}

	// fundamental, harmonics and noise figures of a spectrum
	function measure(s, hint) {
		// bins above kband are in the transition band of the decimation filter: they are
		// neither noise nor harmonics
		// with a whole number of periods in the block (s.coherent) DC and the tones of the source
		// frequency fall exactly on bins, where a cosine-sum window of L terms spreads them over
		// L - 1 bins each side, instead of L
		var nb = s.rms.length, L = s.coherent ? s.lobe - 1 : s.lobe, used = new Uint8Array(nb), kband = Math.min(nb - 1, s.kband || nb - 1);
		var m = { dc: s.mean, totalRms: s.totalRms, vpp: s.vpp, harmonics: [] };
		// power of a tone: its main lobe, without the bins already given to another tone
		function lobePower(k) {
			var p = 0;
			for (var j = Math.max(0, k - L); j <= Math.min(nb - 1, k + L); j++) if (!used[j]) { p += s.pw[j]; used[j] = 1; }
			return p;
		}
		// DC and its leakage
		for (var j = 0; j <= Math.min(nb - 1, L); j++) used[j] = 1;
		for (j = kband + 1; j < nb; j++) used[j] = 1;
		var k0 = -1, best = 0;
		for (var k = L + 1; k < kband; k++) if (s.rms[k] > best) { best = s.rms[k]; k0 = k; }
		// prefer the source frequency, when a tone is there (the strongest component can be
		// a harmonic, or a low frequency drift)
		if (hint > 0) {
			var kh0 = Math.round(hint / s.df), kb = -1;
			for (j = Math.max(L + 1, kh0 - 2); j <= Math.min(kband - 1, kh0 + 2); j++) if (kb < 0 || s.rms[j] > s.rms[kb]) kb = j;
			if (kb > 0 && s.rms[kb] > best * 1e-3) k0 = kb;
		}
		if (k0 < 0 || best <= 0) { m.fund = null; return m; }
		// a fundamental other than the source frequency is between bins
		var onBin = s.coherent && hint > 0 && k0 === kh0;
		if (!onBin) L = s.lobe;
		// the fundamental lobe must stay clear of DC and of the second harmonic
		m.lowRes = k0 < 2 * L + 1;
		// frequency between bins from the parabola through the log magnitudes
		var a = Math.log(Math.max(s.rms[k0 - 1], 1e-300)), b = Math.log(s.rms[k0]), c = Math.log(Math.max(s.rms[k0 + 1], 1e-300));
		var d = !onBin && (a - 2 * b + c) !== 0 ? 0.5 * (a - c) / (a - 2 * b + c) : 0;
		if (!isFinite(d) || Math.abs(d) > 0.5) d = 0;
		var p1 = lobePower(k0);
		var kf = k0 + d;
		m.fund = { k: k0, f: kf * s.df, rms: Math.sqrt(p1), power: p1 };
		var ph = 0, kmax = kband - L;
		for (var h = 2; h <= settings.harmonics; h++) {
			var kc = Math.round(h * kf);
			if (kc > kmax) break;
			// the strongest bin next to the expected one
			var kh = kc;
			for (j = kc - 1; j <= kc + 1; j++) if (j > 0 && j < nb && s.rms[j] > s.rms[kh]) kh = j;
			var p = lobePower(kh);
			ph += p;
			m.harmonics.push({ h: h, k: kh, f: h * kf * s.df, rms: Math.sqrt(p), power: p });
		}
		var pn = 0;
		for (k = 0; k < nb; k++) if (!used[k]) pn += s.pw[k];
		m.thd = Math.sqrt(ph / p1);
		m.thdn = Math.sqrt((ph + pn) / p1);
		return m;
	}

	function averager(key, count) {
		if (!avg || avg.key !== key || avg.count !== count) avg = { key: key, count: count, list: [] };
		return function (p2) {
			avg.list.push(p2);
			while (avg.list.length > count) avg.list.shift();
			var n = p2.length, out = new Float64Array(n);
			avg.list.forEach(function (q) { for (var i = 0; i < n; i++) out[i] += q[i]; });
			for (var i = 0; i < n; i++) out[i] /= avg.list.length;
			return out;
		};
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
		'#main{flex:1;display:flex;min-height:120px}' +
		'#wrap{flex:1;position:relative;min-width:200px}' +
		'canvas{position:absolute;inset:0;width:100%;height:100%;display:block}' +
		'#meas{width:250px;flex:none;overflow:auto;background:var(--panel);border-left:1px solid var(--border);padding:8px 10px;font-size:12px}' +
		'#meas h3{margin:2px 0 6px;font-size:12px;font-weight:600;color:var(--dim);text-transform:uppercase;letter-spacing:.04em}' +
		'#meas table{width:100%;border-collapse:collapse;margin-bottom:10px}' +
		'#meas td{padding:2px 0;white-space:nowrap}' +
		'#meas td.v{text-align:right;font-variant-numeric:tabular-nums}' +
		'#meas td.k{color:var(--dim)}' +
		'#meas .big td{font-size:13px}' +
		'#meas .harm td{text-align:right;font-variant-numeric:tabular-nums}' +
		'#meas .harm td:first-child{text-align:left;color:var(--dim)}' +
		'#meas .harm tr.hd td{color:var(--dim);border-bottom:1px solid var(--border)}' +
		'.status{padding:5px 12px;color:var(--dim);font-size:12px;border-top:1px solid var(--border);background:var(--panel);min-height:26px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
		'.status b{color:#e6b450;font-weight:600}';

	function options(list) {
		return list.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('');
	}

	function html() {
		return '' +
		'<div id="root">' +
		'<div class="bar">' +
		'<label><span class="lbl">' + S.output + '</span> <select id="selOut"></select></label>' +
		'<label><span class="lbl">' + S.points + '</span> <select id="selN"><option value="auto">' + S.auto + '</option>' +
			options(SIZES.map(function (n) { return [n, n >= 1024 ? (n / 1024) + 'k' : n]; })) + '</select></label>' +
		'<label><span class="lbl">' + S.window + '</span> <select id="selWin">' +
			options(['bh', 'bh4', 'hann', 'hamming', 'flattop', 'rect'].map(function (w) { return [w, S.wins[w]]; })) + '</select></label>' +
		'<label><span class="lbl">' + S.avg + '</span> <select id="selAvg">' +
			options([1, 2, 4, 8, 16, 32].map(function (a) { return [a, a === 1 ? '—' : '×' + a]; })) + '</select></label>' +
		'<span class="sep"></span>' +
		'<label><span class="lbl">' + S.scale + '</span> <select id="selScale">' +
			options(['dbv', 'dbc', 'vrms', 'vpk'].map(function (s) { return [s, S.scales[s]]; })) + '</select></label>' +
		'<label id="lbLogV" title="' + S.logVTip + '"><input type="checkbox" id="cbLogV"> ' + S.logV + '</label>' +
		'<label id="lbY"><span class="lbl">' + S.dbRange + '</span> <select id="selY">' +
			'<option value="auto">' + S.auto + '</option><option value="20,-120">+20 … −120</option>' +
			'<option value="0,-100">0 … −100</option><option value="0,-140">0 … −140</option>' +
			'<option value="0,-180">0 … −180</option><option value="custom">' + S.custom + '</option></select></label>' +
		'<label id="lbYc"><input type="number" id="inYmax" step="10"> … <input type="number" id="inYmin" step="10"></label>' +
		'<span class="sep"></span>' +
		'<label><input type="checkbox" id="cbLog"> ' + S.log + '</label>' +
		'<label><span class="lbl">' + S.fmax + '</span> <select id="selFmax"><option value="auto">' + S.auto + '</option>' +
			options(FMAX.map(function (f) { return [f, fmtFreq(f)]; })) + '</select></label>' +
		'<label><span class="lbl">' + S.harm + '</span> <select id="selH">' +
			options([5, 10, 20, 40].map(function (h) { return [h, h]; })) + '</select></label>' +
		'<label><input type="checkbox" id="cbMark"> ' + S.markers + '</label>' +
		'<label title="' + S.cursorsTip + '"><input type="checkbox" id="cbCur"> ' + S.cursors + '</label>' +
		'<label title="' + S.fastTip + '"><input type="checkbox" id="cbFast"> ' + S.fast + '</label>' +
		'<label title="' + S.speedTip + '"><span class="lbl">' + S.speed + '</span> <input type="range" id="inSpeed"></label>' +
		'<span class="sep"></span>' +
		'<button id="btHold" title="' + S.holdTip + '">' + S.hold + '</button>' +
		'<button id="btClear" title="' + S.clearTip + '">' + S.clear + '</button>' +
		'<button id="btCsv" title="' + S.csvTip + '">' + S.csv + '</button>' +
		'<button id="btRestart" title="' + S.restartTip + '">' + S.restart + '</button>' +
		'</div>' +
		'<div id="main"><div id="wrap"><canvas id="cv"></canvas></div><div id="meas"></div></div>' +
		'<div class="status" id="status"></div>' +
		'</div>';
	}

	function open() {
		if (!sim) return;
		if (win && !win.closed) { win.focus(); return; }
		var g = load('geom', null);
		var feat = 'width=' + (g ? g.w : 1100) + ',height=' + (g ? g.h : 640);
		if (g && num(g.x) && num(g.y)) feat += ',left=' + g.x + ',top=' + g.y;
		win = window.open('', WIN_NAME, feat);
		if (!win) {
			alert(S.popup);
			return;
		}
		buildUI();
		// some engines replace the initial about:blank document once it "loads"
		setTimeout(function () { if (win && !win.closed && !win.document.getElementById('root')) buildUI(); }, 300);
		lastTime = 0;
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
			doc: d, cv: $('cv'), wrap: $('wrap'), status: $('status'), meas: $('meas'),
			selOut: $('selOut'), selN: $('selN'), selWin: $('selWin'), selAvg: $('selAvg'), selScale: $('selScale'),
			selY: $('selY'), lbY: $('lbY'), lbYc: $('lbYc'), inYmax: $('inYmax'), inYmin: $('inYmin'),
			cbLog: $('cbLog'), selFmax: $('selFmax'), selH: $('selH'), cbMark: $('cbMark'), cbCur: $('cbCur'), cbFast: $('cbFast'), cbLogV: $('cbLogV'), lbLogV: $('lbLogV'), inSpeed: $('inSpeed')
		};
		lastOutKey = null;
		ui.selN.value = settings.size;
		ui.selWin.value = settings.window;
		ui.selAvg.value = settings.averages;
		if (ui.selAvg.value === '') ui.selAvg.value = settings.averages = 1;
		ui.selScale.value = settings.scale;
		if (ui.selScale.value === '') ui.selScale.value = settings.scale = 'dbv';
		ui.selY.value = settings.yRange;
		if (ui.selY.value === '') ui.selY.value = settings.yRange = 'auto';
		ui.inYmax.value = settings.yMax; ui.inYmin.value = settings.yMin;
		ui.cbLog.checked = settings.logFreq;
		ui.selFmax.value = settings.fmax;
		if (ui.selFmax.value === '') ui.selFmax.value = settings.fmax = 'auto';
		ui.selH.value = settings.harmonics;
		if (ui.selH.value === '') ui.selH.value = settings.harmonics = 10;
		ui.cbMark.checked = settings.markers;
		ui.cbCur.checked = settings.cursors;
		ui.cbFast.checked = settings.fast;
		ui.cbLogV.checked = settings.logVolts;
		try { ui.inSpeed.min = 0; ui.inSpeed.max = sim.getSimSpeedMax(); ui.inSpeed.value = sim.getSimSpeed(); } catch (e) {}
		ui.inSpeed.oninput = function () { try { sim.setSimSpeed(+ui.inSpeed.value); } catch (e) {} };
		ui.inSpeed.onpointerdown = function () { ui.speedDrag = true; };
		ui.inSpeed.onpointerup = ui.inSpeed.onpointercancel = function () { ui.speedDrag = false; };
		showRangeControls();

		function changed(reacquire) {
			settings.size = ui.selN.value === 'auto' ? 'auto' : +ui.selN.value;
			settings.window = ui.selWin.value;
			settings.averages = +ui.selAvg.value;
			settings.scale = ui.selScale.value;
			settings.yRange = ui.selY.value;
			var a = parseFloat(ui.inYmax.value), b = parseFloat(ui.inYmin.value);
			if (isFinite(a)) settings.yMax = a;
			if (isFinite(b)) settings.yMin = b;
			settings.logFreq = ui.cbLog.checked;
			settings.fmax = ui.selFmax.value;
			settings.harmonics = +ui.selH.value;
			settings.markers = ui.cbMark.checked;
			settings.cursors = ui.cbCur.checked;
			settings.fast = ui.cbFast.checked;
			settings.logVolts = ui.cbLogV.checked;
			settings.output = ui.selOut.value;
			settings.outputList = lastOutKey;
			saveSettings();
			showRangeControls();
			if (reacquire) { avg = null; lastSampleT = null; lastTime = 0; tick(); }
			else draw();
		}
		ui.selScale.onchange = ui.selY.onchange = ui.cbLog.onchange = ui.selFmax.onchange = ui.cbMark.onchange = ui.cbCur.onchange = ui.cbFast.onchange = ui.cbLogV.onchange =
			function () { changed(false); };
		ui.inYmax.oninput = ui.inYmin.oninput = function () { changed(false); };
		ui.selN.onchange = ui.selWin.onchange = ui.selAvg.onchange = ui.selOut.onchange = ui.selH.onchange =
			function () { changed(true); };
		$('btHold').onclick = function () {
			if (!spec) return;
			held.push({ name: currentName(), color: TRACE_COLORS[held.length % TRACE_COLORS.length], s: spec, m: meas });
			draw();
		};
		$('btClear').onclick = function () { held = []; draw(); };
		$('btCsv').onclick = copyCsv;
		$('btRestart').onclick = function () {
			try { sim.fftClear(); } catch (e) {}
			avg = null; spec = null; meas = null; lastSampleT = null; progress = 0; lastTime = 0;
			draw();
		};

		hookCursors();
		win.onresize = function () { draw(); saveGeom(); };
		win.onbeforeunload = function () {
			saveGeom();
		};
		draw();
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
		return Math.min(Math.max(f, geom.fmin), geom.fmax);
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

	function showRangeControls() {
		var isDb = settings.scale === 'dbv' || settings.scale === 'dbc';
		ui.lbY.style.display = isDb ? '' : 'none';
		ui.lbLogV.style.display = isDb ? 'none' : '';
		ui.lbYc.style.display = isDb && settings.yRange === 'custom' ? '' : 'none';
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
		if (!spec) return;
		var lines = ['freq_Hz;V_rms;dBV'];
		for (var k = 0; k < spec.rms.length; k++)
			lines.push((k * spec.df).toPrecision(8) + ';' + spec.rms[k].toExponential(6) + ';' + db20(spec.rms[k]).toFixed(3));
		var text = lines.join('\n');
		var done = function () { setStatus(fmt(S.copied, spec.rms.length)); };
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

	// fill the signal selector when the choices change; the previous choice is kept if it
	// was made in the same circuit (same list), otherwise an output is picked
	function syncOutputs(list) {
		var sel = ui.selOut;
		var key = list.map(function (o) { return o.key + '=' + outputLabel(o); }).join('|');
		if (key !== lastOutKey) {
			var cands = [sel.value, settings.output];
			sel.innerHTML = '';
			if (!list.length) addOpt(sel, '', S.none);
			list.forEach(function (o) { addOpt(sel, o.key, outputLabel(o)); });
			var pick = null;
			for (var c = 0; c < cands.length && !pick; c++)
				list.forEach(function (o) { if (!pick && cands[c] && o.key === cands[c]) pick = o; });
			if (!pick && list.length) pick = pickOutput(list);
			sel.value = pick ? pick.key : '';
			lastOutKey = key;
		}
		return sel.value;
	}

	function pickOutput(list) {
		for (var i = 0; i < list.length; i++) if (/out/i.test(list[i].key)) return list[i];
		for (i = 0; i < list.length; i++) if (list[i].key[0] === 'O') return list[i];
		for (i = 0; i < list.length; i++) if (list[i].key[0] === 'P') return list[i];
		return list[list.length - 1];
	}

	var running = false, lastDt = null, lastPlan = null, lastHint = null, autoF0 = 0, lastPreview = 0;

	// the lowest frequency of the AC sources: the signal to analyze, as a rule
	function sourceFrequency(sources) {
		var f = 0;
		(sources || []).forEach(function (s) { if (s.ac && s.freq > 0 && (!f || s.freq < f)) f = s.freq; });
		return f;
	}

	// With "Auto" points the capture lasts about AUTO_CYCLES periods of the source, so the
	// fundamental is at least 16 bins from DC (clear of the 7-bin main lobes) and its harmonics are well apart whatever its frequency.
	// That can be many time steps (0.5 s of a 40 Hz signal is 100000 steps of 5 us): they are
	// low-pass filtered and decimated by r so the FFT stays at most AUTO_MAX_FFT points.
	// Fixed points use every time step.  raw is the number of time steps needed.
	// With a source frequency the block then holds a whole number of its periods (see
	// wholePeriods()): the size is near the power of 2 chosen (a fixed one is not exceeded).
	var AUTO_CYCLES = 16, AUTO_DF = 5, PREVIEW_CYCLES = 5, AUTO_MIN_FFT = 4096, AUTO_MAX_FFT = 16384, AUTO_LIMIT_FFT = 262144, MAX_RAW = 600000;
	function plan(dt, hint) {
		if (settings.size !== 'auto') {
			var nf = hint > 0 ? wholePeriods(settings.size, 1 / (hint * dt)) : settings.size;
			return { n: nf, r: 1, raw: nf, key: 'n' + nf };
		}
		// a self-oscillating circuit has no source frequency: use the last measured one
		// (rounded to a power of 2, so the plan does not change at every refresh)
		var f0 = hint > 0 ? hint : autoF0 > 0 ? autoF0 : 1000;
		// at least AUTO_CYCLES periods, and a resolution of AUTO_DF Hz or better (low frequencies)
		var need = Math.min(MAX_RAW, Math.ceil(Math.max(AUTO_CYCLES / f0, 1 / AUTO_DF) / dt));
		// decimate only as far as the harmonics measured (and the chosen maximum frequency) stay
		// in the pass band; a high fundamental then needs a larger FFT, up to AUTO_LIMIT_FFT
		var band = (settings.harmonics + 1) * f0;
		if (settings.fmax !== 'auto') band = Math.max(band, +settings.fmax);
		var rMax = PASSBAND / (dt * band);
		var r = 1;
		while (need / r > AUTO_MAX_FFT && r * 2 <= rMax) r *= 2;
		var n = AUTO_MIN_FFT;
		while (n < need / r && n < AUTO_LIMIT_FFT) n *= 2;
		if (hint > 0) n = wholePeriods(n, 1 / (hint * dt * r), Math.max(n, Math.min(2 * n, AUTO_LIMIT_FFT, Math.floor(MAX_RAW / r))));
		var raw = r > 1 ? (n - 1) * r + firTaps(r) : n;
		return { n: n, r: r, raw: raw, key: n + 'x' + r };
	}

	// whether n points of step dt (as cycles of the source: f0 dt) hold a whole number of periods
	function isWhole(n, cycles) {
		var c = n * cycles;
		return cycles > 0 && c >= 1 && Math.abs(c - Math.round(c)) < 1e-6;
	}

	// The number of points closest to n0 (from 3/4 of it up to nlim) that holds a whole number of
	// periods of p points, or failing that the closest to it.  The source frequency and its
	// harmonics then fall exactly on bins, where a cosine-sum window leaks nothing at all:
	// otherwise its leakage (from -180 dB down with the 7-term window) changes with the phase
	// of the signal at every refresh.  (122 Hz with 5 us steps takes 61 periods, for example.)
	function wholePeriods(n0, p, nlim) {
		var c0 = Math.floor(n0 / p), lo = Math.max(1, Math.ceil(0.75 * n0 / p)), hi = Math.floor(Math.max(n0, nlim || n0) / p);
		if (!(c0 >= 1)) return n0;
		var best = n0, bestErr = Infinity;
		// the nearest first, below and above in turn; a farther one has to fit much better
		for (var i = 0; c0 - i >= lo || c0 + i < hi; i++) {
			for (var c = c0 - i; c <= c0 + i + 1; c += 2 * i + 1) {
				if (c < lo || c > hi) continue;
				var n = Math.round(c * p), err = Math.abs(c * p - n) / p;   // off a bin by err
				if (n >= 16 && err < bestErr / 4) { best = n; bestErr = err; }
			}
			if (bestErr < 1e-7) break;
		}
		return best;
	}

	// Decimation filter: windowed-sinc low pass (Kaiser, stop band below -160 dB) cutting at half
	// the new sampling rate.  Above PASSBAND (as a fraction of it) is the transition band, left
	// out of the plot and the measurements; what lies above 1 - PASSBAND, which would fold back
	// into the band below, is in the stop band.
	var PASSBAND = 0.36, KAISER_BETA = 17, firCache = {};
	function firTaps(r) { return 40 * r + 1; }
	function besselI0(x) {
		var s = 1, t = 1;
		for (var k = 1; k < 500 && t > s * 1e-17; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; }
		return s;
	}
	function firFilter(r) {
		if (firCache[r]) return firCache[r];
		var m = firTaps(r), c = (m - 1) / 2, fc = 0.5 / r, h = new Float64Array(m), sum = 0, i0 = besselI0(KAISER_BETA);
		for (var i = 0; i < m; i++) {
			var x = i - c, s = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x), u = x / c;
			h[i] = s * besselI0(KAISER_BETA * Math.sqrt(Math.max(0, 1 - u * u))) / i0; sum += h[i];
		}
		for (i = 0; i < m; i++) h[i] /= sum;
		return (firCache[r] = h);
	}
	function decimate(x, r, n) {
		var h = firFilter(r), m = h.length, out = new Float64Array(n);
		for (var i = 0; i < n; i++) {
			var acc = 0, o = i * r;
			for (var j = 0; j < m; j++) acc += h[j] * x[o + j];
			out[i] = acc;
		}
		return out;
	}

	function tick() {
		if (!win || win.closed) {
			if (timer) { clearInterval(timer); timer = null; }
			try { sim.fftStop(); } catch (e) {}
			win = null; ui = null; avg = null; spec = null; meas = null;
			return;
		}
		if (!ui || !win.document.getElementById('root')) buildUI();
		// follow the slider of the simulator, unless this one is being moved
		if (ui.inSpeed && !ui.speedDrag) try { ui.inSpeed.value = sim.getSimSpeed(); } catch (e) {}
		var now = Date.now();
		if (now - lastTime < interval) return;
		lastTime = now;
		try {
			targets = sim.getACTargets();
			var outKey = syncOutputs(targets.outputs);
			if (outKey !== settings.output || lastOutKey !== settings.outputList) {
				settings.output = outKey; settings.outputList = lastOutKey;
				saveSettings();
			}
			var dt = sim.getMaxTimeStep();
			var hint = sourceFrequency(targets.sources);
			var pl = plan(dt, hint);
			if (lastPlan !== null && (pl.key !== lastPlan || hint !== lastHint)) {
				// a new source frequency or sampling: the old samples no longer belong to this
				// signal (otherwise a changed frequency shows up only once they roll out)
				try { sim.fftClear(); } catch (e) {}
				avg = null; spec = null; meas = null; lastSampleT = null;
			}
			lastPlan = pl.key; lastHint = hint;
			// the time step can be shorter than the maximum while converging: keep some extra
			if (!outKey || !sim.fftSelect(outKey, Math.ceil(pl.raw * 1.5) + 64)) {
				spec = null; meas = null; progress = 0;
				draw();
				return;
			}
			// how much is recorded: the samples themselves are copied only when they are used
			var st = sim.fftStatus();
			running = st.running;
			dt = st.maxStep;
			if (lastDt !== null && dt !== lastDt) {
				// a new sampling rate: the old samples and average no longer fit
				sim.fftClear(); avg = null; spec = null; meas = null; setStatus(S.step);
				lastDt = dt;
				draw();
				return;
			}
			lastDt = dt;
			var tLast = st.count ? st.t1 : null;
			var span = st.count > 1 ? st.t1 - st.t0 : 0, need = (pl.raw - 1) * dt;
			var full = span >= need - dt * 1e-6;
			progress = full ? 1 : Math.max(0, Math.min(0.999, span / need));
			// the simulation runs flat out until the samples are all there
			sim.fftSetFast(settings.fast && running && !full, need);
			if (tLast !== null && tLast === lastSampleT && spec) { draw(); return; }   // nothing new (paused)
			var t0 = Date.now(), x = null, preview = false, smp;
			if (full) {
				smp = sim.fftSamples();
				x = resample(smp.t, smp.v, pl.raw, dt);
			} else {
				// not all recorded yet: a coarser spectrum of what there is, from PREVIEW_CYCLES
				// periods on and at most once a second, so a slow simulation does not leave the
				// window empty
				var avail = Math.floor(span / dt), np = 1024;
				while (np * 2 <= pl.n && (pl.r > 1 ? (np * 2 - 1) * pl.r + firTaps(pl.r) : np * 2) <= avail) np *= 2;
				if (hint > 0) np = wholePeriods(np, 1 / (hint * dt * pl.r));
				var rawp = pl.r > 1 ? (np - 1) * pl.r + firTaps(pl.r) : np;
				var f0p = hint > 0 ? hint : autoF0;
				if (settings.size === 'auto' && rawp <= avail && f0p > 0 && rawp * dt * f0p >= PREVIEW_CYCLES &&
						t0 - lastPreview >= 1000) {
					lastPreview = t0;
					smp = sim.fftSamples();
					var got = progress;
					x = resample(smp.t, smp.v, rawp, dt);
					preview = !!x;
					progress = got;
				}
				if (!x) { draw(); return; }
			}
			if (x) {
				var raw = x;
				if (pl.r > 1) x = decimate(x, pl.r, (x.length - firTaps(pl.r)) / pl.r + 1);
				var key = outKey + '|' + pl.key + '|' + settings.window;
				spec = analyze(x, dt * pl.r, preview ? null : averager(key, settings.averages));
				spec.kband = pl.r > 1 ? Math.floor(PASSBAND * x.length) : spec.rms.length - 1;
				spec.preview = preview;
				spec.coherent = isWhole(x.length, hint * dt * pl.r);
				spec.T = raw.length * dt;
				if (pl.r > 1) {
					// RMS and peak to peak of the signal itself, not of the filtered one
					var st = blockStats(raw);
					spec.totalRms = st.rms; spec.vpp = st.vpp;
				}
				meas = measure(spec, hint);
				if (!(hint > 0) && meas.fund)
					autoF0 = Math.pow(2, Math.round(Math.log2(Math.max(meas.fund.f, 1))));
				// a preview is redone at the next refresh, with more samples
				lastSampleT = preview ? null : tLast;
			}
			// keep the work to a small fraction of the time
			interval = Math.max(150, 6 * (Date.now() - t0));
		} catch (e) {
			console.log('fftplot: ' + e);
		}
		draw();
	}

	function updateStatus() {
		if (!ui) return;
		var msg = statusOverride;
		if (!msg) {
			var parts = [];
			if (targets && !targets.outputs.length) parts.push('<b>' + S.noOutput + '</b>');
			else if (progress < 1 && (!spec || spec.preview)) parts.push('<b>' + (running ? fmt(S.acquiring, Math.floor(progress * 100)) : S.paused) + '</b>');
			if (spec) {
				var avgTxt = settings.averages > 1 && avg ? S.avgOf.replace('{a}', avg.list.length).replace('{b}', settings.averages) : '';
				if (meas && meas.lowRes && !spec.preview) parts.push('<b>' + (settings.size === 'auto' ? S.lowResAuto : S.lowRes) + '</b>');
				parts.push(S.info.replace('{N}', spec.n).replace('{fs}', fmtFreq(1 / spec.dt)).
					replace('{df}', fmtFreqPrecise(spec.df, spec.df * 10)).replace('{T}', fmtTime(spec.T || spec.n * spec.dt)).
					replace('{w}', S.wins[settings.window]).replace('{avg}', avgTxt));
			}
			msg = parts.join(' &nbsp; ');
		}
		ui.status.innerHTML = msg;
	}

	// the side panel: the cursor readings (cur, HTML made by draw()) and the measurements
	function updateMeasurements(cur) {
		var M = S.m, h = cur + '<h3>' + M.title + '</h3>';
		if (!meas) { ui.meas.innerHTML = h; return; }
		var row = function (k, v) { return '<tr><td class="k">' + k + '</td><td class="v">' + v + '</td></tr>'; };
		h += '<table class="big">';
		if (meas.fund) {
			h += row(M.fund, fmtFreqPrecise(meas.fund.f, spec.df));
			h += row(M.level, fmtV(meas.fund.rms) + ' RMS');
			h += row('', db20(meas.fund.rms).toFixed(2) + ' dBV');
		} else h += row(M.fund, M.noFund);
		h += '</table><table>';
		h += row(M.dc, fmtV(meas.dc));
		h += row(M.rms, fmtV(meas.totalRms));
		h += row(M.vpp, fmtV(meas.vpp));
		h += '</table>';
		if (meas.fund) {
			h += '<table>';
			h += row(M.thd, fmtPct(meas.thd) + '<br><span style="color:#9a9a9a">' + fmtDb(db20(meas.thd)) + '</span>');
			h += row(M.thdn, fmtPct(meas.thdn) + '<br><span style="color:#9a9a9a">' + fmtDb(db20(meas.thdn)) + '</span>');
			h += '</table>';
			if (meas.harmonics.length) {
				h += '<h3>' + M.harmonics + '</h3><table class="harm"><tr class="hd"><td>' + M.h + '</td><td>' + M.freq +
					'</td><td>dBc</td><td>%</td></tr>';
				meas.harmonics.forEach(function (hm) {
					var r = hm.rms / meas.fund.rms;
					h += '<tr><td>' + hm.h + '</td><td>' + fmtFreq(hm.f) + '</td><td>' + db20(r).toFixed(1) +
						'</td><td>' + (r * 100 >= 0.001 ? (r * 100).toPrecision(3) : (r * 100).toExponential(1)) + '</td></tr>';
				});
				h += '</table>';
			}
		}
		ui.meas.innerHTML = h;
	}

	// ------------------------------------------------------------------
	// drawing
	// ------------------------------------------------------------------

	function niceStep(range) {
		var steps = [1, 2, 3, 5, 6, 10, 12, 20, 30, 40, 50, 100];
		for (var i = 0; i < steps.length; i++) if (range / steps[i] <= 10) return steps[i];
		return 200;
	}
	// 1-2-5 step giving about n divisions
	function niceLin(range, n) {
		var raw = range / n, p = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / p;
		return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
	}

	// the volt scales on a log axis: plotted as log10 of the voltage, labeled in volts
	function logV() { return (settings.scale === 'vrms' || settings.scale === 'vpk') && settings.logVolts; }

	// value shown for an RMS amplitude, in the current scale
	function scaleFn(ref) {
		var k = settings.scale === 'vpk' ? Math.SQRT2 : 1;
		if (logV()) return function (r) { return r > 0 ? Math.log10(r * k) : -Infinity; };
		switch (settings.scale) {
		case 'dbc': return function (r) { return db20(r / ref); };
		case 'vrms': case 'vpk': return function (r) { return r * k; };
		default: return function (r) { return db20(r); };
		}
	}
	function fmtLevel(r, ref) {
		switch (settings.scale) {
		case 'dbc': return db20(r / ref).toFixed(2) + ' dBc';
		case 'vrms': return fmtV(r) + ' RMS';
		case 'vpk': return fmtV(r * Math.SQRT2) + ' pk';
		default: return db20(r).toFixed(2) + ' dBV';
		}
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

		var L = 66, Rm = 18, T = 16, B = 46;
		var pw = W - L - Rm, ph = H - T - B;
		if (pw < 40 || ph < 40) { updateMeasurements(''); return; }

		var isDb = settings.scale === 'dbv' || settings.scale === 'dbc', isLogV = logV();
		var traces = held.slice();
		if (spec) traces.push({ name: S.current, color: '#4f8cff', s: spec, m: meas, main: true });
		var refOf = function (tr) { return tr.m && tr.m.fund ? tr.m.fund.rms : 1; };

		// frequency range
		var base = spec || (held.length ? held[held.length - 1].s : null);
		var nyq = base ? (base.kband ? base.kband * base.df : 0.5 / base.dt) : 1e5, df = base ? base.df : 10;
		var fmax = settings.fmax === 'auto' ? nyq : Math.min(+settings.fmax, nyq);
		var logF = settings.logFreq;
		var fmin = logF ? Math.max(df, fmax / 1e7) : 0;
		if (fmax <= fmin) fmax = fmin * 10;
		var lf0 = Math.log10(fmin || 1), lf1 = Math.log10(fmax);
		var X = logF ? function (f) { return L + (Math.log10(f) - lf0) / (lf1 - lf0) * pw; }
			: function (f) { return L + f / fmax * pw; };
		var Finv = logF ? function (x) { return Math.pow(10, lf0 + (x - L) / pw * (lf1 - lf0)); }
			: function (x) { return (x - L) / pw * fmax; };

		// level range
		var ymax, ymin;
		var vmax = -Infinity, vmin = Infinity, vals = [];
		traces.forEach(function (tr) {
			var f = scaleFn(refOf(tr));
			for (var k = 1; k < tr.s.rms.length; k++) {
				if (k * tr.s.df > fmax) break;
				var v = f(tr.s.rms[k]);
				if (isFinite(v)) { if (v > vmax) vmax = v; if (v < vmin) vmin = v; vals.push(v); }
			}
		});
		// the noise floor: a low percentile of the levels, so that the deep dips between bins
		// do not stretch the scale.  It can be the rounding of the simulation itself, 310 to 370 dB
		// under the signal (spread over more bins, the more points).
		var vfloor = vmin;
		if (vals.length > 100) { var sv = Float64Array.from(vals).sort(); vfloor = sv[Math.floor(sv.length * 0.01)]; }
		if (isDb) {
			if (settings.yRange === 'auto') {
				if (!isFinite(vmax)) { vmax = 0; vfloor = -120; }
				ymax = Math.ceil((vmax + 5) / 10) * 10;
				ymin = autoBottom('db' + settings.scale + ymax, Math.max(ymax - 420, Math.floor((vfloor - 5) / 20) * 20), 40);
				if (ymax - ymin < 40) ymin = ymax - 40;
			} else if (settings.yRange === 'custom') {
				ymax = Math.max(settings.yMax, settings.yMin);
				ymin = Math.min(settings.yMax, settings.yMin);
				if (ymax - ymin < 1) ymin = ymax - 1;
			} else {
				var p = settings.yRange.split(',');
				ymax = +p[0]; ymin = +p[1];
			}
		} else if (isLogV) {
			// whole decades, from just above the highest component down to the noise, at most 21
			if (!isFinite(vmax)) { vmax = 0; vfloor = -6; }
			ymax = Math.ceil(vmax + 0.15);
			ymin = autoBottom('logv' + settings.scale + ymax, Math.max(ymax - 21, Math.floor(vfloor - 0.3)), 2);
			if (ymax - ymin < 3) ymin = ymax - 3;
		} else {
			ymax = isFinite(vmax) && vmax > 0 ? vmax * 1.1 : 1;
			// a little below zero, so the trace along zero is not hidden by the frame
			ymin = -0.03 * ymax;
		}
		var Y = function (v) { return T + (ymax - v) / (ymax - ymin) * ph; };

		// plot area
		g.fillStyle = '#141414';
		g.fillRect(L, T, pw, ph);
		g.lineWidth = 1;
		g.font = '12px system-ui,"Segoe UI",sans-serif';
		g.textAlign = 'center'; g.textBaseline = 'top';
		// frequency grid
		if (logF) {
			for (var dec = Math.floor(lf0); dec <= Math.ceil(lf1); dec++) {
				for (var m = 1; m < 10; m++) {
					var f = m * Math.pow(10, dec);
					if (f < fmin * 0.999 || f > fmax * 1.001) continue;
					var x = Math.round(X(f)) + 0.5;
					g.strokeStyle = m === 1 ? '#4a4a4a' : '#2a2a2a';
					line(g, x, T, x, T + ph);
					if (m === 1) { g.fillStyle = '#9a9a9a'; g.fillText(fmtAxisFreq(f), x, T + ph + 6); }
				}
			}
		} else {
			var fs = niceLin(fmax, Math.max(2, Math.floor(pw / 90)));
			for (f = 0; f <= fmax * 1.0001; f += fs) {
				x = Math.round(X(f)) + 0.5;
				g.strokeStyle = '#363636';
				line(g, x, T, x, T + ph);
				g.fillStyle = '#9a9a9a'; g.fillText(fmtAxisFreq(f), x, T + ph + 6);
			}
		}
		g.fillStyle = '#9a9a9a';
		g.fillText(S.freqAxis, L + pw / 2, T + ph + 24);
		// level grid
		g.textAlign = 'right'; g.textBaseline = 'middle';
		if (isLogV) {
			// a labeled line at every decade, lighter ones at 2..9 when there is room
			var dpx = ph / (ymax - ymin);
			for (var d = Math.floor(ymin); d <= ymax; d++) {
				for (var mm = 1; mm < 10; mm++) {
					var lv = d + Math.log10(mm);
					if (lv < ymin - 1e-9 || lv > ymax + 1e-9 || (mm > 1 && dpx < 60)) continue;
					var yl = Math.round(Y(lv)) + 0.5;
					g.strokeStyle = mm === 1 ? '#4a4a4a' : '#2a2a2a';
					line(g, L, yl, L + pw, yl);
					if (mm === 1) { g.fillStyle = '#9a9a9a'; g.fillText(fmtAxisV(Math.pow(10, d)), L - 8, yl); }
				}
			}
		} else {
			var ystep = isDb ? niceStep((ymax - ymin) / 1.2) : niceLin(ymax, Math.max(2, Math.floor(ph / 45)));
			if (isDb && ymax - ymin > 100) ystep = ymax - ymin > 200 ? 40 : 20;
			for (var v = Math.ceil(ymin / ystep) * ystep; v <= ymax + 1e-12; v += ystep) {
				var y = Math.round(Y(v)) + 0.5;
				g.strokeStyle = Math.abs(v) < ystep * 1e-6 ? '#5c5c5c' : '#363636';
				line(g, L, y, L + pw, y);
				g.fillStyle = '#9a9a9a';
				g.fillText(isDb ? String(Math.round(v * 10) / 10) : fmtAxisV(Math.abs(v) < ystep * 1e-6 ? 0 : v), L - 8, y);
			}
		}
		g.save();
		g.translate(16, T + ph / 2); g.rotate(-Math.PI / 2);
		g.textAlign = 'center'; g.fillStyle = '#9a9a9a';
		g.fillText(S.axis[settings.scale], 0, 0);
		g.restore();
		g.strokeStyle = '#5c5c5c';
		g.strokeRect(L + 0.5, T + 0.5, pw - 1, ph - 1);

		// traces: the peak of the bins in each pixel column, so tones never get lost
		g.save();
		g.beginPath(); g.rect(L, T, pw, ph); g.clip();
		traces.forEach(function (tr) {
			var f = scaleFn(refOf(tr)), s = tr.s;
			g.strokeStyle = tr.color; g.lineWidth = tr.main ? 1.6 : 1.2; g.lineJoin = 'round';
			g.beginPath();
			var pen = false, col = -1, colMax = -Infinity, colMin = Infinity, colX = 0;
			var bottom = (isDb || isLogV) ? ymin - (ymax - ymin) : 0;
			var flush = function () {
				if (col < 0) return;
				var y1 = Y(Math.max(colMax, bottom)), y0 = Y(Math.max(colMin, bottom));
				if (pen) g.lineTo(colX, y0); else g.moveTo(colX, y0);
				if (y1 !== y0) g.lineTo(colX, y1);
				pen = true;
			};
			var pts = plotPoints(s, logF, fmin, fmax, X, pw);
			for (var k = 0; k < pts.f.length; k++) {
				var xk = X(pts.f[k]), c = Math.round(xk);
				var vk = f(pts.r[k]);
				if (!isFinite(vk)) vk = bottom;
				if (c !== col) { flush(); col = c; colX = xk; colMax = colMin = vk; }
				else { if (vk > colMax) colMax = vk; if (vk < colMin) colMin = vk; }
			}
			flush();
			g.stroke();
		});
		g.restore();
		g.lineWidth = 1;

		// harmonic markers on the current spectrum
		if (settings.markers && spec && meas && meas.fund) {
			var fs0 = scaleFn(meas.fund.rms);
			var mark = function (fq, r, label, color) {
				if (fq < (logF ? fmin : 0) || fq > fmax) return;
				var mx = X(fq), my = Y(Math.max(fs0(r), ymin));
				// keep the marker and its label inside the plot
				if (my < T + 26) my = T + 26;
				g.fillStyle = color;
				g.beginPath(); g.moveTo(mx, my - 4); g.lineTo(mx - 4, my - 11); g.lineTo(mx + 4, my - 11); g.closePath(); g.fill();
				g.font = '11px system-ui,"Segoe UI",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
				g.fillText(label, mx, my - 12);
			};
			mark(meas.fund.f, meas.fund.rms, 'F', '#ff8c3a');
			meas.harmonics.forEach(function (hm) { mark(hm.f, hm.rms, String(hm.h), '#c08ae8'); });
		}

		if (!spec && !held.length) {
			g.fillStyle = '#9a9a9a'; g.textAlign = 'center'; g.textBaseline = 'middle';
			g.font = '14px system-ui,"Segoe UI",sans-serif';
			var noOut = !targets || !targets.outputs.length;
			g.fillText(noOut ? S.needOut : (running ? fmt(S.acquiring, Math.floor(progress * 100)) : S.paused), L + pw / 2, T + ph / 2);
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

		// a trace read at pixel column px: the strongest bin within 3 pixels, so a peak is never
		// missed; where the bins are further apart on screen (the low end of a log axis) the
		// curve at that frequency, so the reading follows the mouse instead of jumping.
		// {f, r (RMS), x (where to put the dot), df (resolution to show f with)} or null.
		var sampleAt = function (tr, px) {
			var s = tr.s, fa = Math.max(0, Finv(px - 3)), fb = Finv(px + 3), fh = Finv(px), kh = Math.floor(fh / s.df);
			if (logF && kh >= 1 && X((kh + 1) * s.df) - X(kh * s.df) > 3) {
				var rv = curveAt(plotPoints(s, logF, fmin, fmax, X, pw), fh);
				return rv > 0 ? { f: fh, r: rv, x: px, df: s.df / 10 } : null;
			}
			var ka = Math.max(logF ? 1 : 0, Math.floor(fa / s.df)), kb = Math.min(s.rms.length - 1, Math.ceil(fb / s.df));
			var kbest = -1;
			for (var k = ka; k <= kb; k++) if (kbest < 0 || s.rms[k] > s.rms[kbest]) kbest = k;
			return kbest < 0 ? null : { f: kbest * s.df, r: s.rms[kbest], x: X(kbest * s.df), df: s.df };
		};
		var levelDot = function (sm, ref, color) {
			var v = scaleFn(ref)(sm.r);
			if (isFinite(v)) dot(g, sm.x, Y(Math.max(Math.min(v, ymax), ymin)), color);
		};

		// the two cursors: a line each, dots where they read the spectra, and at the top of the
		// side panel (where it does not cover the spectrum) their frequencies and a table with,
		// for the current spectrum and every held one, the levels at A and B and their difference
		geom = { L: L, T: T, pw: pw, ph: ph, X: X, Finv: Finv, fmin: logF ? fmin : 0, fmax: fmax };
		var curHtml = '';
		if (settings.cursors && traces.length) {
			var cxs = CURSORS.map(function (c, i) {
				var cx = Math.round(X(cursorFreq(i))) + 0.5;
				g.strokeStyle = c.color; g.lineWidth = i === dragCur ? 2 : 1;
				line(g, cx, T, cx, T + ph);
				g.lineWidth = 1;
				// the tag stays inside the plot when the cursor is at an edge
				var tx = Math.min(Math.max(cx, L + 7), L + pw - 7);
				g.fillStyle = c.color; g.fillRect(tx - 7, T, 14, 15);
				g.fillStyle = '#141414'; g.font = 'bold 11px system-ui,"Segoe UI",sans-serif';
				g.textAlign = 'center'; g.textBaseline = 'middle';
				g.fillText(c.name, tx, T + 8);
				return cx;
			});
			var row = function (k, v) { return '<tr><td class="k">' + k + '</td><td class="v">' + v + '</td></tr>'; };
			var kv = settings.scale === 'vpk' ? Math.SQRT2 : 1;
			// a level without its unit when that is in the heading (the dB scales)
			var lvl = function (sm, ref) {
				if (!sm) return '—';
				return isDb ? db20(settings.scale === 'dbc' ? sm.r / ref : sm.r).toFixed(2) : fmtV(sm.r * kv);
			};
			var ord = traces.slice().reverse(), first = null, trs = '';
			ord.forEach(function (tr) {
				var ref = refOf(tr), sms = cxs.map(function (cx) { return sampleAt(tr, cx); });
				sms.forEach(function (sm) { if (sm) levelDot(sm, ref, tr.color); });
				if (!first) first = sms;
				var ddb = sms[0] && sms[1] ? db20(sms[1].r / sms[0].r) : NaN;
				var name = tr.main ? S.current : ((tr.name.match(/#\d+$/) || [tr.name])[0]);
				trs += '<tr><td><span style="display:inline-block;width:8px;height:3px;margin-right:5px;vertical-align:middle;background:' +
					tr.color + '"></span>' + name + '</td><td>' + lvl(sms[0], ref) + '</td><td>' + lvl(sms[1], ref) + '</td><td>' +
					(isFinite(ddb) ? (ddb >= 0 ? '+' : '') + ddb.toFixed(2) : '—') + '</td></tr>';
			});
			curHtml = '<h3>' + S.cursors + '</h3><table>';
			CURSORS.forEach(function (c, i) {
				curHtml += row('<b style="color:' + c.color + '">' + c.name + '</b>', first[i] ? fmtFreqPrecise(first[i].f, first[i].df) : '—');
			});
			if (first[0] && first[1]) {
				var dfq = first[1].f - first[0].f;
				curHtml += row('B−A', (dfq < 0 ? '−' : '') + fmtFreqPrecise(Math.abs(dfq), Math.min(first[0].df, first[1].df)));
			}
			curHtml += '</table><table class="harm"><tr class="hd"><td>' + (isDb ? (settings.scale === 'dbc' ? 'dBc' : 'dBV') : '') +
				'</td><td>A</td><td>B</td><td>B−A dB</td></tr>' + trs + '</table>';
		}
		updateMeasurements(curHtml);

		// hover readout (not while dragging a cursor)
		if (hover && dragCur < 0 && traces.length && hover.x >= L && hover.x <= L + pw && hover.y >= T && hover.y <= T + ph) {
			var hx = Math.round(hover.x) + 0.5;
			g.strokeStyle = 'rgba(255,255,255,0.4)'; g.setLineDash([3, 3]);
			line(g, hx, T, hx, T + ph); g.setLineDash([]);
			var rows = [];
			traces.slice().reverse().forEach(function (tr) {
				var sm = sampleAt(tr, hover.x);
				if (!sm) return;
				var ref = refOf(tr);
				levelDot(sm, ref, tr.color);
				if (!rows.length) rows.push('f = ' + fmtFreqPrecise(sm.f, sm.df));
				rows.push({ t: (tr.main ? '' : tr.name + ': ') + fmtLevel(sm.r, ref), c: tr.color });
			});
			readoutBox(g, rows, function (bw, bh) {
				var bx = hover.x + 14, by = hover.y + 14;
				if (bx + bw > L + pw) bx = hover.x - bw - 14;
				if (by + bh > T + ph) by = hover.y - bh - 14;
				return [bx, by];
			});
		}
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

	// points to draw a spectrum: its bins, and on a log axis, where two bins are more than 3
	// pixels apart (the low frequencies), points every pixel in between on a smooth curve
	// through the bins: a monotone cubic (Fritsch-Butland) of the log amplitude, so it never
	// overshoots them.  Only for the drawing: measurements and the cursor use the bins.
	// Cached for the same axis.
	// bottom of the automatic range: it moves down at once, but up only when the floor rises by
	// more than hyst, so that it does not jump at every refresh with a floor near a step
	var autoLo = null;
	function autoBottom(key, lo, hyst) {
		if (autoLo && autoLo.key === key && lo > autoLo.lo && lo - autoLo.lo < hyst) lo = autoLo.lo;
		autoLo = { key: key, lo: lo };
		return lo;
	}

	function plotPoints(s, logF, fmin, fmax, X, pw) {
		var key = logF + '|' + fmin + '|' + fmax + '|' + pw;
		if (s.pts && s.pts.key === key) return s.pts;
		var F = [], R = [], nb = s.rms.length;
		var ly = function (k) { return Math.log(Math.max(s.rms[Math.max(0, Math.min(nb - 1, k))], 1e-30)); };
		var slope = function (k) {
			var a = ly(k) - ly(k - 1), b = ly(k + 1) - ly(k);
			return a * b <= 0 ? 0 : 2 * a * b / (a + b);
		};
		for (var k = logF ? 1 : 0; k < nb; k++) {
			var fk = k * s.df;
			if (fk > fmax * 1.0001) break;
			if (logF && fk < fmin * 0.999) continue;
			F.push(fk); R.push(s.rms[k]);
			if (!logF || k + 1 >= nb) continue;
			var fn = (k + 1) * s.df, gap = X(Math.min(fn, fmax)) - X(fk);
			if (gap <= 3) continue;
			var y0 = ly(k), y1 = ly(k + 1), m0 = slope(k), m1 = slope(k + 1), m = Math.ceil(gap);
			for (var j = 1; j < m; j++) {
				var t = j / m, ff = fk + (fn - fk) * t;
				if (ff > fmax) break;
				var t2 = t * t, t3 = t2 * t;
				var y = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1;
				F.push(ff); R.push(Math.exp(y));
			}
		}
		return (s.pts = { key: key, f: F, r: R });
	}

	// the drawn curve at frequency f, between its points (log amplitude, linear between them)
	function curveAt(pts, f) {
		var F = pts.f, R = pts.r, lo = 0, hi = F.length - 1;
		if (hi < 0 || f < F[0] || f > F[hi]) return NaN;
		while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (F[mid] <= f) lo = mid; else hi = mid; }
		if (F[hi] === F[lo]) return R[lo];
		var t = (f - F[lo]) / (F[hi] - F[lo]);
		return Math.exp(Math.log(Math.max(R[lo], 1e-30)) * (1 - t) + Math.log(Math.max(R[hi], 1e-30)) * t);
	}

	function line(g, x0, y0, x1, y1) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
	function dot(g, x, y, c) { g.fillStyle = c; g.beginPath(); g.arc(x, y, 3.5, 0, 2 * Math.PI); g.fill(); }

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

	window.CircuitJSFFT = { open: open, _test: { last: function () { return { spec: spec, meas: meas }; }, fft: fft, analyze: analyze, measure: measure, settings: settings, plan: plan, plotPoints: plotPoints, decimate: decimate, dft: dft, firFilter: firFilter, wholePeriods: wholePeriods, isWhole: isWhole, resample: resample, blockStats: blockStats, PASSBAND: PASSBAND } };
})();
