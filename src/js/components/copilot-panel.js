// Persistent assistant chat panel — replaces the old ⌘K Spotlight overlay/
// checklist/banner cluster and absorbs the per-clinic/per-region "ask a
// follow-up" threads (formerly regionReadAskFreeform/acqReadAskFreeform)
// into one global, multi-turn conversation. See the plan file for full
// context on why.
//
// Loaded as a plain (non-module) <script> after app.js, same convention as
// targets-tab.js's `TP` object — this file's `Copilot` object references
// State/map/switchMarket/etc. as bare globals, and app.js's inline
// onclick="..." handlers (and this file's own generated onclick markup)
// reference `Copilot` back the same way. Neither attaches to `window`
// deliberately; classic <script> top-level const/let/function
// declarations already share one global lexical scope across every
// <script> tag on the page (confirmed by this codebase's own existing
// State/TP pattern), so no window.* export is needed here either.
//
// Backend contract (api/assistant.js): POST { messages: [{role,text}],
// currentState } -> { answer: '<safe html, deep-link tokens already
// resolved to onclick="Copilot.followLink(...)" buttons>', plan: null |
// { status: 'applied'|'partial', steps: [{tool,args}], skipped: [] } }.
// `plan` mirrors the old copilot.js intent's applied/partial vocabulary,
// just derived from real per-tool-call validation outcomes instead of a
// self-reported status field, and always executed client-side via the
// same existing setter functions the old applyCopilotIntent() used —
// mutation tools never touch live state server-side, only ever propose a
// step for THIS file to execute deterministically.

const Copilot = {
    messages: [], // flat, unbounded for the session -- replaces both _copilotHistory and the old per-entity .thread arrays
    _sending: false,
    _seq: 0,
    _suggested: []
};

function copilotEscapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function copilotNewId() {
    return 'm_' + (++Copilot._seq);
}

// ============================================================
// Panel open/close
// ============================================================
Copilot.open = function (seedText) {
    document.body.classList.add('copilot-panel-open');
    document.getElementById('copilot-panel')?.classList.add('active');
    if (typeof isMobile === 'function' && isMobile()) {
        // Only one bottom sheet is meant to be visible at a time on mobile --
        // mirrors openDrawerForSA3()'s existing handling for the detail drawer.
        document.getElementById('detail-drawer')?.classList.remove('active');
        const rail = document.getElementById('map-rail');
        if (rail) {
            rail.classList.remove('open', 'snap-full', 'snap-expanded');
            rail.classList.add('snap-hidden');
            rail.style.transform = '';
            rail.style.display = 'none';
        }
    }
    if (seedText) {
        Copilot.send(seedText);
    } else {
        Copilot.renderMessages();
        document.getElementById('copilot-input')?.focus();
    }
};

Copilot.close = function () {
    document.body.classList.remove('copilot-panel-open');
    document.getElementById('copilot-panel')?.classList.remove('active');
};

Copilot.toggle = function () {
    if (document.getElementById('copilot-panel')?.classList.contains('active')) Copilot.close();
    else Copilot.open();
};

// Called from the region/clinic read panel's "Ask about this region in Ask
// Foundry →" redirect (see buildRegionReadHTML/buildAcquisitionReadHTML in
// app.js) -- currentFocus() below picks up the open drawer automatically,
// so there's nothing extra to pre-seed here.
Copilot.openForCurrentContext = function () {
    Copilot.open();
};

Copilot.newConversation = function () {
    Copilot.messages = [];
    Copilot.renderMessages();
};

Copilot.handleComposerKeydown = function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        Copilot.send();
    }
};

// ============================================================
// "What's currently focused" — closes the gap the old copilot never
// needed to read (it only ever set state). Region and clinic content
// share one drawer DOM shell, so State.currentClinicId (set by
// renderClinicDrawer, cleared by renderDrawer/closeDrawer -- see their own
// comments in app.js) is the only reliable way to tell which kind is
// currently showing.
// ============================================================
function copilotCurrentFocus() {
    if (State.currentClinicId) {
        const c = State.clinicsData.find((c) => String(c.clinic_id) === String(State.currentClinicId));
        if (c) return { type: 'clinic', id: c.clinic_id, label: c.clinic_name || c.name || 'this clinic' };
    }
    if (State.currentSA3Code) {
        const f = State.sa3Data?.features.find((f) => f.properties.SA3Code === State.currentSA3Code);
        if (f) return { type: 'region', id: f.properties.SA3Code, label: f.properties.SA3Name };
    }
    return null;
}

function copilotSuggestedPromptsFor(focus) {
    if (!focus) return [];
    const st = focus.type === 'region' ? State.regionReads[focus.id] : State.acquisitionReads[focus.id];
    return st?.result?.chips || [];
}

// buildCopilotStateSummary() is kept, verbatim, from the old copilot
// cluster in app.js -- still the right compact "what's currently applied"
// snapshot. Extended here with the three fields the old single-shot
// copilot never needed because it only ever set state, never read it:
// focus, mapSubtab, catalogueOpen.
function copilotBuildStateSummary() {
    const base = buildCopilotStateSummary();
    const subtabBtn = document.querySelector('.map-subtab.active');
    return {
        ...base,
        focus: copilotCurrentFocus(),
        mapSubtab: subtabBtn ? subtabBtn.dataset.subtab : 'map',
        catalogueOpen: !document.getElementById('catalogue-modal-backdrop')?.classList.contains('hidden')
            ? catalogueActiveCategory
            : null
    };
}

// ============================================================
// Sending a message
// ============================================================
Copilot.send = async function (prefilledText) {
    if (Copilot._sending) return;
    const input = document.getElementById('copilot-input');
    const text = (prefilledText != null ? prefilledText : (input?.value || '')).trim();
    if (!text) return;
    if (input && prefilledText == null) { input.value = ''; }

    const focus = copilotCurrentFocus();
    Copilot.messages.push({ id: copilotNewId(), role: 'user', text, contextSnapshot: focus, time: Date.now() });
    const pendingId = copilotNewId();
    Copilot.messages.push({ id: pendingId, role: 'assistant', text: '', pending: true, time: Date.now() });
    Copilot.renderMessages();

    Copilot._sending = true;
    const sendBtn = document.getElementById('copilot-send-btn');
    if (sendBtn) sendBtn.disabled = true;

    try {
        const res = await fetch('/api/assistant', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                messages: Copilot.messages.filter((m) => !m.pending).map((m) => ({ role: m.role, text: m.text })),
                currentState: copilotBuildStateSummary()
            })
        });
        const data = await res.json().catch(() => ({}));
        const msg = Copilot.messages.find((m) => m.id === pendingId);
        if (!msg) return;

        if (!res.ok || !data.answer) {
            msg.text = `<p>${copilotEscapeHtml(data.error || "Couldn't reach the assistant just now — try again.")}</p>`;
            msg.pending = false;
            Copilot.renderMessages();
            return;
        }

        msg.text = data.answer;
        msg.pending = false;

        if (data.plan) {
            const { cameraHeld } = await Copilot.executePlan(data.plan);
            msg.plan = { ...data.plan, cameraHeld };
            document.getElementById('copilot-reset-row')?.classList.remove('hidden');
        }
        Copilot.renderMessages();
    } catch (e) {
        const msg = Copilot.messages.find((m) => m.id === pendingId);
        if (msg) {
            msg.text = `<p>${copilotEscapeHtml("Couldn't reach the assistant just now — try again.")}</p>`;
            msg.pending = false;
        }
        Copilot.renderMessages();
    } finally {
        Copilot._sending = false;
        if (sendBtn) sendBtn.disabled = false;
    }
};

Copilot.askSuggested = function (i) {
    const c = Copilot._suggested?.[i];
    if (!c) return;
    Copilot.pushInstantAnswer(c.label, c.answer, copilotCurrentFocus());
};

// Pushes a canned, zero-network-call Q+A straight into the transcript --
// used both by the panel's own empty-state suggested chips (askSuggested,
// above) and by the region/clinic drawer's "Read" chip questions
// (regionReadAskChip/acqReadAskChip in app.js), which used to render into
// a local per-entity thread and now open this panel instead (absorbed per
// the plan -- one conversation, not per-entity mini-threads).
Copilot.pushInstantAnswer = function (question, answer, contextSnapshot) {
    Copilot.open();
    Copilot.messages.push({ id: copilotNewId(), role: 'user', text: question, contextSnapshot, time: Date.now() });
    Copilot.messages.push({
        id: copilotNewId(), role: 'assistant', text: `<p>${copilotEscapeHtml(answer)}</p>`,
        instant: true, time: Date.now()
    });
    Copilot.renderMessages();
};

// ============================================================
// Deep-link dispatch — a thin router onto EXISTING navigation entry
// points, never a new navigation mechanism. api/_lib/formatAnswer.js only
// ever emits a token for a kind/id this file already knows how to handle.
// ============================================================
Copilot.followLink = function (kind, id) {
    if (kind === 'region') {
        if (typeof searchGotoSA3 === 'function') searchGotoSA3(id);
    } else if (kind === 'clinic') {
        if (typeof searchGotoClinic === 'function') searchGotoClinic(id);
    } else if (kind === 'chain') {
        // The Targets chain dossier, not searchActivateChain() -- that
        // function's underlying UI checkbox (.clinic-chain-checkbox) no
        // longer exists (the Major Chains section was removed from Step 1
        // earlier this session; chain-level detail now lives here instead).
        if (typeof TP !== 'undefined') TP.focusChainRow(id);
    } else if (kind === 'tab') {
        if (typeof focusMapSubtab === 'function') focusMapSubtab(id);
    } else if (kind === 'catalogue') {
        if (typeof focusCatalogueItem === 'function') focusCatalogueItem(id);
    }
    if (typeof isMobile === 'function' && isMobile()) Copilot.close();
};

// ============================================================
// Executing a state-change plan — a direct port of the old
// applyCopilotIntent()/buildCopilotSteps()'s deterministic step-executor,
// just driven by an array of discrete {tool,args} calls (one per backend
// tool invocation) instead of one fixed intent object's field presence.
// Same reused helpers (copilotBbox/copilotBboxChangedMeaningfully/
// pulseRailSteps/resolveGazetteerRegion/resolveLowDensityThreshold), same
// "filters first, camera fit last, only re-fly if the view actually needs
// to move" sequencing.
// ============================================================
Copilot.executePlan = async function (plan) {
    const beforeFeatures = computeFilteredSA3Features().final;
    const beforeBbox = copilotBbox(beforeFeatures);
    const pulseSteps = new Set();
    let focusStep = null;

    for (const step of plan.steps) {
        switch (step.tool) {
            case 'set_scoring_market':
                if (step.args.market !== State.markets.current) {
                    await switchMarket(step.args.market);
                    pulseSteps.add('clinics');
                }
                break;
            case 'toggle_clinic_layer':
                await toggleClinicLayer(step.args.layer, step.args.on);
                pulseSteps.add('clinics');
                break;
            case 'set_geography_filter': {
                const { state, regionName, remoteness } = step.args;
                if (state && state !== State.currentState) {
                    State.currentState = state;
                    const sel = document.getElementById('state-filter');
                    if (sel) sel.value = state;
                }
                if (regionName) {
                    const resolved = await resolveGazetteerRegion(regionName);
                    if (resolved) State.regionFilter = resolved;
                }
                if (remoteness && remoteness.length) {
                    State.mmmFilter = remoteness;
                    document.querySelectorAll('.mmm-chip').forEach((cb) => {
                        const vals = cb.value.split(',').map(Number);
                        cb.checked = vals.some((v) => remoteness.includes(v));
                    });
                }
                pulseSteps.add('geo');
                pulseSteps.add('ground');
                break;
            }
            case 'load_catalogue_dataset':
                step.args.datasets.forEach((k) => { if (!State.catalogueLoaded[k]) catalogueStaged[k] = true; });
                loadDataCatalogueSelections();
                pulseSteps.add('ground');
                break;
            case 'set_ground_filter': {
                const gf = step.args;
                if (gf.tier?.length) State.tierFilter = gf.tier;
                if (gf.seifaDeciles?.length) {
                    State.seifaDeciles = gf.seifaDeciles;
                    State.catalogueFilterActive.seifa = true;
                    document.querySelectorAll('.seifa-chip').forEach((cb) => {
                        cb.checked = gf.seifaDeciles.includes(parseInt(cb.value, 10));
                    });
                }
                if (gf.workforceRiskMin != null) {
                    State.workforceRiskMin = gf.workforceRiskMin;
                    const slider = document.getElementById('workforce-risk-slider');
                    if (slider) slider.value = gf.workforceRiskMin;
                    const readout = document.getElementById('workforce-risk-readout');
                    if (readout) readout.textContent = gf.workforceRiskMin;
                }
                if (gf.dpaBonded != null) {
                    State.dpaFilter.bonded = gf.dpaBonded;
                    const el = document.getElementById('dpa-bonded'); if (el) el.checked = gf.dpaBonded;
                }
                if (gf.dpaGpImg != null) {
                    State.dpaFilter.gpImg = gf.dpaGpImg;
                    const el = document.getElementById('dpa-gp-img'); if (el) el.checked = gf.dpaGpImg;
                }
                if (gf.archetype) {
                    ['format', 'billing', 'ownership'].forEach((dim) => {
                        const vals = gf.archetype[dim];
                        if (vals && vals.length) {
                            State.archetypeFilter[dim] = vals;
                            document.querySelectorAll(`.archetype-chip[data-dim="${dim}"]`).forEach((cb) => {
                                cb.checked = vals.includes(cb.value);
                            });
                        }
                    });
                    applyArchetypeFilter();
                }
                if (gf.lowDensity) State.supplyScoreMin = resolveLowDensityThreshold(50);
                applyWorkforceFilters();
                applySeifaFilter();
                pulseSteps.add('ground');
                break;
            }
            case 'set_colour_by_lens':
                if (step.args.lens !== State.currentMapView) {
                    setMapView(step.args.lens);
                    saveLensState(step.args.lens);
                }
                pulseSteps.add('thesis');
                break;
            case 'focus_on_region':
                focusStep = { type: 'region', sa3Code: step.args.sa3Code };
                break;
            case 'focus_on_clinic':
                focusStep = { type: 'clinic', clinicId: step.args.clinicId };
                break;
        }
    }

    updateRailStats();
    updateFilterChips();
    renderFunnelSummaries();

    let cameraHeld = false;
    if (focusStep) {
        if (focusStep.type === 'region') {
            selectSA3(focusStep.sa3Code);
        } else {
            const match = State.clinicsData.find((c) => String(c.clinic_id) === String(focusStep.clinicId));
            if (match) selectClinic(match);
        }
    } else {
        const afterFeatures = computeFilteredSA3Features().final;
        const afterBbox = copilotBbox(afterFeatures);
        if (afterBbox && copilotBboxChangedMeaningfully(beforeBbox, afterBbox)) {
            map.fitBounds(afterBbox, { padding: 60, duration: 800, maxZoom: 10 });
        } else {
            cameraHeld = true;
        }
    }

    pulseRailSteps([...pulseSteps]);
    return { cameraHeld };
};

Copilot.resetAppliedState = function () {
    State.regionFilter = null;
    State.tierFilter = [];
    State.supplyScoreMin = null;
    applyWorkforceFilters();
    updateRailStats();
    updateFilterChips();
    document.getElementById('copilot-reset-row')?.classList.add('hidden');
};

// ============================================================
// Rendering
// ============================================================
function copilotDescribePlanStep(step) {
    switch (step.tool) {
        case 'set_scoring_market':
            return `Scoring market: ${COPILOT_MARKET_LABELS[step.args.market] || step.args.market}`;
        case 'toggle_clinic_layer':
            return `${step.args.on ? 'Added' : 'Removed'} ${COPILOT_MARKET_LABELS[step.args.layer] || step.args.layer} layer`;
        case 'set_geography_filter': {
            const parts = [];
            if (step.args.regionName) parts.push(step.args.regionName);
            else if (step.args.state) parts.push(step.args.state);
            if (step.args.remoteness?.length) parts.push(`MMM ${step.args.remoteness.join(',')}`);
            return parts.length ? `Geography: ${parts.join(' · ')}` : null;
        }
        case 'load_catalogue_dataset':
            return `Loaded: ${step.args.datasets.map((k) => COPILOT_CATALOGUE_LABELS[k] || k).join(', ')}`;
        case 'set_ground_filter': {
            const parts = [];
            if (step.args.tier?.length) parts.push(`Tier ${step.args.tier.slice().sort().join('–')}`);
            if (step.args.archetype?.ownership?.length) parts.push(step.args.archetype.ownership.join('/'));
            if (step.args.lowDensity) parts.push('Low competitive density');
            if (step.args.workforceRiskMin != null) parts.push(`Workforce risk ≥${step.args.workforceRiskMin}`);
            return parts.length ? `Filters: ${parts.join(' · ')}` : null;
        }
        case 'set_colour_by_lens':
            return `Colour by ${step.args.lens}`;
        case 'focus_on_region':
        case 'focus_on_clinic':
            return `Opened ${step.args.label}`;
        default:
            return null;
    }
}

function copilotRenderPlanCard(plan) {
    const badgeLabel = plan.status === 'partial' ? 'Partial' : 'Applied';
    const stepsHtml = plan.steps.map(copilotDescribePlanStep).filter(Boolean)
        .map((s) => `<div>${copilotEscapeHtml(s)}</div>`).join('');
    const skippedHtml = (plan.status === 'partial' && plan.skipped?.length)
        ? `<div class="cop-msg-plan-skipped">Skipped: ${copilotEscapeHtml(plan.skipped.join('; '))}</div>` : '';
    const cameraNote = plan.cameraHeld
        ? `<div class="cop-msg-plan-skipped">Camera held — same regions in frame.</div>` : '';
    return `
        <div class="cop-msg-plan cop-msg-plan-${plan.status}">
            <div class="cop-msg-plan-hdr"><span class="cop-msg-plan-badge">${badgeLabel}</span></div>
            <div class="cop-msg-plan-steps">${stepsHtml}</div>
            ${skippedHtml}${cameraNote}
        </div>
    `;
}

function copilotRenderOneMessage(m) {
    if (m.role === 'user') {
        const pill = m.contextSnapshot
            ? `<span class="cop-msg-context-pill">${copilotEscapeHtml(m.contextSnapshot.label)}</span>` : '';
        return `<div class="cop-msg cop-msg-user">${pill}<div class="cop-msg-bubble">${copilotEscapeHtml(m.text)}</div></div>`;
    }
    if (m.pending) {
        return `<div class="cop-msg cop-msg-assistant"><div class="cop-msg-thinking"><span class="rd-blink-dot"></span> Thinking…</div></div>`;
    }
    const planHtml = m.plan ? copilotRenderPlanCard(m.plan) : '';
    const metaHtml = m.instant ? '<div class="cop-msg-meta">Computed, not model-generated</div>' : '';
    return `<div class="cop-msg cop-msg-assistant"><div class="cop-msg-bubble">${m.text}${planHtml}</div>${metaHtml}</div>`;
}

Copilot.renderMessages = function () {
    const body = document.getElementById('copilot-messages');
    if (!body) return;

    if (!Copilot.messages.length) {
        const focus = copilotCurrentFocus();
        const chips = copilotSuggestedPromptsFor(focus);
        Copilot._suggested = chips;
        body.innerHTML = `
            <div class="cop-panel-empty">Ask about a region or a clinic, or tell it what to change — e.g. "tier 1 and 2 GP regions in South-East Queensland with independent ownership".</div>
            ${chips.length ? `<div class="cop-suggested-row">${chips.map((c, i) => `<button type="button" class="cop-suggested-chip" onclick="Copilot.askSuggested(${i})">${copilotEscapeHtml(c.label)}</button>`).join('')}</div>` : ''}
        `;
        return;
    }

    body.innerHTML = Copilot.messages.map(copilotRenderOneMessage).join('');
    body.scrollTop = body.scrollHeight;
};
