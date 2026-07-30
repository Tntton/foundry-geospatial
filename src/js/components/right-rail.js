/* ============================================================
 * RIGHT RAIL — context-aware dossier (spec: right-rail-spec.md)
 * Loaded as a separate <script defer> to isolate from main app.js
 *
 * Three modes: 'region-only' | 'chains-only' | 'both'
 * Ghost-panel fix: old .target-overview-drawer is hidden via CSS.
 * ============================================================ */

// ── Helpers ──────────────────────────────────────────────────

function getRailMode() {
    var hasSA3   = !!State.currentSA3Code;
    var hasChain = (State.clinicChainFilter || []).length > 0;
    if (hasSA3  && hasChain)  { return 'both'; }
    if (hasSA3  && !hasChain) { return 'region-only'; }
    if (!hasSA3 && hasChain)  { return 'chains-only'; }
    return null;
}

function rdTierPill(tier) {
    var color = TIER_COLORS[tier] || '#9A9A9A';
    var t5    = (tier === 5);
    var bg    = t5 ? '#FCE4E4' : 'var(--accent-soft, #E9F0EB)';
    var fg    = t5 ? 'var(--fh-red, #C00000)' : 'var(--sage-deep, #465E4D)';
    return '<div class="rd-tier-pill" style="background:' + bg + ';color:' + fg + '">'
         + '<span class="rd-tier-dot" style="background:' + color + '"></span>'
         + (TIER_LABELS[tier] || 'Tier ' + tier)
         + '</div>';
}

function rdScoreRing(score, tierColor) {
    var r    = 27;
    var circ = 2 * Math.PI * r;
    var target = circ * (1 - score / 100);
    return '<div class="rd-score-ring">'
         + '<svg viewBox="0 0 64 64">'
         + '<circle class="rd-ring-track" cx="32" cy="32" r="' + r + '"/>'
         + '<circle class="rd-ring-arc" cx="32" cy="32" r="' + r + '"'
         + ' stroke="' + tierColor + '"'
         + ' stroke-dasharray="' + circ + '"'
         + ' stroke-dashoffset="' + circ + '"'
         + ' data-target="' + target + '"/>'
         + '</svg>'
         + '<div class="rd-ring-label">'
         + '<span class="rd-ring-score">' + Math.round(score) + '</span>'
         + '<span class="rd-ring-denom">/100</span>'
         + '</div></div>';
}

function rdDecompBars(demand, supply, competition, economics) {
    var bars = [
        { label:'Demand',      weight:'30%', value: demand },
        { label:'Supply',      weight:'35%', value: supply },
        { label:'Competition', weight:'20%', value: competition },
        { label:'Economics',   weight:'15%', value: economics }
    ];
    var rows = bars.map(function(b) {
        return '<div class="rd-bar-row">'
             + '<div><div class="rd-bar-label-name">' + b.label + '</div>'
             + '<div class="rd-bar-label-weight">' + b.weight + '</div></div>'
             + '<div class="rd-bar-track"><div class="rd-bar-fill" style="width:' + b.value + '%"></div></div>'
             + '<div class="rd-bar-value">' + Math.round(b.value) + '</div>'
             + '</div>';
    }).join('');
    return '<div class="rd-decomp">'
         + '<div class="rd-decomp-head">'
         + '<span class="rd-decomp-title">Score decomposition</span>'
         + '<span class="rd-decomp-denom">/ 100</span>'
         + '</div>' + rows + '</div>';
}

function chainCountInSA3(chainName, sa3Code) {
    return (State.clinicsData || []).filter(function(c) {
        return (c['Corporate Chain'] || '').trim() === chainName
            && String(c['sa3_code'] || '').replace(/\.\d+$/, '') === String(sa3Code);
    }).length;
}

function rdChainRow(chainName, statCells, showExport) {
    var palette     = CLINIC_CHAIN_PALETTE[chainName] || {};
    var color       = palette.color || '#6E9277';
    var displayName = palette.name || chainName;
    var absentCls   = statCells.absent ? ' absent' : '';

    var cols = statCells.cols.map(function(c) {
        return '<div class="rd-stat-cell">'
             + '<div class="rd-stat-value' + (c.cls ? ' ' + c.cls : '') + '">' + c.value + '</div>'
             + '<div class="rd-stat-label">' + c.label + '</div>'
             + '</div>';
    }).join('');

    var exportBtn = '';
    if (showExport) {
        var escapedName = chainName.replace(/'/g, "\\'");
        exportBtn = '<div class="rd-chain-actions" style="display:none;">'
                  + '<button class="rd-chain-export-btn" onclick="exportTargetDossier(\'' + escapedName + '\')">Export chain dossier ↗</button>'
                  + '</div>';
    }

    return '<div class="rd-chain-row' + absentCls + '">'
         + '<div class="rd-chain-head">'
         + '<div class="rd-chain-swatch" style="background:' + color + '"></div>'
         + '<div class="rd-chain-name">' + displayName + '</div>'
         + statCells.tag
         + '</div>'
         + '<div class="rd-chain-stats">' + cols + '</div>'
         + exportBtn
         + '</div>';
}

function rdInsightText(chains, sa3Props) {
    if (!chains || chains.length < 1 || !sa3Props) { return ''; }
    var regionName         = sa3Props.SA3Name || 'this region';
    var totalRegionClinics = ((State.sa3ClinicCounts || {})[sa3Props.SA3Code] || {}).total || 0;
    var indep              = ((State.sa3ClinicCounts || {})[sa3Props.SA3Code] || {}).independent || 0;
    var summary            = State.targetMetaSummary || {};

    var chainCounts = chains.map(function(c) {
        return {
            name:     (CLINIC_CHAIN_PALETTE[c] || {}).name || c,
            inRegion: chainCountInSA3(c, sa3Props.SA3Code),
            national: ((summary[c] || {})).totalClinics || 0
        };
    });

    var combined     = chainCounts.reduce(function(s, c) { return s + c.inRegion; }, 0);
    var sharePct     = totalRegionClinics > 0 ? ((combined / totalRegionClinics) * 100).toFixed(0) : 0;
    var colocCount   = 0;

    if (chains.length >= 2 && State.sa3Data) {
        State.sa3Data.features.forEach(function(f) {
            var code = f.properties.SA3Code;
            var all  = chains.every(function(c) { return chainCountInSA3(c, code) > 0; });
            if (all) { colocCount++; }
        });
    }

    if (chains.length === 1) {
        var c0 = chainCounts[0];
        var s0 = totalRegionClinics > 0 ? ((c0.inRegion / totalRegionClinics) * 100).toFixed(0) : 0;
        return '<b>' + c0.name + '</b> has <b>' + c0.inRegion + '</b> of <b>' + totalRegionClinics
             + '</b> clinics in ' + regionName + ' (<b>' + s0 + '%</b>), leaving <b>'
             + indep + ' independent practices</b> independently-owned.';
    }

    var names = chainCounts.map(function(c) { return '<b>' + c.name + '</b>'; }).join(' and ');
    return names + ' co-locate in <b>' + colocCount + ' regions nationally</b>. Combined chain footprint in '
         + regionName + ' is <b>' + combined + ' / ' + totalRegionClinics + ' clinics ('
         + sharePct + '%)</b>, leaving <b>' + indep + ' independent practices</b> independently-owned.';
}

// ── Main renderer ─────────────────────────────────────────────

function renderRightRail() {
    var mode   = getRailMode();
    var drawer = document.getElementById('detail-drawer');
    var body   = document.getElementById('drawer-body');
    if (!drawer || !body) { return; }

    if (!mode) {
        drawer.classList.remove('active');
        return;
    }

    drawer.classList.add('active');

    var chains  = State.clinicChainFilter || [];
    var sa3Code = State.currentSA3Code;
    var sa3Feat = null;
    if (sa3Code && State.sa3Data) {
        sa3Feat = State.sa3Data.features.find(function(f) {
            return f.properties.SA3Code === sa3Code;
        }) || null;
    }
    var p = sa3Feat ? sa3Feat.properties : null;

    // ── Header ──
    var eyebrow, title, sub;
    if (mode === 'chains-only') {
        eyebrow = 'TARGET CHAINS · NATIONAL';
        title   = chains.length === 1
            ? ((CLINIC_CHAIN_PALETTE[chains[0]] || {}).name || chains[0])
            : (chains.length + ' chains selected');
        sub = chains.map(function(c) {
            return (CLINIC_CHAIN_PALETTE[c] || {}).name || c;
        }).join(' · ');
    } else {
        eyebrow = 'SA3 REGION · ' + (p ? p.SA3Code : '');
        title   = p ? p.SA3Name : '';
        sub     = p ? p.State   : '';
    }

    var header = '<div class="rd-header">'
               + '<div class="rd-header-text">'
               + '<div class="rd-eyebrow">' + eyebrow + '</div>'
               + '<h2 class="rd-title" title="' + title + '">' + title + '</h2>'
               + '<div class="rd-sub">' + sub + '</div>'
               + '</div>'
               + '<div class="rd-header-actions" style="position:relative">'
               + '<button class="rd-export-btn" style="display:none;" onclick="rdToggleExportPopover(event)">'
               + '⇩ Export ▾</button>'
               + '<div class="rd-export-popover" id="rd-export-popover" style="display:none;">'
               + '<button class="rd-export-popover-item" onclick="rdExport(\'pptx\')">'
               + '<span class="rd-export-ext">.pptx</span>'
               + '<span class="rd-export-desc">Full dossier</span></button>'
               + '<button class="rd-export-popover-item" onclick="rdExport(\'xlsx\')">'
               + '<span class="rd-export-ext">.xlsx</span>'
               + '<span class="rd-export-desc">Raw data</span></button>'
               + '</div>'
               + '<button class="rd-close" onclick="closeDrawer()">×</button>'
               + '</div></div>';

    // ── Body ──
    var content = '<div class="rd-body">';

    if (mode === 'region-only' || mode === 'both') {
        var tier      = parseInt(p.Tier) || 5;
        var tierColor = TIER_COLORS[tier] || '#C00000';
        var score     = parseFloat(p.Composite_Score) || 0;
        var THESIS    = {
            1: 'Top-decile market with a strong consolidation thesis.',
            2: 'High-conviction region — multiple acquisition targets available.',
            3: 'Selectively attractive; demands targeted thesis.',
            4: 'Below-median fundamentals; deprioritise unless distressed.',
            5: 'Low-priority market under base-case methodology.'
        };

        content += '<div class="rd-score-card">'
                +  rdScoreRing(score, tierColor)
                +  '<div class="rd-score-meta">'
                +  rdTierPill(tier)
                +  '<div class="rd-thesis-eyebrow">INVESTMENT THESIS</div>'
                +  '<div class="rd-thesis-statement">' + (THESIS[tier] || '') + '</div>'
                +  '</div></div>';

        // Chain-in-region strip (both mode)
        if (mode === 'both' && chains.length > 0) {
            var summary          = State.targetMetaSummary || {};
            var totalInRegion    = ((State.sa3ClinicCounts || {})[sa3Code] || {}).total || 0;

            var chainRowsHtml = chains.map(function(chainName) {
                var nat        = ((summary[chainName] || {})).totalClinics || 0;
                var natRegions = ((summary[chainName] || {})).regionsPresent || 0;
                var natAvg     = natRegions > 0 ? (nat / natRegions) : 0;
                var inR        = chainCountInSA3(chainName, sa3Code);
                var absent     = (inR === 0);
                var sharePct   = totalInRegion > 0 ? ((inR / totalInRegion) * 100).toFixed(1) : '0.0';
                var delta      = natAvg > 0 ? ((inR - natAvg) / natAvg * 100).toFixed(0) : null;
                var deltaCls   = !delta ? '' : (parseFloat(delta) >= 0 ? 'positive' : 'negative');
                var deltaStr   = !delta ? '—' : ((parseFloat(delta) >= 0 ? '+' : '') + delta + '%');
                var tag        = absent
                    ? '<span class="rd-chain-tag absent-tag">ABSENT</span>'
                    : '<span class="rd-chain-tag present">' + inR + ' SITE' + (inR !== 1 ? 'S' : '') + '</span>';
                return rdChainRow(chainName, {
                    absent: absent,
                    tag:    tag,
                    cols:   [
                        { value: inR + '<span class="rd-stat-muted">/' + nat + '</span>', label: "In region / nat'l" },
                        { value: sharePct + '%', label: 'Share of region' },
                        { value: deltaStr,       label: 'vs natʼl avg', cls: deltaCls }
                    ]
                }, true);
            }).join('');

            var insight = rdInsightText(chains, p);
            content += '<div class="rd-chain-region">'
                    +  '<div class="rd-section-head"><span>Filtered chains · in ' + p.SA3Name + '</span>'
                    +  '<button class="rd-section-link" onclick="rdClearChainFilter()">Clear chain filter</button></div>'
                    +  chainRowsHtml
                    +  (insight ? '<div class="rd-insight"><div class="rd-insight-label">CROSS-TAB INSIGHT</div>'
                               +  '<div class="rd-insight-body">' + insight + '</div></div>' : '')
                    +  '</div>';
        }

        content += rdDecompBars(
            parseFloat(p.Demand_Score)      || 0,
            parseFloat(p.Supply_Score)      || 0,
            parseFloat(p.Competition_Score) || 0,
            parseFloat(p.Economics_Score)   || 0
        );

        // Append existing drawer sections (minus score-decomp which we just rendered)
        var existingBody = document.getElementById('drawer-body');
        if (existingBody) {
            existingBody.querySelectorAll('.drawer-section').forEach(function(sec) {
                if (!sec.querySelector('.score-bars')) {
                    content += sec.outerHTML;
                }
            });
        }
    }

    if (mode === 'chains-only') {
        var summary = State.targetMetaSummary || {};
        var chainRowsHtml = chains.map(function(chainName) {
            var s = summary[chainName] || {};
            return rdChainRow(chainName, {
                absent: false,
                tag:    '<span class="rd-chain-tag present">' + (s.totalClinics || 0) + ' SITES</span>',
                cols:   [
                    { value: String(s.totalClinics || 0),                       label: "Clinics (nat'l)"   },
                    { value: parseFloat(s.avgComposite || 0).toFixed(1),        label: 'Avg composite'    },
                    { value: String(s.regionsPresent || 0),                     label: 'SA3 regions'      }
                ]
            }, true);
        }).join('');

        // Overlap callout for 2+ chains
        var overlapHtml = '';
        if (chains.length >= 2) {
            var matrix    = State.targetOverlapMatrix || {};
            var sentences = [];
            for (var i = 0; i < chains.length; i++) {
                for (var j = i + 1; j < chains.length; j++) {
                    var sorted  = [chains[i], chains[j]].sort();
                    var key     = sorted[0] + '|' + sorted[1];
                    var ov      = matrix[key] || {};
                    var nA      = (CLINIC_CHAIN_PALETTE[chains[i]] || {}).name || chains[i];
                    var nB      = (CLINIC_CHAIN_PALETTE[chains[j]] || {}).name || chains[j];
                    var n       = ov.count || 0;
                    var summA   = (State.targetMetaSummary || {})[chains[i]] || {};
                    var summB   = (State.targetMetaSummary || {})[chains[j]] || {};
                    var pctA    = summA.regionsPresent > 0 ? ((n / summA.regionsPresent) * 100).toFixed(1) : '—';
                    var pctB    = summB.regionsPresent > 0 ? ((n / summB.regionsPresent) * 100).toFixed(1) : '—';
                    sentences.push(nA + ' and ' + nB + ' co-locate in <b>' + n + ' region'
                                 + (n !== 1 ? 's' : '') + '</b> — ' + pctA + '% of ' + nA
                                 + '\'s footprint, ' + pctB + '% of ' + nB + '\'s.');
                }
            }
            overlapHtml = '<div class="rd-overlap">'
                        + '<div class="rd-overlap-label">OVERLAP</div>'
                        + sentences.map(function(s) {
                              return '<div class="rd-overlap-body">' + s + '</div>';
                          }).join('')
                        + '<button class="rd-overlap-link" onclick="rdShowColocatedRegions()">'
                        + 'Show co-located regions on map →</button>'
                        + '</div>';
        }

        content += '<div style="padding:14px 20px">' + chainRowsHtml + overlapHtml + '</div>';
    }

    content += '</div>'; // close rd-body

    body.innerHTML = header + content;

    // Animate ring arc
    requestAnimationFrame(function() {
        var arc = body.querySelector('.rd-ring-arc');
        if (arc) { arc.style.strokeDashoffset = arc.dataset.target; }
    });

    // Scroll persistence
    var drawer2 = document.getElementById('detail-drawer');
    if (drawer2) {
        var saved = sessionStorage.getItem('fh.rail.scroll.' + mode);
        if (saved) { setTimeout(function() { drawer2.scrollTop = parseInt(saved, 10); }, 60); }
        drawer2.onscroll = function() {
            sessionStorage.setItem('fh.rail.scroll.' + getRailMode(), drawer2.scrollTop);
        };
    }
}

// ── Actions ───────────────────────────────────────────────────

function rdToggleExportPopover(e) {
    e.stopPropagation();
    var pop = document.getElementById('rd-export-popover');
    if (pop) { pop.classList.toggle('open'); }
    // Close when clicking elsewhere
    setTimeout(function() {
        document.addEventListener('click', function closeRdPop(ev) {
            var pop2 = document.getElementById('rd-export-popover');
            if (pop2) { pop2.classList.remove('open'); }
            document.removeEventListener('click', closeRdPop);
        });
    }, 10);
}

function rdExport(format) {
    console.log('[rdExport] Called with format:', format, 'mode:', getRailMode());
    var pop  = document.getElementById('rd-export-popover');
    if (pop) { pop.classList.remove('open'); }
    var mode   = getRailMode();
    var chains = State.clinicChainFilter || [];
    if (format === 'pptx') {
        if (mode === 'region-only') {
            rdExportRegionDossier();
        } else if (chains.length > 0 && typeof exportTargetDossier === 'function') {
            // Export each selected chain — stagger by 600ms so downloads don't collide
            chains.forEach(function(chainName, i) {
                setTimeout(function() { exportTargetDossier(chainName); }, i * 600);
            });
        } else {
            alert('Select at least one chain to export a chain dossier.');
        }
    } else if (format === 'xlsx') {
        if (chains.length > 0 && typeof exportTargetCSV === 'function') {
            // Export each selected chain — stagger by 600ms so downloads don't collide
            chains.forEach(function(chainName, i) {
                setTimeout(function() { exportTargetCSV(chainName); }, i * 600);
            });
        } else {
            alert('Select at least one chain to export data.');
        }
    } else {
        alert(format.toUpperCase() + ' export coming soon.');
    }
}

function rdExportRegionDossier() {
    console.log('[Region Export] Starting region dossier export...');
    var sa3Code = State.currentSA3Code;
    if (!sa3Code || !State.sa3Data) {
        alert('No region selected. Click a region on the map first.');
        return;
    }

    var feature = State.sa3Data.features.find(function(f) { return f.properties.SA3Code === sa3Code; });
    if (!feature) {
        alert('Region data not found.');
        return;
    }

    // Call the PPTX export function from app.js
    if (typeof exportRegionDossier === 'function') {
        exportRegionDossier(sa3Code);
    } else {
        alert('Export function not available — please refresh and try again.');
    }
}

function rdClearChainFilter() {
    State.clinicChainFilter = [];
    document.querySelectorAll('.clinic-chain-checkbox').forEach(function(el) { el.checked = false; });
    var rst = document.getElementById('clinic-chains-reset');
    if (rst) { rst.classList.add('hidden'); }
    if (typeof applyWorkforceFilters === 'function') { applyWorkforceFilters(); }
    else if (typeof applyMmmFilter === 'function')   { applyMmmFilter(); }
    if (typeof updateFilterChips === 'function')     { updateFilterChips(); }
    renderRightRail();
}

function rdShowColocatedRegions() {
    var chains  = State.clinicChainFilter || [];
    if (chains.length < 2) { return; }
    var metrics = State.sa3TargetMetrics || {};
    var codes   = Object.keys(metrics).filter(function(code) {
        return chains.every(function(c) { return metrics[code] && metrics[code][c]; });
    });
    if (codes.length === 0) { alert('No co-located regions found.'); return; }
    var filter = ['in', ['get', 'SA3Code'], ['literal', codes]];
    ['sa3-fill', 'sa3-outline', 'sa3-outline-sel'].forEach(function(l) {
        if (map.getLayer(l)) { map.setFilter(l, filter); }
    });
}

// ── Wire into existing state changes ─────────────────────────

// Wrap selectSA3 — always re-render rail 50ms after selection
(function() {
    var _orig = selectSA3;
    selectSA3 = function(sa3Code) {
        _orig(sa3Code);
        setTimeout(renderRightRail, 50);
    };
})();

// Wrap closeDrawer — stay in chains-only mode when chains still active
(function() {
    var _orig = closeDrawer;
    closeDrawer = function() {
        if ((State.clinicChainFilter || []).length > 0) {
            State.currentSA3Code = null;
            if (typeof lastSelectedId !== 'undefined' && lastSelectedId !== null) {
                try { map.setFeatureState({ source: 'sa3', id: lastSelectedId }, { selected: false }); } catch(e) {}
                lastSelectedId = null;
            }
            renderRightRail();
            return;
        }
        _orig();
    };
})();

// Re-render when chain filter changes
document.addEventListener('chainFilterChanged', function() {
    setTimeout(renderRightRail, 20);
});
