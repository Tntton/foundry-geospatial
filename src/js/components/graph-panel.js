// Scatter-plot graph panel — plots two numeric hospital ED fields against
// each other, side by side with the map (a real flex sibling of
// .map-container, not an overlay drawer — see map.html/styles.css). Axes are
// set by dragging a field chip onto an "X"/"Y" drop zone, or (fallback for
// trackpad/touch, where drag-and-drop is fragile) clicking a chip then
// clicking a drop zone.
//
// Clicking a plotted point calls selectHospital() (app.js) to fly the map to
// and ring that hospital. app.js's own hospitals-pins click handler calls
// GraphPanel.highlightPoint() back, so a click on either side keeps both
// panels in sync.
//
// v1 scope is hospitals only (see the ED diversion opportunity score work).
// A second dataset later is a second HOSPITAL_GRAPH_FIELDS-shaped array plus
// a dataset selector, not a rewrite of the panel/chart machinery below.
//
// Loaded as a classic <script> after app.js, same shared-global-scope
// convention as Copilot/TP (see copilot-panel.js's header comment) — no
// window.* export; GraphPanel is referenced as a bare identifier both here
// and from app.js's selectHospital(). Percentile colouring reuses
// percentileRampColor() (app.js) so the plot and the map agree on what a
// given percentile looks like.

const HOSPITAL_GRAPH_FIELDS = [
    { key: 'LowUrgencyVolume', label: 'Low-urgency ED volume', unit: 'presentations/yr', fmt: (v) => fmtInt(v),
      description: 'Total Semi-Urgent and Non-Urgent ED presentations in 2024–25 — the lower-acuity caseload a GP or urgent care service could plausibly divert.' },
    { key: 'MedianWaitMinutes', label: 'Median wait', unit: 'minutes', fmt: (v) => fmtInt(v) + ' min',
      description: 'Typical ED wait: minutes until half of all patients had left the ED (2024–25, all triage categories combined).' },
    { key: 'P90WaitMinutes', label: 'Worst-case (p90) wait', unit: 'minutes', fmt: (v) => fmtInt(v) + ' min',
      description: 'Worst-case ED wait: minutes until 90% of patients had left — only the slowest 10% took longer. High relative to the median signals overcrowding, not just a slow typical visit.' },
    { key: 'OverflowRate', label: 'Overflow rate (over 4hrs)', unit: '%', fmt: (v) => fmtPct(v * 100),
      description: 'Share of ED presentations NOT seen within 4 hours (2024–25, all patients) — 1 minus the on-time rate. Higher means more overflowed.' },
    { key: 'LowUrgencyVolumePercentile', label: 'Low-urgency volume (percentile)', unit: 'percentile', fmt: (v) => fmtInt(v) + 'th pctile',
      description: 'Where this hospital ranks on low-urgency ED volume against all other scored hospitals, 0–100.' },
    { key: 'OverflowRatePercentile', label: 'Overflow rate (percentile)', unit: 'percentile', fmt: (v) => fmtInt(v) + 'th pctile',
      description: 'Where this hospital ranks on overflow rate against all other scored hospitals, 0–100.' },
    { key: 'DiversionOpportunityPercentile', label: 'Diversion opportunity', unit: 'percentile', fmt: (v) => fmtInt(v) + 'th pctile',
      description: 'Combined ranking (average of the volume and overflow percentiles) — what the map colours hospitals by. Higher means a better candidate for a primary/urgent-care diversion play.' }
];

function graphFieldByKey(key) {
    return HOSPITAL_GRAPH_FIELDS.find((f) => f.key === key);
}

function graphEscapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Domain/tick helpers scoped to this file (all current fields are
// non-negative counts/rates/minutes/percentiles, so domains are clamped at 0
// rather than handling negative values generically).
function graphNiceDomain(values) {
    let lo = Math.min(...values), hi = Math.max(...values);
    if (lo === hi) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.06;
    return [Math.max(0, lo - pad), hi + pad];
}
function graphNiceTicks(lo, hi, count) {
    const span = hi - lo || 1;
    const rawStep = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const start = Math.ceil(lo / step) * step;
    const ticks = [];
    for (let t = start; t <= hi + step * 1e-6; t += step) ticks.push(Math.round(t * 1000) / 1000);
    return ticks;
}
function graphFmtAxisTick(v) {
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k';
    return String(Math.round(v * 100) / 100);
}

const GraphPanel = {
    xField: 'LowUrgencyVolume',
    yField: 'MedianWaitMinutes',
    _pendingChipKey: null
};

// ============================================================
// Panel open/close + resize
// ============================================================
GraphPanel.isOpen = function () {
    return !document.getElementById('graph-panel')?.classList.contains('hidden');
};

GraphPanel.open = function () {
    document.body.classList.add('graph-panel-open');
    document.getElementById('graph-panel')?.classList.remove('hidden');
    document.getElementById('graph-resize-handle')?.classList.remove('hidden');
    GraphPanel.load();
    // Matches .graph-panel's own CSS transition duration -- Mapbox needs its
    // container's final size, not the mid-transition one, to lay out correctly.
    setTimeout(() => { if (typeof map !== 'undefined' && map) map.resize(); }, 340);
};

GraphPanel.close = function () {
    document.body.classList.remove('graph-panel-open');
    document.getElementById('graph-panel')?.classList.add('hidden');
    document.getElementById('graph-resize-handle')?.classList.add('hidden');
    setTimeout(() => { if (typeof map !== 'undefined' && map) map.resize(); }, 340);
};

GraphPanel.toggle = function () {
    if (GraphPanel.isOpen()) GraphPanel.close(); else GraphPanel.open();
};

GraphPanel.initResizeHandle = function () {
    const handle = document.getElementById('graph-resize-handle');
    if (!handle || handle._wired) return;
    handle._wired = true;
    let dragging = false;
    handle.addEventListener('mousedown', (e) => {
        dragging = true;
        e.preventDefault();
        document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const w = Math.max(320, Math.min(800, window.innerWidth - e.clientX));
        document.documentElement.style.setProperty('--graph-panel-w', w + 'px');
        if (typeof map !== 'undefined' && map) map.resize();
    });
    window.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.userSelect = '';
        if (typeof map !== 'undefined' && map) map.resize();
    });
};

// ============================================================
// Data + render
// ============================================================
GraphPanel.load = async function () {
    const body = document.getElementById('graph-panel-body');
    if (!body) return;
    if (!State.hospitalsGeojson) {
        body.innerHTML = '<div class="graph-panel-loading">Loading hospital ED data…</div>';
    }
    try {
        await ensureHospitalsDataLoaded();
    } catch (e) {
        body.innerHTML = '<div class="graph-panel-loading">Failed to load hospital data.</div>';
        console.warn('GraphPanel data load failed:', e);
        return;
    }
    GraphPanel.render();
};

GraphPanel.render = function () {
    GraphPanel.initResizeHandle();
    GraphPanel.renderFieldPicker();
    GraphPanel.renderChart();
};

GraphPanel.renderFieldPicker = function () {
    const el = document.getElementById('graph-panel-hdr');
    if (!el) return;
    const chip = (f) => `
        <div class="graph-field-chip ${GraphPanel._pendingChipKey === f.key ? 'pending' : ''}"
             draggable="true"
             data-field-key="${f.key}">${f.label}</div>`;
    const dropZone = (axis, fieldKey) => {
        const f = graphFieldByKey(fieldKey);
        return `
        <div class="graph-axis-drop" data-axis="${axis}">
            <span class="graph-axis-drop-label">${axis.toUpperCase()} axis</span>
            <span class="graph-axis-drop-value" ${f ? `data-field-key="${f.key}"` : ''}>${f ? f.label : 'Drop a field here'}</span>
        </div>`;
    };
    el.innerHTML = `
        <div class="graph-panel-title-row">
            <span class="graph-panel-title">ED metrics scatter</span>
            <button class="graph-panel-close" onclick="GraphPanel.close()" title="Close">✕</button>
        </div>
        <div class="graph-axis-row">
            ${dropZone('x', GraphPanel.xField)}
            ${dropZone('y', GraphPanel.yField)}
        </div>
        <div class="graph-field-chips-label">Drag a field onto an axis above (or click a field, then click an axis):</div>
        <div class="graph-field-chips">${HOSPITAL_GRAPH_FIELDS.map(chip).join('')}</div>
    `;

    el.querySelectorAll('.graph-field-chip').forEach((chipEl) => {
        chipEl.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', chipEl.dataset.fieldKey);
        });
        chipEl.addEventListener('click', () => {
            const key = chipEl.dataset.fieldKey;
            GraphPanel._pendingChipKey = (GraphPanel._pendingChipKey === key) ? null : key;
            GraphPanel.renderFieldPicker();
        });
        chipEl.addEventListener('mousemove', (e) => GraphPanel.showFieldTooltip(e, chipEl.dataset.fieldKey));
        chipEl.addEventListener('mouseleave', GraphPanel.hideFieldTooltip);
    });
    el.querySelectorAll('.graph-axis-drop').forEach((zoneEl) => {
        const axis = zoneEl.dataset.axis;
        zoneEl.addEventListener('dragover', (e) => e.preventDefault());
        zoneEl.addEventListener('drop', (e) => {
            e.preventDefault();
            const fieldKey = e.dataTransfer.getData('text/plain');
            if (fieldKey) GraphPanel.setAxisField(axis, fieldKey);
        });
        zoneEl.addEventListener('click', () => {
            if (!GraphPanel._pendingChipKey) return;
            GraphPanel.setAxisField(axis, GraphPanel._pendingChipKey);
            GraphPanel._pendingChipKey = null;
        });
    });
    el.querySelectorAll('.graph-axis-drop-value[data-field-key]').forEach((valEl) => {
        valEl.addEventListener('mousemove', (e) => GraphPanel.showFieldTooltip(e, valEl.dataset.fieldKey));
        valEl.addEventListener('mouseleave', GraphPanel.hideFieldTooltip);
    });
};

GraphPanel.setAxisField = function (axis, fieldKey) {
    if (!graphFieldByKey(fieldKey)) return;
    if (axis === 'x') GraphPanel.xField = fieldKey; else GraphPanel.yField = fieldKey;
    GraphPanel.render();
};

GraphPanel.renderChart = function () {
    const container = document.getElementById('graph-panel-body');
    if (!container || !State.hospitalsGeojson) return;
    const xField = graphFieldByKey(GraphPanel.xField);
    const yField = graphFieldByKey(GraphPanel.yField);
    const allFeatures = State.hospitalsGeojson.features;
    const features = allFeatures.filter(
        (f) => f.properties[xField.key] != null && f.properties[yField.key] != null
    );

    const W = 440, H = 380, M = { top: 16, right: 16, bottom: 46, left: 56 };
    const plotW = W - M.left - M.right;
    const plotH = H - M.top - M.bottom;

    const [x0, x1] = graphNiceDomain(features.map((f) => f.properties[xField.key]));
    const [y0, y1] = graphNiceDomain(features.map((f) => f.properties[yField.key]));
    const sx = (v) => M.left + ((v - x0) / (x1 - x0)) * plotW;
    const sy = (v) => M.top + plotH - ((v - y0) / (y1 - y0)) * plotH;

    const xTicks = graphNiceTicks(x0, x1, 5);
    const yTicks = graphNiceTicks(y0, y1, 5);

    const gridLines = [
        ...xTicks.map((t) => `<line x1="${sx(t)}" x2="${sx(t)}" y1="${M.top}" y2="${M.top + plotH}" class="graph-grid-line"/>`),
        ...yTicks.map((t) => `<line x1="${M.left}" x2="${M.left + plotW}" y1="${sy(t)}" y2="${sy(t)}" class="graph-grid-line"/>`)
    ].join('');
    const xLabels = xTicks.map((t) => `<text x="${sx(t)}" y="${M.top + plotH + 16}" class="graph-tick-label" text-anchor="middle">${graphFmtAxisTick(t)}</text>`).join('');
    const yLabels = yTicks.map((t) => `<text x="${M.left - 8}" y="${sy(t) + 3}" class="graph-tick-label" text-anchor="end">${graphFmtAxisTick(t)}</text>`).join('');

    // Colour always encodes ED diversion opportunity percentile, regardless
    // of which two fields are on the axes -- keeps the plot's colour
    // language identical to the map's hospital pins, rather than switching
    // meaning depending on axis choice.
    const points = features.map((f) => {
        const p = f.properties;
        const cx = sx(p[xField.key]);
        const cy = sy(p[yField.key]);
        const color = percentileRampColor(p.DiversionOpportunityPercentile);
        const selected = p.HospitalName === State.selectedHospitalName;
        return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${selected ? 8 : 5}"
                    fill="${color}" stroke="${selected ? '#1B1B1B' : '#7A241C'}" stroke-width="${selected ? 2.5 : 1}"
                    class="graph-point" data-hospital="${graphEscapeAttr(p.HospitalName)}"/>`;
    }).join('');

    container.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" class="graph-svg" width="100%" height="${H}">
            <g>${gridLines}</g>
            <g>${points}</g>
            <g>${xLabels}${yLabels}</g>
            <text x="${M.left + plotW / 2}" y="${H - 6}" class="graph-axis-label" text-anchor="middle">${xField.label}${xField.unit ? ' (' + xField.unit + ')' : ''}</text>
            <text x="14" y="${M.top + plotH / 2}" class="graph-axis-label" text-anchor="middle" transform="rotate(-90, 14, ${M.top + plotH / 2})">${yField.label}${yField.unit ? ' (' + yField.unit + ')' : ''}</text>
        </svg>
        <div class="graph-legend">
            <span class="graph-legend-ramp"></span>
            <span class="graph-legend-label">ED diversion opportunity — 0th <span class="graph-legend-arrow">&rarr;</span> 100th percentile</span>
        </div>
        <div class="graph-tooltip" id="graph-tooltip"></div>
        <div class="graph-panel-footnote">${features.length} of ${allFeatures.length} hospitals shown${features.length < allFeatures.length ? ' (missing data for one or both fields excluded)' : ''}</div>
    `;

    container.querySelectorAll('.graph-point').forEach((el) => {
        const hospitalName = el.dataset.hospital;
        el.addEventListener('click', () => selectHospital(hospitalName, { flyTo: true }));
        el.addEventListener('mousemove', (e) => GraphPanel.showTooltip(e, hospitalName));
        el.addEventListener('mouseleave', GraphPanel.hideTooltip);
    });
};

GraphPanel.showTooltip = function (e, hospitalName) {
    const tooltip = document.getElementById('graph-tooltip');
    const body = document.getElementById('graph-panel-body');
    if (!tooltip || !body || !State.hospitalsGeojson) return;
    const f = State.hospitalsGeojson.features.find((ft) => ft.properties.HospitalName === hospitalName);
    if (!f) return;
    const p = f.properties;
    const xField = graphFieldByKey(GraphPanel.xField);
    const yField = graphFieldByKey(GraphPanel.yField);
    tooltip.innerHTML = `
        <div class="graph-tooltip-name">${copilotEscapeHtml(p.MatchedName || p.HospitalName)}</div>
        <div class="graph-tooltip-meta">${xField.label}: ${xField.fmt(p[xField.key])} &middot; ${yField.label}: ${yField.fmt(p[yField.key])}</div>`;
    tooltip.style.display = 'block';
    const rect = body.getBoundingClientRect();
    tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
    tooltip.style.top = (e.clientY - rect.top + 14) + 'px';
};

// Field description tooltip -- shown on hovering a field chip or an axis's
// currently-assigned value (both in the header, so positioned relative to
// .graph-panel as a whole rather than #graph-panel-body like the point
// tooltip above).
GraphPanel.showFieldTooltip = function (e, fieldKey) {
    const tooltip = document.getElementById('graph-field-tooltip');
    const panel = document.getElementById('graph-panel');
    const field = graphFieldByKey(fieldKey);
    if (!tooltip || !panel || !field || !field.description) return;
    tooltip.innerHTML = `
        <div class="graph-field-tooltip-title">${copilotEscapeHtml(field.label)}</div>
        <div>${copilotEscapeHtml(field.description)}</div>`;
    tooltip.classList.add('graph-field-tooltip');
    tooltip.style.display = 'block';
    const rect = panel.getBoundingClientRect();
    // Flip to the left of the cursor near the panel's right edge so the
    // (wrapping, ~240px wide) tooltip doesn't run off the panel.
    const nearRightEdge = (e.clientX - rect.left) > rect.width - 260;
    tooltip.style.left = nearRightEdge ? '' : (e.clientX - rect.left + 14) + 'px';
    tooltip.style.right = nearRightEdge ? (rect.right - e.clientX + 14) + 'px' : '';
    tooltip.style.top = (e.clientY - rect.top + 16) + 'px';
};
GraphPanel.hideFieldTooltip = function () {
    const tooltip = document.getElementById('graph-field-tooltip');
    if (tooltip) tooltip.style.display = 'none';
};

GraphPanel.hideTooltip = function () {
    const tooltip = document.getElementById('graph-tooltip');
    if (tooltip) tooltip.style.display = 'none';
};

// Called from app.js's selectHospital() -- keeps the highlighted point in
// sync whichever side (map pin or scatter point) triggered the selection.
GraphPanel.highlightPoint = function (hospitalName) {
    if (!GraphPanel.isOpen() || !State.hospitalsGeojson) return;
    GraphPanel.renderChart();
};
