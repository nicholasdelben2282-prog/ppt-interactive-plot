(function () {
  'use strict';

  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const MAX_TRACES = 32;
  const MAX_PANELS = 8;
  const MAX_POINTS_PER_TRACE = 250000;
  const MAX_TOTAL_POINTS = 500000;
  const MAX_TEXT = 300;
  const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

  function fail(message) { throw new Error(message); }

  function plainText(value, fallback = '') {
    if (value == null) return fallback;
    let s = String(value);
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    return s.slice(0, MAX_TEXT);
  }

  function assertNoDangerousKeys(root) {
    const stack = [root];
    let visited = 0;
    while (stack.length) {
      const value = stack.pop();
      if (value && typeof value === 'object') {
        if (++visited > 200000) fail('Estrutura JSON excessivamente complexa.');
        for (const key of Object.keys(value)) {
          if (DANGEROUS_KEYS.has(key)) fail(`Chave proibida no JSON: ${key}`);
          stack.push(value[key]);
        }
      }
    }
  }

  function splitTopLevelArgs(callText) {
    const args = [];
    let start = 0;
    let quote = null;
    let escape = false;
    let p = 0, b = 0, c = 0;
    for (let i = 0; i < callText.length; i++) {
      const ch = callText[i];
      if (quote) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '(') p++;
      else if (ch === ')') p--;
      else if (ch === '[') b++;
      else if (ch === ']') b--;
      else if (ch === '{') c++;
      else if (ch === '}') c--;
      else if (ch === ',' && p === 0 && b === 0 && c === 0) {
        args.push(callText.slice(start, i).trim());
        start = i + 1;
      }
      if (p < 0 || b < 0 || c < 0) fail('Sintaxe inválida no Plotly.newPlot.');
    }
    args.push(callText.slice(start).trim());
    return args;
  }

  function extractNewPlotCall(html) {
    const needle = 'Plotly.newPlot';
    const first = html.indexOf(needle);
    if (first < 0) fail('Não encontrei Plotly.newPlot(...) no arquivo.');
    if (html.indexOf(needle, first + needle.length) >= 0) fail('O arquivo contém mais de um Plotly.newPlot; use um HTML com um único gráfico.');

    let i = first + needle.length;
    while (/\s/.test(html[i] || '')) i++;
    if (html[i] !== '(') fail('Plotly.newPlot encontrado, mas a chamada não pôde ser interpretada.');
    const start = ++i;
    let depth = 1, quote = null, escape = false;
    for (; i < html.length; i++) {
      const ch = html[i];
      if (quote) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) return html.slice(start, i);
      }
    }
    fail('Chamada Plotly.newPlot não terminada.');
  }

  function parseJsonArg(text, label) {
    try {
      const value = JSON.parse(text);
      assertNoDangerousKeys(value);
      return value;
    } catch (e) {
      fail(`${label} não é JSON puro compatível com o modo seguro: ${e.message}`);
    }
  }

  function numericArray(value, label, implicitLength) {
    if (value == null && Number.isInteger(implicitLength)) {
      return Array.from({ length: implicitLength }, (_, i) => i);
    }
    if (!Array.isArray(value)) fail(`${label} precisa ser um vetor numérico.`);
    if (value.length > MAX_POINTS_PER_TRACE) fail(`${label} excede ${MAX_POINTS_PER_TRACE.toLocaleString('pt-BR')} pontos.`);
    return value.map((v, i) => {
      if (v === null) return null;
      if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${label}[${i}] não é um número finito.`);
      return v;
    });
  }

  function safeColor(value) {
    if (typeof value !== 'string') return null;
    const s = value.trim();
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
    if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(s)) return s;
    return null;
  }

  function panelFromTrace(trace) {
    let p = null;
    if (trace.meta && typeof trace.meta === 'object' && !Array.isArray(trace.meta)) {
      const raw = trace.meta.pptPanel;
      if (Number.isInteger(raw)) p = raw;
    }
    if (p == null && typeof trace.yaxis === 'string') {
      const m = /^y(\d+)?$/i.exec(trace.yaxis.trim());
      if (m) p = m[1] ? Number(m[1]) : 1;
    }
    if (p == null) p = 1;
    if (!Number.isInteger(p) || p < 1 || p > MAX_PANELS) fail(`Número de subplot inválido: ${p}`);
    return p - 1;
  }

  function sanitizeTrace(trace, idx) {
    if (!trace || typeof trace !== 'object' || Array.isArray(trace)) fail(`Trace ${idx + 1} inválida.`);
    const type = trace.type == null ? 'scatter' : String(trace.type).toLowerCase();
    if (type !== 'scatter' && type !== 'scattergl') fail(`Tipo de trace não suportado no modo seguro: ${type}`);

    const y = numericArray(trace.y, `trace ${idx + 1}.y`);
    const x = numericArray(trace.x, `trace ${idx + 1}.x`, y.length);
    if (x.length !== y.length) fail(`Trace ${idx + 1}: x e y têm comprimentos diferentes.`);

    const rawMode = typeof trace.mode === 'string' ? trace.mode.toLowerCase() : 'lines';
    const hasLines = rawMode.includes('lines') || (!rawMode.includes('markers') && !rawMode.includes('text'));
    const hasMarkers = rawMode.includes('markers');
    if (!hasLines && !hasMarkers) fail(`Trace ${idx + 1}: modo não suportado (${rawMode}).`);

    const line = trace.line && typeof trace.line === 'object' ? trace.line : {};
    const marker = trace.marker && typeof trace.marker === 'object' ? trace.marker : {};
    const width = Number.isFinite(line.width) ? Math.min(8, Math.max(0.5, line.width)) : 1.5;
    const markerSize = Number.isFinite(marker.size) ? Math.min(18, Math.max(2, marker.size)) : 5;
    const dashRaw = typeof line.dash === 'string' ? line.dash.toLowerCase() : 'solid';
    const dash = ['solid', 'dash', 'dot', 'dashdot'].includes(dashRaw) ? dashRaw : 'solid';

    return {
      name: plainText(trace.name, `Trace ${idx + 1}`),
      panel: panelFromTrace(trace),
      x,
      y,
      lines: hasLines,
      markers: hasMarkers,
      color: safeColor(line.color || marker.color),
      width,
      markerSize,
      dash,
      visible: trace.visible !== false && trace.visible !== 'legendonly'
    };
  }

  function axisTitle(axis, fallback) {
    if (!axis || typeof axis !== 'object') return fallback;
    if (typeof axis.title === 'string') return plainText(axis.title, fallback);
    if (axis.title && typeof axis.title === 'object') return plainText(axis.title.text, fallback);
    return fallback;
  }

  function axisRange(axis) {
    if (!axis || typeof axis !== 'object') return null;
    if (axis.type && axis.type !== 'linear' && axis.type !== '-') fail(`Eixo ${axis.type} não é suportado; use eixo linear.`);
    if (axis.range == null) return null;
    if (!Array.isArray(axis.range) || axis.range.length !== 2) return null;
    const a = axis.range[0], b = axis.range[1];
    return (typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b) && a !== b) ? [a, b] : null;
  }

  function axisObject(layout, prefix, p) {
    const key = p === 0 ? `${prefix}axis` : `${prefix}axis${p + 1}`;
    const obj = layout[key];
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  }

  function panelMetadata(layout) {
    const meta = layout && layout.meta && typeof layout.meta === 'object' && !Array.isArray(layout.meta) ? layout.meta : {};
    const arr = Array.isArray(meta.pptPanels) ? meta.pptPanels : [];
    if (arr.length > MAX_PANELS) fail(`Máximo de ${MAX_PANELS} subplots.`);
    return arr;
  }

  function sanitizePanel(layout, metaEntry, p) {
    metaEntry = metaEntry && typeof metaEntry === 'object' && !Array.isArray(metaEntry) ? metaEntry : {};
    const xa = axisObject(layout, 'x', p);
    const ya = axisObject(layout, 'y', p);
    return {
      title: plainText(metaEntry.title, ''),
      xTitle: plainText(metaEntry.xTitle, axisTitle(xa, 'x')),
      yTitle: plainText(metaEntry.yTitle, axisTitle(ya, 'y')),
      xRange: axisRange(xa),
      yRange: axisRange(ya)
    };
  }

  function sanitizeModel(data, layout) {
    if (!Array.isArray(data) || data.length === 0) fail('O gráfico não contém traces.');
    if (data.length > MAX_TRACES) fail(`Máximo de ${MAX_TRACES} traces por gráfico.`);
    const traces = data.map(sanitizeTrace);
    const total = traces.reduce((n, t) => n + t.x.length, 0);
    if (total > MAX_TOTAL_POINTS) fail(`O gráfico excede ${MAX_TOTAL_POINTS.toLocaleString('pt-BR')} pontos no total.`);

    layout = layout && typeof layout === 'object' && !Array.isArray(layout) ? layout : {};
    const metas = panelMetadata(layout);
    const maxTracePanel = traces.reduce((m, t) => Math.max(m, t.panel), 0);
    const panelCount = Math.max(1, maxTracePanel + 1, metas.length);
    if (panelCount > MAX_PANELS) fail(`Máximo de ${MAX_PANELS} subplots.`);

    const panels = [];
    for (let p = 0; p < panelCount; p++) panels.push(sanitizePanel(layout, metas[p], p));

    const title = typeof layout.title === 'string' ? plainText(layout.title) : plainText(layout.title && layout.title.text);
    return { schema: 2, title, panels, traces };
  }

  function parsePlotlyHtml(html) {
    if (typeof html !== 'string') fail('Conteúdo inválido.');
    if (new Blob([html]).size > MAX_FILE_BYTES) fail('Arquivo maior que 25 MB.');
    if (html.includes('\0')) fail('Arquivo contém byte NUL.');
    const call = extractNewPlotCall(html);
    const args = splitTopLevelArgs(call);
    if (args.length < 3 || args.length > 4) fail('Assinatura Plotly.newPlot não reconhecida.');
    const data = parseJsonArg(args[1], 'data');
    const layout = parseJsonArg(args[2], 'layout');
    if (args[3]) parseJsonArg(args[3], 'config');
    return sanitizeModel(data, layout);
  }

  function modelV1ToV2(model) {
    return {
      schema: 2,
      title: plainText(model.title, ''),
      panels: [{
        title: '',
        xTitle: plainText(model.xTitle, 'x'),
        yTitle: plainText(model.yTitle, 'y'),
        xRange: Array.isArray(model.xRange) ? model.xRange : null,
        yRange: Array.isArray(model.yRange) ? model.yRange : null
      }],
      traces: (model.traces || []).map(t => Object.assign({}, t, { panel: 0 }))
    };
  }

  function validateSavedModel(model) {
    if (!model || typeof model !== 'object') fail('Modelo salvo incompatível.');
    assertNoDangerousKeys(model);
    if (model.schema === 1) model = modelV1ToV2(model);
    if (model.schema !== 2 || !Array.isArray(model.traces) || !Array.isArray(model.panels)) fail('Modelo salvo incompatível.');
    if (model.panels.length < 1 || model.panels.length > MAX_PANELS) fail('Quantidade de subplots salva inválida.');

    const data = model.traces.map(t => ({
      type: 'scatter', name: t.name, x: t.x, y: t.y,
      mode: `${t.lines ? 'lines' : ''}${t.lines && t.markers ? '+' : ''}${t.markers ? 'markers' : ''}`,
      line: { color: t.color, width: t.width, dash: t.dash },
      marker: { color: t.color, size: t.markerSize }, visible: t.visible,
      meta: { pptPanel: Number.isInteger(t.panel) ? t.panel + 1 : 1 }
    }));

    const metaPanels = model.panels.map(p => ({
      title: p && p.title,
      xTitle: p && p.xTitle,
      yTitle: p && p.yTitle
    }));
    const layout = { title: model.title, meta: { pptPanels: metaPanels } };
    model.panels.forEach((p, i) => {
      const xk = i === 0 ? 'xaxis' : `xaxis${i + 1}`;
      const yk = i === 0 ? 'yaxis' : `yaxis${i + 1}`;
      layout[xk] = { title: p && p.xTitle, range: p && p.xRange };
      layout[yk] = { title: p && p.yTitle, range: p && p.yRange };
    });
    return sanitizeModel(data, layout);
  }

  window.SafePlotParser = { parsePlotlyHtml, validateSavedModel, MAX_FILE_BYTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SafePlotParser;
}());
