# Adding a New Market to the GP Clinic Map

This guide explains how to add a new market (e.g., Dental, Specialists, Aged Care) to the application.

## Quick Start

1. **Add market definition to schema:**
   - Edit `data/market-schema.json`
   - Add your market with field mappings

2. **Prepare data:**
   ```bash
   python3 scripts/prepare_market_data.py <market_name>
   ```

3. **Done!** The app automatically supports the new market.

## Detailed Steps

### Step 1: Update `data/market-schema.json`

```json
{
  "markets": {
    "your_market": {
      "name": "Market Name",
      "csv_file": "markets/your_market/your_market_clinics.csv",
      "canonical_fields": {
        "id": "IDColumn",
        "name": "NameColumn",
        "latitude": "LatColumn",
        "longitude": "LonColumn",
        "ownership": "OwnershipColumn",
        "format": "FormatColumn",
        "sa3_code": "sa3_code",
        "sa3_name": "sa3_name",
        "suburb": "CityColumn",
        "state_code": "StateColumn",
        "address": "AddressColumn"
      },
      "has_gp_data": false,
      "has_ownership_data": true,
      "features": ["ownership"]
    }
  }
}
```

### Step 2: Place Your CSV

```bash
mkdir -p data/markets/your_market
# Place your_market_clinics.csv in this directory
```

### Step 3: Run Data Preparation

```bash
python3 scripts/prepare_market_data.py your_market
```

This automatically:
- Maps clinics to SA3 regions (if missing)
- Generates `market_config.json`
- Validates CSV format

### Step 4 (Optional): Generate Isochrones

```bash
python3 scripts/fetch_isochrones.py your_market data/markets/your_market/your_market_clinics.csv
```

That's it! The market is ready to use.

## Field Mappings Explained

`canonical_fields` maps app-wide field names to your CSV columns:

| Canonical | Purpose | Required? | Notes |
|-----------|---------|-----------|-------|
| `id` | Unique clinic ID | Yes | Used for isochrone filenames |
| `name` | Clinic/facility name | Yes | Displayed in UI |
| `latitude` | Clinic latitude | Yes | Used for mapping |
| `longitude` | Clinic longitude | Yes | Used for mapping |
| `sa3_code` | SA3 region code | No | Auto-generated if missing |
| `sa3_name` | SA3 region name | No | Auto-generated if missing |
| `ownership` | Corporate/Independent/NGO | No | Set to `null` if not applicable |
| `format` | Facility format (Big-box/Small) | No | Set to `null` if not applicable |
| `suburb` | City or suburb name | No | Used in location display |
| `state_code` | State abbreviation | No | Used in location display |
| `address` | Full address | No | Displayed in clinic details |

Set any field to `null` if it doesn't exist in your data. The app will use sensible defaults.

## Using Data in the App

Don't hardcode field names. Use helpers instead:

```javascript
// ❌ Won't work for all markets
const location = clinic.suburb;

// ✓ Works for all markets  
const location = getClinicLocation(clinic);

// Check if market supports features
if (hasMarketData('gp_data')) {
  const gpCount = getClinicGPCount(clinic);
}
```

Available helpers in `src/js/market-config-helper.js`:
- `getClinicLocation(clinic)`
- `getClinicStateCode(clinic)`
- `getClinicAddress(clinic)`
- `getClinicOwnership(clinic)`
- `getClinicGPCount(clinic)`
- `hasMarketData(fieldName)`

## Example: Adding Dental Market

**data/market-schema.json:**
```json
"dental": {
  "name": "Dental",
  "csv_file": "markets/dental/dental_clinics.csv",
  "canonical_fields": {
    "id": "DentalID",
    "name": "DentalClinicName",
    "latitude": "Latitude",
    "longitude": "Longitude",
    "ownership": "ClinicType",
    "format": "ClinicSize",
    "sa3_code": "sa3_code",
    "sa3_name": "sa3_name",
    "suburb": "Suburb",
    "state_code": "State",
    "address": "Address"
  },
  "has_gp_data": false,
  "has_ownership_data": true,
  "features": ["ownership", "format"]
}
```

**Then run:**
```bash
python3 scripts/prepare_market_data.py dental
python3 scripts/fetch_isochrones.py dental data/markets/dental/dental_clinics.csv
```

Done!
