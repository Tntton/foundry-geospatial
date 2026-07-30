// ============================================================
// TARGETS TAB v2 · Prioritisation for PE
// ============================================================
// Guard against multiple executions
if (window.__targetsTabLoaded) {
  console.log('[Targets v2] targets-tab.js already loaded, skipping re-execution');
} else {
  window.__targetsTabLoaded = true;
  console.log('[Targets v2] targets-tab.js file is being PARSED/EXECUTED');
}

const TP = {

  // ── Weights (dimension weights, sum to 100) ───────────────
  weights: { deliver: 40, quality: 25, platform: 20, fit: 15 },
  BASE_WEIGHTS: { deliver: 40, quality: 25, platform: 20, fit: 15 },

  mode: 'platform',      // 'platform' | 'bolton'
  shortlist: new Set(),

  // Dimension metadata
  DIMS: [
    {
      id: 'deliver', label: 'Deliverability', color: '#465E4D',
      question: 'Can you actually buy it?',
      metrics: [
        { wt: '45%', name: 'Owner exit-readiness', logic: 'Hold tenure vs 5–7yr PE exit window. ≥7yr overdue → 100; 5–6yr ready → 90; <2yr cold → 30. Listed parent → 15.', src: 'Ownership timeline' },
        { wt: '30%', name: 'Succession risk', logic: 'Founder/family held & tenure. Founder >15yr → high; institutional / recent MBO → low.', src: 'Ownership register' },
        { wt: '25%', name: 'Deal contestability', logic: 'Proprietary / off-market → high. Known auction or banked process → discounted.', src: 'Deal intel' }
      ]
    },
    {
      id: 'quality', label: 'Asset quality', color: '#6E9277',
      question: 'Is the footprint worth owning?',
      metrics: [
        { wt: '50%', name: 'Footprint avg composite', logic: 'Clinic-count-weighted mean composite across catchments. Normalised 45→0, 70→100.', src: 'Composite model' },
        { wt: '30%', name: 'Tier 1–2 exposure', logic: '% of clinics in Tier 1–2 SA3s. Rewards concentration in strongest markets.', src: 'Tier ramp' },
        { wt: '20%', name: 'Billings trajectory', logic: 'Medicare GP billings CAGR across footprint vs national. Positive → higher score.', src: 'NRA 3yr CAGR' }
      ]
    },
    {
      id: 'platform', label: 'Platform potential', color: '#97C777',
      question: 'Can it scale into a platform?',
      metrics: [
        { wt: '40%', name: 'Independents nearby', logic: 'Acquirable independents in footprint regions — the bolt-on runway.', src: 'Clinic register' },
        { wt: '35%', name: 'Current scale', logic: 'Existing clinic count as a base. Normalised against largest player (169 = 100).', src: 'Clinic count' },
        { wt: '25%', name: 'Geographic density', logic: 'Clinics-per-region clustering. Tighter concentration → ops leverage → higher.', src: 'SA3 clustering' }
      ]
    },
    {
      id: 'fit', label: 'Strategic fit', color: '#C5E0B3',
      question: 'Does it match the thesis?',
      metrics: [
        { wt: '40%', name: 'Billing-model alignment', logic: '% bulk-bill vs thesis target (favours ≥70% bulk = revenue stability).', src: 'Billing mix' },
        { wt: '35%', name: 'Archetype alignment', logic: '% mid-format (4–8 GPs) — the PE sweet spot. Big-box & sub-scale discounted.', src: 'Archetype mix' },
        { wt: '25%', name: 'Co-located services', logic: 'Pathology / imaging / allied integration potential → cross-sell upside.', src: 'Website scrape' }
      ]
    }
  ],

  // ── Platform targets (pre-computed dimension scores 0–100) ─
  // Computed from: ownership timeline data, clinic DB metrics, NRA data
  PLATFORM: [
    {
      name: 'ForHealth', owner: 'BGH Capital', ownerType: 'PE', since: 2020, clinics: 75, regions: 68, indep: 544,
      deliver: 72, quality: 55, platform: 58, fit: 43,
      trigger: '5-year hold — exit window open. BGH Capital typically targets 5–7yr hold cycle.',
      triggerTone: 'warm',
      swatch: '#0070C0'
    },
    {
      name: 'Smart Clinics + Better Medical', owner: 'Livingbridge', ownerType: 'PE', since: 2020, clinics: 64, regions: 43, indep: 380,
      deliver: 70, quality: 68, platform: 48, fit: 22,
      trigger: '5-year hold — exit window open. QLD / WA heavy footprint suits a national consolidator.',
      triggerTone: 'warm',
      swatch: '#2E75B6'
    },
    {
      name: 'Family Doctor', owner: 'Dr. Rodney Aziz (Founder)', ownerType: 'Private', since: 2011, clinics: 110, regions: 63, indep: 630,
      deliver: 62, quality: 48, platform: 65, fit: 61,
      trigger: '14-year founder tenure — succession event likely within 3–5 years. Largest private platform in market.',
      triggerTone: 'warm',
      swatch: '#C00000'
    },
    {
      name: 'Partnered Health', owner: 'Quadrant Private Equity', ownerType: 'PE', since: 2021, clinics: 55, regions: 45, indep: 420,
      deliver: 52, quality: 56, platform: 48, fit: 27,
      trigger: '4-year hold — approaching exit window (2025–2026). Quadrant typically 5yr hold.',
      triggerTone: 'cool',
      swatch: '#385723'
    },
    {
      name: 'Jupiter Health', owner: 'Dr. Edward Soloman & Dr. Michael Gendy', ownerType: 'Private', since: 2011, clinics: 35, regions: 15, indep: 225,
      deliver: 58, quality: 41, platform: 42, fit: 38,
      trigger: '14-year founder tenure. WA-concentrated; succession risk rising. Tight cluster creates platform core.',
      triggerTone: 'warm',
      swatch: '#BF8F00'
    },
    {
      name: 'Qualitas Health', owner: 'Brookfield Asset Management', ownerType: 'PE', since: 2021, clinics: 39, regions: 27, indep: 310,
      deliver: 50, quality: 45, platform: 43, fit: 50,
      trigger: '4-year hold. Brookfield is a long-term infrastructure investor — sale timeline uncertain but window approaches.',
      triggerTone: 'cool',
      swatch: '#806000'
    },
    {
      name: 'Ochre Health', owner: 'Genesis Capital', ownerType: 'PE', since: 2022, clinics: 66, regions: 39, indep: 468,
      deliver: 45, quality: 52, platform: 51, fit: 34,
      trigger: '3-year hold — mid-cycle, not yet in exit window. Quality rural footprint with strong composite.',
      triggerTone: 'cool',
      swatch: '#E97132'
    },
    {
      name: 'My Health', owner: 'Medibank (49% stake) & Founders', ownerType: 'Listed', since: 2021, clinics: 114, regions: 68, indep: 650,
      deliver: 25, quality: 60, platform: 57, fit: 39,
      trigger: 'Listed parent (Medibank) limits deliverability. Strong asset quality but not for sale in near term.',
      triggerTone: 'off',
      swatch: '#7030A0'
    },
    {
      name: 'Sonic Healthcare (IPN)', owner: 'Sonic Healthcare ASX', ownerType: 'Listed', since: 1987, clinics: 169, regions: 111, indep: 850,
      deliver: 15, quality: 42, platform: 73, fit: 10,
      trigger: 'Listed parent — not for sale. Largest network but strategic hold. Deprioritise despite size.',
      triggerTone: 'off',
      swatch: '#1F4E79'
    },
    {
      name: 'Bupa Medical', owner: 'Bupa', ownerType: 'Strategic', since: 2015, clinics: 26, regions: 23, indep: 180,
      deliver: 12, quality: 38, platform: 28, fit: 20,
      trigger: 'Strategic/non-profit parent — mission-aligned, not seeking a PE exit. Off radar.',
      triggerTone: 'off',
      swatch: '#FF5050'
    }
  ],

  // ── Bolt-on targets (top independent-heavy SA3s) ──────────
  BOLTON: [],  // computed from State.sa3ClinicCounts at render time

  // ── Init ─────────────────────────────────────────────────
  init() {
    // Guard: prevent multiple initializations
    if (this._initialized) {
      console.log('[Targets v2] Already initialized, skipping');
      return;
    }
    this._initialized = true;

    console.log('[Targets v2] init() called');
    this.setupEventListeners();
    this.renderWeightingControls();
    console.log('[Targets v2] Module loaded');
  },

  enrichFromAppState() {
    this.BOLTON = this.buildBoltonTargets();
  },

  buildBoltonTargets() {
    if (!State || !State.sa3ClinicCounts || !State.sa3Data) return [];
    const targets = [];

    State.sa3Data.features.forEach(f => {
      const p = f.properties;
      const code = String(p.SA3Code || '').trim();
      const counts = State.sa3ClinicCounts[code];
      if (!counts) return;

      const indep = counts.independent || 0;
      const corp  = counts.corporate   || 0;
      const total = counts.total       || 0;
      if (indep < 8 || total < 10) return;  // skip thin regions

      const corpShare = total > 0 ? Math.round(corp / total * 100) : 0;
      const composite = parseFloat(p.Composite_Score) || 0;
      const tier      = parseInt(p.Tier) || 5;

      // Score bolt-on dimensions
      const deliverScore  = Math.max(0, Math.min(100, (100 - corpShare) * 1.2));  // low corp = easy to assemble
      const qualityScore  = composite > 0 ? Math.round((composite - 45) / 25 * 100) : 0;
      const platformScore = Math.min(100, Math.round(indep * 2.5));               // more indep = more runway
      const fitScore      = counts.billing
        ? Math.round(((counts.billing['Bulk'] || 0) / (counts.total || 1)) * 100 * 1.5) : 50;

      if (tier > 4 || composite < 48) return;  // only quality regions

      targets.push({
        name:       p.SA3Name,
        state:      p.State,
        tier,
        composite:  +composite.toFixed(1),
        corpShare,
        indep,
        avgSize:    counts.format && (counts.format['Big-box'] > counts.format['Mid-format'])
                      ? 'Big' : (counts.format && counts.format['Mid-format'] > counts.format['Small'] ? 'Mid' : 'Small'),
        deliver:    Math.round(deliverScore),
        quality:    Math.min(100, Math.max(0, qualityScore)),
        platform:   Math.min(100, platformScore),
        fit:        Math.min(100, fitScore),
        trigger:    corpShare < 25
          ? `${100 - corpShare}% independent — fragmented market, low competition for acquisitions.`
          : `${indep} acquirable independents · ${corpShare}% corporate share.`,
        triggerTone: corpShare < 20 ? 'hot' : (corpShare < 35 ? 'warm' : 'cool'),
        code
      });
    });

    targets.sort((a, b) => this.scoreOf(b) - this.scoreOf(a));
    return targets.slice(0, 12);
  },

  // ── Scoring ───────────────────────────────────────────────
  scoreOf(t) {
    const w = this.weights;
    const total = w.deliver + w.quality + w.platform + w.fit;
    return (t.deliver * w.deliver + t.quality * w.quality +
            t.platform * w.platform + t.fit * w.fit) / total;
  },

  bandOf(score) {
    if (score >= 62) return 'high';
    if (score >= 50) return 'watch';
    return 'dep';
  },

  bandLabel(band) {
    return { high: 'HIGH PRIORITY', watch: 'WATCH', dep: 'DEPRIORITIZE' }[band];
  },

  contribWidths(t) {
    // Each segment = dimensionScore × dimensionWeight, then normalize to 100%
    const w = this.weights;
    const segs = [
      { color: '#465E4D', val: t.deliver  * w.deliver  },
      { color: '#6E9277', val: t.quality  * w.quality  },
      { color: '#97C777', val: t.platform * w.platform },
      { color: '#C5E0B3', val: t.fit      * w.fit      }
    ];
    const total = segs.reduce((s, x) => s + x.val, 0);
    return segs.map(s => ({ ...s, pct: total > 0 ? (s.val / total * 100).toFixed(1) : 0 }));
  },

  // ── Render ────────────────────────────────────────────────
  render() {
    this.enrichFromAppState();
    this.renderList();
    this.updateWeightingSliders();
  },

  renderList() {
    const list  = document.getElementById('tp-list');
    if (!list) return;
    const isPlatform = this.mode === 'platform';
    const data  = isPlatform ? [...this.PLATFORM] : [...this.BOLTON];

    // Sort by current weights
    data.sort((a, b) => this.scoreOf(b) - this.scoreOf(a));

    // Update hero title
    const title = document.getElementById('tp-hero-title');
    const sub   = document.getElementById('tp-hero-sub');
    if (title) title.textContent = isPlatform ? 'Platform acquisitions' : 'Bolt-on roll-up regions';
    if (sub) sub.textContent = isPlatform
      ? 'Ranked by Target Score — a weighted composite of Deliverability, Asset quality, Platform potential and Strategic fit. Deliverability is weighted highest to surface exit-ready assets over large-but-unavailable majors.'
      : 'Regions ranked by acquisition attractiveness for bolt-on roll-up. Score reflects fragmentation, independent density, composite quality, and strategic fit of local clinics.';

    list.innerHTML = '';
    data.forEach((t, idx) => {
      const score = this.scoreOf(t);
      const band  = this.bandOf(score);
      const segs  = this.contribWidths(t);
      const inShortlist = this.shortlist.has(t.name);

      const row = document.createElement('div');
      row.className = `tp-row tp-band-${band}`;
      row.dataset.name = t.name;

      if (isPlatform) {
        row.innerHTML = `
          <div class="tp-col-rank">${String(idx + 1).padStart(2, '0')}</div>

          <div class="tp-col-id">
            <div class="tp-id-name">${t.name}</div>
            <div>
              <span class="tp-id-tag ${t.ownerType.toLowerCase()}">${t.ownerType}</span>
              <span class="tp-id-backer">${t.owner}</span>
            </div>
          </div>

          <div class="tp-col-score">
            <div class="tp-score-num">${Math.round(score)}</div>
            <span class="tp-band-pill ${band}">${this.bandLabel(band)}</span>
          </div>

          <div class="tp-col-contrib">
            <div class="tp-contbar">
              ${segs.map(s => `<div class="tp-contbar-seg" style="width:${s.pct}%;background:${s.color}"></div>`).join('')}
            </div>
            <div class="tp-quickstats">
              <div class="tp-qs"><span class="tp-qs-val">${t.clinics}</span><span class="tp-qs-lbl">Clinics</span></div>
              <div class="tp-qs"><span class="tp-qs-val">${t.regions}</span><span class="tp-qs-lbl">Regions</span></div>
              <div class="tp-qs"><span class="tp-qs-val">${t.indep}</span><span class="tp-qs-lbl">Indep. nearby</span></div>
            </div>
          </div>

          <div class="tp-col-trigger">
            <div class="tp-trigger">
              <div class="tp-trigger-dot ${t.triggerTone}"></div>
              <div class="tp-trigger-text">${t.trigger}</div>
            </div>
          </div>

          <div class="tp-col-actions">
            <button class="tp-btn-primary tp-dossier-btn" data-name="${t.name}">Open dossier</button>
            <button class="tp-btn-shortlist ${inShortlist ? 'active' : ''} tp-shortlist-btn" data-name="${t.name}">
              ${inShortlist ? '✓ Shortlisted' : '＋ Shortlist'}
            </button>
          </div>
        `;
      } else {
        row.innerHTML = `
          <div class="tp-col-rank">${String(idx + 1).padStart(2, '0')}</div>

          <div class="tp-col-id">
            <div class="tp-id-region">${t.name}</div>
            <div class="tp-id-meta">${t.state} · Tier ${t.tier} · ${t.corpShare}% corporate · ${t.indep} independents</div>
          </div>

          <div class="tp-col-score">
            <div class="tp-score-num">${Math.round(score)}</div>
            <span class="tp-band-pill ${band}">${this.bandLabel(band)}</span>
          </div>

          <div class="tp-col-contrib">
            <div class="tp-contbar">
              ${segs.map(s => `<div class="tp-contbar-seg" style="width:${s.pct}%;background:${s.color}"></div>`).join('')}
            </div>
            <div class="tp-quickstats">
              <div class="tp-qs"><span class="tp-qs-val">${t.composite}</span><span class="tp-qs-lbl">Composite</span></div>
              <div class="tp-qs"><span class="tp-qs-val">${t.indep}</span><span class="tp-qs-lbl">Acquirable</span></div>
              <div class="tp-qs"><span class="tp-qs-val">${t.avgSize}</span><span class="tp-qs-lbl">Avg size</span></div>
            </div>
          </div>

          <div class="tp-col-trigger">
            <div class="tp-trigger">
              <div class="tp-trigger-dot ${t.triggerTone}"></div>
              <div class="tp-trigger-text">${t.trigger}</div>
            </div>
          </div>

          <div class="tp-col-actions">
            <button class="tp-btn-primary tp-buildup-btn" data-code="${t.code}" data-name="${t.name}">Build roll-up</button>
            <button class="tp-btn-shortlist ${inShortlist ? 'active' : ''} tp-shortlist-btn" data-name="${t.name}">
              ${inShortlist ? '✓ Shortlisted' : '＋ Shortlist'}
            </button>
          </div>
        `;
      }
      list.appendChild(row);
    });
  },

  renderWeightingControls() {
    const container = document.getElementById('tp-dims');
    if (!container) return;
    container.innerHTML = '';

    this.DIMS.forEach(dim => {
      const pct = this.weights[dim.id];
      const el  = document.createElement('div');
      el.className = 'tp-dim';
      el.innerHTML = `
        <div class="tp-dim-left">
          <div class="tp-dim-head">
            <div class="tp-dim-swatch" style="background:${dim.color}"></div>
            <div class="tp-dim-name">${dim.label}</div>
            <div class="tp-dim-pct" id="tp-pct-${dim.id}">${pct}%</div>
          </div>
          <div class="tp-dim-q">${dim.question}</div>
          <input type="range" class="tp-dim-slider" data-dim="${dim.id}"
            min="0" max="60" step="5" value="${pct}" id="tp-slider-${dim.id}">
          <div class="tp-dim-range-label"><span>0%</span><span>60%</span></div>
        </div>
        <div class="tp-dim-right">
          <div class="tp-metrics">
            ${dim.metrics.map(m => `
              <div class="tp-metric">
                <div class="tp-metric-wt">${m.wt}</div>
                <div class="tp-metric-body">
                  <div class="tp-metric-name">${m.name}</div>
                  <div class="tp-metric-logic">${m.logic}</div>
                </div>
                <div class="tp-metric-src">${m.src}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      container.appendChild(el);
    });

    // Wire sliders
    container.querySelectorAll('.tp-dim-slider').forEach(slider => {
      slider.addEventListener('input', () => this.handleSlider());
    });
  },

  updateWeightingSliders() {
    this.DIMS.forEach(dim => {
      const s = document.getElementById(`tp-slider-${dim.id}`);
      const p = document.getElementById(`tp-pct-${dim.id}`);
      if (s) s.value = this.weights[dim.id];
      if (p) p.textContent = this.weights[dim.id] + '%';
    });
  },

  handleSlider() {
    // Read raw values
    const raw = {};
    this.DIMS.forEach(dim => {
      const s = document.getElementById(`tp-slider-${dim.id}`);
      raw[dim.id] = s ? parseInt(s.value) : this.weights[dim.id];
    });

    // Normalize so sum = 100
    const total = Object.values(raw).reduce((s, v) => s + v, 0);
    if (total === 0) return;

    this.DIMS.forEach(dim => {
      this.weights[dim.id] = Math.round(raw[dim.id] / total * 100);
      const p = document.getElementById(`tp-pct-${dim.id}`);
      if (p) p.textContent = this.weights[dim.id] + '%';
    });

    // Re-sort and re-render list with animation
    this.renderList();
  },

  exportShortlist(names) {
    const isPlatform = this.mode === 'platform';
    const data = isPlatform ? this.PLATFORM : this.BOLTON;
    const shortlistedData = data.filter(t => names.includes(t.name));

    if (!shortlistedData.length) {
      alert('No shortlisted targets found.');
      return;
    }

    // Build CSV header
    const isPlatformMode = this.mode === 'platform';
    const headers = isPlatformMode
      ? ['Rank', 'Name', 'Owner', 'Owner Type', 'Score', 'Deliverability', 'Quality', 'Platform', 'Strategic Fit', 'Clinics', 'Regions', 'Independents']
      : ['Rank', 'Region', 'State', 'Tier', 'Score', 'Deliverability', 'Quality', 'Platform', 'Strategic Fit', 'Composite', 'Acquirable', 'Avg Size'];

    // Build CSV rows
    const rows = shortlistedData.map((t, idx) => {
      const score = this.scoreOf(t);
      const segs = this.contribWidths(t);
      const deliver = Math.round(t.deliver || 0);
      const quality = Math.round(t.quality || 0);
      const platform = Math.round(t.platform || 0);
      const fit = Math.round(t.fit || 0);

      if (isPlatformMode) {
        return [idx + 1, t.name, t.owner, t.ownerType, Math.round(score), deliver, quality, platform, fit, t.clinics, t.regions, t.indep];
      } else {
        return [idx + 1, t.name, t.state, t.tier, Math.round(score), deliver, quality, platform, fit, t.composite, t.indep, t.avgSize];
      }
    });

    // Convert to CSV
    const csv = [headers, ...rows].map(row =>
      row.map(cell => {
        const str = String(cell || '');
        return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(',')
    ).join('\n');

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const mode = isPlatformMode ? 'platforms' : 'bolton';
    const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
    link.setAttribute('href', url);
    link.setAttribute('download', `FH_GP_Diligence_shortlist_${mode}_${dateStr}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  // ── Event listeners ───────────────────────────────────────
  setupEventListeners() {
    document.addEventListener('click', e => {
      // Mode toggle
      if (e.target.classList.contains('tp-toggle')) {
        document.querySelectorAll('.tp-toggle').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.mode = e.target.dataset.mode;
        if (this.mode === 'bolton' && this.BOLTON.length === 0) this.enrichFromAppState();
        this.renderList();
      }
      // Reset weights
      if (e.target.id === 'tp-reset-weights') {
        this.weights = { ...this.BASE_WEIGHTS };
        this.updateWeightingSliders();
        this.renderList();
      }
      // Shortlist toggle
      if (e.target.classList.contains('tp-shortlist-btn')) {
        const name = e.target.dataset.name;
        if (this.shortlist.has(name)) { this.shortlist.delete(name); }
        else { this.shortlist.add(name); }
        // Update all matching shortlist buttons
        document.querySelectorAll(`.tp-shortlist-btn[data-name="${name}"]`).forEach(btn => {
          btn.classList.toggle('active', this.shortlist.has(name));
          btn.textContent = this.shortlist.has(name) ? '✓ Shortlisted' : '＋ Shortlist';
        });
      }
      // Dossier — trigger chain filter on Map tab
      if (e.target.classList.contains('tp-dossier-btn')) {
        const name = e.target.dataset.name;
        const mapBtn = document.querySelector('.nav-btn[data-view="map"]');
        if (mapBtn) mapBtn.click();
        setTimeout(() => {
          const cb = document.querySelector(`.clinic-chain-checkbox[data-chain="${name}"]`);
          if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
        }, 400);
      }
      // Build roll-up — go to Map, select SA3
      if (e.target.classList.contains('tp-buildup-btn')) {
        const code = e.target.dataset.code;
        const mapBtn = document.querySelector('.nav-btn[data-view="map"]');
        if (mapBtn) mapBtn.click();
        setTimeout(() => {
          if (typeof selectSA3 === 'function' && code) selectSA3(code);
        }, 400);
      }
      // Export shortlist
      if (e.target.id === 'tp-export-shortlist') {
        const names = [...this.shortlist];
        if (!names.length) { alert('No targets shortlisted yet — click ＋ Shortlist on any row.'); return; }
        this.exportShortlist(names);
      }
    });

    // Persist/restore state
    window.addEventListener('beforeunload', () => {
      sessionStorage.setItem('fh.targets.weights', JSON.stringify(this.weights));
      sessionStorage.setItem('fh.targets.mode', this.mode);
      sessionStorage.setItem('fh.targets.shortlist', JSON.stringify([...this.shortlist]));
    });

    const savedW = sessionStorage.getItem('fh.targets.weights');
    const savedM = sessionStorage.getItem('fh.targets.mode');
    const savedS = sessionStorage.getItem('fh.targets.shortlist');
    if (savedW) try { this.weights = JSON.parse(savedW); } catch(e){}
    if (savedM) this.mode = savedM;
    if (savedS) try { this.shortlist = new Set(JSON.parse(savedS)); } catch(e){}
  }
};

// Hook into app switchView (only run once, guard against re-execution)
if (!window.__targetsTabInitialized) {
  window.__targetsTabInitialized = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => TP.init());
  } else {
    TP.init();
  }
}

// Keep backward-compat name so switchView hook works
const TargetsTab = {
  enrichFromAppState: () => TP.enrichFromAppState(),
  render: () => TP.render()
};
