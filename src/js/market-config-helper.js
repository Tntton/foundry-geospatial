/**
 * Market Configuration Helper
 * 
 * Provides field-agnostic access to clinic data based on market schema.
 * Instead of hardcoding field names, use these helpers.
 */

let marketSchema = null;

/**
 * Load market schema
 */
async function loadMarketSchema() {
    if (marketSchema) return marketSchema;
    const response = await fetch('/data/market-schema.json');
    marketSchema = await response.json();
    return marketSchema;
}

/**
 * Get canonical field name for current market
 */
function getField(fieldName) {
    const market = State.markets.current || 'gp';
    if (!marketSchema?.markets?.[market]) return fieldName;
    return marketSchema.markets[market].canonical_fields[fieldName] || fieldName;
}

/**
 * Get clinic location (SA3 name > suburb > City)
 */
function getClinicLocation(clinic) {
    return clinic.sa3_name || clinic.suburb || clinic.City || 'Unknown Location';
}

/**
 * Check if market has specific data type
 */
function hasMarketData(fieldName) {
    const market = State.markets.current || 'gp';
    const marketDef = marketSchema?.markets?.[market];
    if (!marketDef) return false;
    
    if (fieldName === 'gp_data') return marketDef.has_gp_data;
    if (fieldName === 'ownership') return marketDef.has_ownership_data;
    
    return marketDef.features?.includes(fieldName) || false;
}

/**
 * Get state code/abbreviation for clinic
 */
function getClinicStateCode(clinic) {
    return clinic.state_code || clinic.State || '';
}

/**
 * Get clinic address
 */
function getClinicAddress(clinic) {
    return clinic.address || clinic.FullAddress || '';
}

/**
 * Get clinic website
 */
function getClinicWebsite(clinic) {
    return clinic.website || clinic.Website || '';
}

/**
 * Get clinic format (Big-box, Mid-format, Small, etc)
 */
function getClinicFormat(clinic) {
    return clinic.clinic_format || clinic.format || 'Unknown';
}

/**
 * Get clinic billing type
 */
function getClinicBilling(clinic) {
    return clinic['Billing Type'] || clinic.billing || 'Unknown';
}

/**
 * Get GP count for clinic (returns 0 for non-GP markets)
 */
function getClinicGPCount(clinic) {
    if (!hasMarketData('gp_data')) return 0;
    return clinic.gp_count || 0;
}

/**
 * Get clinic ownership
 */
function getClinicOwnership(clinic) {
    if (!hasMarketData('ownership')) return 'Unknown';
    return clinic.ownership || 'Unknown';
}
