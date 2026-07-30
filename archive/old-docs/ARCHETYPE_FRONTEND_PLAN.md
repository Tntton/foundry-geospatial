# Archetype Frontend Integration Plan

## Overview
Integrate clinic-level archetype classifications (Format, Billing Model, Ownership) + confidence levels into the map view and league table. Supports filtering by archetype and displays confidence as visual indicators.

---

## 1. Data Integration

### Input: enriched_clinics.csv
```
OBJECTID, ORGANISATION_NAME, SUBURB, STATE, ...existing cols...,
Format, Format_Confidence,
Billing_Model, Billing_Confidence,
Ownership, Ownership_Confidence
```

### Values
- **Format**: Big-box, Mid-format, Small, Unclassified
- **Billing_Model**: Bulk, Mixed, Private, Unclassified
- **Ownership**: Corporate, Independent, Unclassified
- **Confidence**: high, medium, low

### Load Strategy
- Merge enriched_clinics.csv into clinic locations feature layer on app startup
- Index by OBJECTID for O(1) lookup during filtering/rendering

---

## 2. Map View Changes

### Left Rail: Add Archetype Filter Section
**After Remoteness filter, before Workforce section**

```html
<div class="rail-section" id="archetype-section">
    <div class="rail-eyebrow">Clinic Archetypes</div>
    
    <!-- Format filter -->
    <label class="field-label">Format</label>
    <div class="archetype-chip-grid">
        <label class="archetype-chip-label">
            <input type="checkbox" class="archetype-chip" data-type="format" value="Big-box" />
            <span>Big-box</span>
        </label>
        <label class="archetype-chip-label">
            <input type="checkbox" class="archetype-chip" data-type="format" value="Mid-format" />
            <span>Mid-format</span>
        </label>
        <label class="archetype-chip-label">
            <input type="checkbox" class="archetype-chip" data-type="format" value="Small" />
            <span>Small</span>
        </label>
    </div>
    
    <!-- Billing filter -->
    <label class="field-label" style="margin-top:12px">Billing Model</label>
    <div class="archetype-chip-grid">
        <label class="archetype-chip-label">
            <input type="checkbox" class="archetype-chip" data-type="billing" value="Bulk" />
            <span>Bulk</span>
        </label>
        <label class="archetype-chip-label">
            <input type="checkbox" class="archetype-chip" data-type="billing" value="Mixed" />
            <span>Mixed</span>
        </label>
        <label class="archetype-chip-label">
            <input type="checkbox" class="archetype-chip" data-type="billing" value="Private" />
            <span>Private</span>
        </label>
    </div>
    
    <!-- Ownership filter -->
    <label class="field-label" style="margin-top:12px">Ownership</label>
    <div class="archetype-chip-grid">
        <label class="archetype-chip-label">
            <input type="checkbox" class="archetype-chip" data-type="ownership" value="Corporate" />
            <span>Corporate</span>
        </label>
        <label class="archetype-chip-label">
            <input type="checkbox" class="archetype-chip" data-type="ownership" value="Independent" />
            <span>Independent</span>
        </label>
    </div>
    
    <!-- Confidence filter -->
    <label class="field-label" style="margin-top:12px">Confidence level</label>
    <div style="display:flex;gap:4px;font-size:12px">
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" id="conf-high" value="high" checked />
            <span style="display:inline-block;width:8px;height:8px;background:#1b5e20;border-radius:2px"></span>
            <span>High</span>
        </label>
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" id="conf-medium" value="medium" checked />
            <span style="display:inline-block;width:8px;height:8px;background:#f57c00;border-radius:2px"></span>
            <span>Medium</span>
        </label>
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" id="conf-low" value="low" checked />
            <span style="display:inline-block;width:8px;height:8px;background:#c00000;border-radius:2px"></span>
            <span>Low</span>
        </label>
    </div>
    
    <div class="mmm-hint" style="margin-top:8px">
        High = website data · Medium = keywords · Low = SA3 fallback
    </div>
</div>
```

### Clinic Marker Styling
Update clinic marker color / icon to reflect archetype:
- **Format**: Marker size or inner dot (Big-box = larger, Small = smaller)
- **Billing**: Marker hue (Bulk = green, Mixed = blue, Private = red)
- **Confidence**: Marker opacity or outline stroke (high = solid, medium = 70%, low = 50%)

**Example marker:**
```
SVG circle with:
- radius = format_size (Big-box: 10px, Mid-format: 8px, Small: 6px)
- fill = billing_color (Bulk: #1b5e20, Mixed: #1976d2, Private: #c00000)
- opacity = confidence_opacity (high: 1, medium: 0.7, low: 0.5)
```

### Clinic Click Drawer
Add archetype section to detail drawer (when user clicks a clinic):
```html
<div class="drawer-archetype">
    <h3>Archetype Classification</h3>
    <div class="archetype-grid">
        <div class="archetype-item">
            <div class="archetype-label">Format</div>
            <div class="archetype-value">Big-box</div>
            <div class="confidence-badge confidence-high">High confidence</div>
        </div>
        <div class="archetype-item">
            <div class="archetype-label">Billing</div>
            <div class="archetype-value">Bulk</div>
            <div class="confidence-badge confidence-medium">Medium confidence</div>
        </div>
        <div class="archetype-item">
            <div class="archetype-label">Ownership</div>
            <div class="archetype-value">Corporate</div>
            <div class="confidence-badge confidence-high">High confidence</div>
        </div>
    </div>
</div>
```

---

## 3. Rankings (League Table) Changes

### New Columns
Add three columns after "Acquirable*" column:

```html
<th class="sortable" data-key="format">Format</th>
<th class="sortable" data-key="billing">Billing Model</th>
<th class="sortable" data-key="ownership">Ownership</th>
```

### Row Data
For each clinic row (if showing clinic-level rows) or clinic count aggregation by archetype:
```html
<td class="format-cell format-big-box">Big-box</td>
<td class="billing-cell billing-bulk">Bulk</td>
<td class="ownership-cell ownership-corporate">Corporate</td>
```

**With confidence badges:**
```html
<td class="format-cell">
    Big-box
    <span class="confidence-badge confidence-high" title="High confidence">✓</span>
</td>
```

### Confidence Badge Styling
```css
.confidence-badge {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-left: 4px;
    vertical-align: middle;
}
.confidence-badge.confidence-high {
    background: #1b5e20;
}
.confidence-badge.confidence-medium {
    background: #f57c00;
}
.confidence-badge.confidence-low {
    background: #c00000;
}
```

---

## 4. JavaScript Implementation

### Filtering Logic
```javascript
// Active archetype filters
const archetypeFilters = {
    format: new Set(),      // e.g., {'Big-box', 'Small'}
    billing: new Set(),     // e.g., {'Bulk', 'Private'}
    ownership: new Set(),   // e.g., {'Corporate'}
    confidence: new Set(['high', 'medium', 'low'])
};

// Filter a clinic by archetype
function matchesArchetypeFilter(clinic) {
    if (archetypeFilters.format.size > 0 && !archetypeFilters.format.has(clinic.Format)) return false;
    if (archetypeFilters.billing.size > 0 && !archetypeFilters.billing.has(clinic.Billing_Model)) return false;
    if (archetypeFilters.ownership.size > 0 && !archetypeFilters.ownership.has(clinic.Ownership)) return false;
    if (!archetypeFilters.confidence.has(clinic.Format_Confidence)) return false;
    if (!archetypeFilters.confidence.has(clinic.Billing_Confidence)) return false;
    if (!archetypeFilters.confidence.has(clinic.Ownership_Confidence)) return false;
    return true;
}

// Update map layer visibility
function updateArchetypeFilter() {
    const visibleClinics = clinicsData.filter(matchesArchetypeFilter);
    map.setFilter('clinic-locations', ['in', ['get', 'OBJECTID'], ['literal', visibleClinics.map(c => c.OBJECTID)]]);
}
```

### Event Handlers
```javascript
// Format/Billing/Ownership checkboxes
document.querySelectorAll('.archetype-chip').forEach(input => {
    input.addEventListener('change', (e) => {
        const type = e.target.dataset.type;  // 'format', 'billing', 'ownership'
        const value = e.target.value;
        
        if (e.target.checked) {
            archetypeFilters[type].add(value);
        } else {
            archetypeFilters[type].delete(value);
        }
        updateArchetypeFilter();
    });
});

// Confidence checkboxes
document.querySelectorAll('#conf-high, #conf-medium, #conf-low').forEach(input => {
    input.addEventListener('change', (e) => {
        if (e.target.checked) {
            archetypeFilters.confidence.add(e.target.value);
        } else {
            archetypeFilters.confidence.delete(e.target.value);
        }
        updateArchetypeFilter();
    });
});
```

### Marker Styling
```javascript
function getMarkerStyle(clinic) {
    const formatSize = {
        'Big-box': 10,
        'Mid-format': 8,
        'Small': 6,
        'Unclassified': 7
    };
    
    const billingColor = {
        'Bulk': '#1b5e20',
        'Mixed': '#1976d2',
        'Private': '#c00000',
        'Unclassified': '#999'
    };
    
    const confidenceOpacity = {
        'high': 1,
        'medium': 0.7,
        'low': 0.5
    };
    
    // Use Format_Confidence as primary opacity source
    const opacity = confidenceOpacity[clinic.Format_Confidence];
    
    return {
        radius: formatSize[clinic.Format],
        fill: billingColor[clinic.Billing_Model],
        opacity: opacity,
        stroke: opacity === 1 ? '#000' : '#666',
        strokeWidth: opacity === 1 ? 1.5 : 1
    };
}
```

### Rankings Table Integration
```javascript
// Add archetype columns to table rows
function buildClinicRow(clinic, index) {
    return `
        <tr>
            ...existing cells...
            <td class="format-cell format-${clinic.Format.toLowerCase().replace(' ', '-')}">
                ${clinic.Format}
                <span class="confidence-badge confidence-${clinic.Format_Confidence}"></span>
            </td>
            <td class="billing-cell billing-${clinic.Billing_Model.toLowerCase()}">
                ${clinic.Billing_Model}
                <span class="confidence-badge confidence-${clinic.Billing_Confidence}"></span>
            </td>
            <td class="ownership-cell ownership-${clinic.Ownership.toLowerCase()}">
                ${clinic.Ownership}
                <span class="confidence-badge confidence-${clinic.Ownership_Confidence}"></span>
            </td>
        </tr>
    `;
}
```

---

## 5. CSS Additions

```css
/* Archetype filter chips */
.archetype-chip-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
}

.archetype-chip-label {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border: 1px solid var(--hairline);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    user-select: none;
}

.archetype-chip-label input:checked + span {
    font-weight: 600;
    color: var(--text-darker);
}

/* Confidence indicators */
.confidence-badge {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-left: 4px;
    vertical-align: middle;
}

.confidence-high { background: #1b5e20; }
.confidence-medium { background: #f57c00; }
.confidence-low { background: #c00000; }

/* Drawer archetype section */
.drawer-archetype {
    padding: 12px 0;
    border-top: 1px solid var(--hairline);
    margin-top: 12px;
}

.drawer-archetype h3 {
    font-size: 12px;
    text-transform: uppercase;
    color: var(--text-soft);
    margin-bottom: 8px;
}

.archetype-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 10px;
}

.archetype-item {
    padding: 8px;
    background: var(--sage-wash);
    border-radius: 4px;
}

.archetype-label {
    font-size: 10px;
    color: var(--text-soft);
    text-transform: uppercase;
    margin-bottom: 4px;
}

.archetype-value {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-darker);
    margin-bottom: 4px;
}

/* Table cell styling */
.format-cell, .billing-cell, .ownership-cell {
    font-size: 12px;
}

.format-big-box::before { content: '◆'; margin-right: 4px; }
.format-mid-format::before { content: '◆'; margin-right: 4px; }
.format-small::before { content: '◆'; margin-right: 4px; }

.billing-bulk { color: #1b5e20; font-weight: 500; }
.billing-mixed { color: #1976d2; font-weight: 500; }
.billing-private { color: #c00000; font-weight: 500; }
```

---

## 6. Testing Checklist

- [ ] Archetype filter chips appear in left rail
- [ ] Selecting Format filters markers correctly
- [ ] Selecting Billing filters markers correctly
- [ ] Selecting Ownership filters markers correctly
- [ ] Confidence level filtering hides low/medium markers
- [ ] Marker opacity reflects confidence (high = solid, medium = 70%, low = 50%)
- [ ] Clicking a clinic shows archetype in detail drawer
- [ ] Rankings table shows archetype columns
- [ ] Rankings table can sort by Format, Billing, Ownership
- [ ] Confidence badges display with correct colors
- [ ] Filters persist when switching between map views
- [ ] Mobile view: archetype filters in FAB controls

---

## 7. Implementation Order

1. **Add HTML** (filter section + table columns + drawer section)
2. **Add CSS** (chips, badges, table cell styling)
3. **Load enriched_clinics.csv** (merge into clinic locations on startup)
4. **Implement filtering logic** (matchesArchetypeFilter function)
5. **Wire up checkbox handlers** (updateArchetypeFilter)
6. **Update marker rendering** (style by Format/Billing/Confidence)
7. **Populate rankings table** (add columns, sort handlers)
8. **Test and refine** (visual polish, responsive tweaks)

---

## 8. Future Enhancements

- Add SA3-level archetype aggregation view (% Big-box, % Bulk billing, etc.)
- Export filtered clinic list with archetype classifications
- Archetype + Tier cross-tabulation (e.g., "How many Tier 1 Big-box clinics?")
- Confidence-level explanatory tooltips in detail drawer
