#!/usr/bin/env python3
"""
Test and validate keyword extraction patterns before running full scraper.
Tests format, billing, and ownership signal extraction on sample website text.
"""

import re
from collections import defaultdict

# ============================================================
# Keyword extraction functions (mirrors scrape_clinics_full.py)
# ============================================================

def extract_billing_keywords(text: str) -> dict:
    """Extract billing model signals."""
    billing_signals = defaultdict(int)

    # Bulk billing signals — be specific about context
    if re.search(r'\bbulk[\s-]?billing\b', text, re.IGNORECASE):
        billing_signals['bulk_billing'] += 2
    if re.search(r'\b100%\s*bulk[\s-]?billing\b', text, re.IGNORECASE):
        billing_signals['bulk_billing'] += 1
    if re.search(r'\bno\s*(out.?of.?pocket|gap)\b', text, re.IGNORECASE):
        billing_signals['bulk_billing'] += 1
    if re.search(r'\bgap.?free\b', text, re.IGNORECASE):
        billing_signals['bulk_billing'] += 1

    # Private billing signals — exclude "private practice" format signal
    if re.search(r'\bfee[\s-]?for[\s-]?service\b', text, re.IGNORECASE):
        billing_signals['private'] += 2
    if re.search(r'\bprivate\s*fees?\b', text, re.IGNORECASE):
        billing_signals['private'] += 1
    if re.search(r'\bprivate\s+billing\b', text, re.IGNORECASE):
        billing_signals['private'] += 2

    # Mixed billing signals
    if re.search(r'\b(both|accept|offer).*?(bulk|private).*?(bulk|private)', text, re.IGNORECASE):
        billing_signals['mixed'] += 1
    if re.search(r'\bmixed[\s-]?billing\b', text, re.IGNORECASE):
        billing_signals['mixed'] += 2

    return dict(billing_signals)


def extract_format_keywords(text: str) -> dict:
    """Extract format signals."""
    format_signals = defaultdict(int)

    # Big-box signals: multi-location, chain, network, corporate structure
    if re.search(r'\b(multi[\s-]?clinic|multi[\s-]?provider|clinic\s+chain|network|group\s+practice)\b', text, re.IGNORECASE):
        format_signals['big_box'] += 2
    if re.search(r'\bmedical\s*(centre|center|hub|group)\b', text, re.IGNORECASE):
        format_signals['big_box'] += 1
    if re.search(r'\b(multiple\s+locations?|branch|franchise|locations?\s+across|across.*locations?)\b', text, re.IGNORECASE):
        format_signals['big_box'] += 2

    # Small practice signals — independent, neighbourhood, family
    if re.search(r'\b(family\s+(clinic|doctor|medicine|practice))\b', text, re.IGNORECASE):
        format_signals['small'] += 1
    if re.search(r'\b(neighbourhood|local\s+gp|independent\s+practice|sole\s+trader|independent[\s-]?run)\b', text, re.IGNORECASE):
        format_signals['small'] += 1

    return dict(format_signals)


def extract_ownership_keywords(text: str) -> dict:
    """Extract ownership signals."""
    ownership_signals = defaultdict(int)

    # Corporate brands — major GP operators in Australia
    corporate_brands = [
        'MyHealth', 'Healius', 'Sonic', 'IPN', 'Eastbrooke', 'ForHealth',
        'Primary Care', 'Medicore', 'Tristar', 'Affiliated Doctors', 'Pulse',
        'ProMedico', 'Doctors Lounge', 'Healthpoint'
    ]

    for brand in corporate_brands:
        if re.search(rf'\b{brand}\b', text, re.IGNORECASE):
            ownership_signals['corporate'] += 1

    # Corporate structure indicators — Pty Ltd, Limited company
    if re.search(r'\b(pty[\s.]?ltd|pty[\s.]?limited|proprietary\s+limited)\b', text, re.IGNORECASE):
        ownership_signals['corporate'] += 1

    # Network/group affiliation language
    if re.search(r'\b(part of|affiliate|network of|group of|member of)\s+', text, re.IGNORECASE):
        # Count only if followed by a known corporate brand or "practice"
        if re.search(r'\b(?:part of|affiliate|network of|group of|member of)\s+(?:' + '|'.join(corporate_brands) + r')\b', text, re.IGNORECASE):
            ownership_signals['corporate'] += 1

    return dict(ownership_signals)


# ============================================================
# Test cases
# ============================================================

TEST_CASES = [
    {
        'name': 'Big-box clinic network',
        'text': '''
            MyHealth Medical Centre Group
            We operate multiple locations across NSW, Victoria, and Queensland.
            Our network includes 50+ affiliated clinics offering bulk billing and private services.
            We are a corporate-owned medical group with specialist services at major hubs.
        ''',
        'expected': {
            'billing': {'bulk_billing': 2},
            'format': {'big_box': 3},
            'ownership': {'corporate': 1}
        }
    },
    {
        'name': 'Small independent practice',
        'text': '''
            Smith Family Medical Practice
            A friendly neighbourhood clinic run by Dr. Sarah Smith and Dr. John Brown.
            We provide bulk billing services to eligible patients and also accept private fees.
            Independent practice located in Parramatta since 1995.
        ''',
        'expected': {
            'billing': {'bulk_billing': 2, 'mixed': 1},
            'format': {'small': 2},
            'ownership': {}
        }
    },
    {
        'name': 'Private practice clinic',
        'text': '''
            Premium Medical Centre
            A private practice clinic specialising in comprehensive health services.
            We operate on a fee-for-service model with no gap fees for private patients.
            Premium clinics are independently owned and managed.
        ''',
        'expected': {
            'billing': {'private': 3},
            'format': {},
            'ownership': {}
        }
    },
    {
        'name': 'Healius affiliated practice',
        'text': '''
            Bondi Medical Centre
            Part of the Healius network of medical practices.
            We provide both bulk billing and private fee services across our clinic locations.
            As a Healius clinic, we benefit from shared resources and expertise.
        ''',
        'expected': {
            'billing': {'bulk_billing': 2, 'mixed': 1},
            'format': {'big_box': 2},
            'ownership': {'corporate': 1}
        }
    },
    {
        'name': 'Bulk billing clinic',
        'text': '''
            Westside Bulk Billing Clinic
            100% bulk billing for all patients. No out-of-pocket fees.
            Gap-free services with Medicare rebates.
            Our mission is accessible healthcare for all families.
        ''',
        'expected': {
            'billing': {'bulk_billing': 3},
            'format': {},
            'ownership': {}
        }
    },
    {
        'name': 'Multi-location franchise',
        'text': '''
            QuickCare Medical Clinics
            We operate franchise locations in over 30 suburbs across Sydney and Melbourne.
            Each QuickCare clinic offers bulk billing services and accepts private insurance.
            Our multi-clinic network provides consistency and quality care.
        ''',
        'expected': {
            'billing': {'bulk_billing': 2, 'mixed': 1},
            'format': {'big_box': 2},
            'ownership': {}
        }
    },
    {
        'name': 'IPN affiliated clinic',
        'text': '''
            City Medical Practice
            Affiliated with IPN (Independent Primary Networks).
            We are part of Australia's largest network of independent medical practices.
            Offering both bulk and private billing options to our patients.
        ''',
        'expected': {
            'billing': {'bulk_billing': 2, 'mixed': 1},
            'format': {'big_box': 2},
            'ownership': {'corporate': 1}
        }
    }
]


def test_extractor(func, test_cases, signal_name):
    """Test extraction function against test cases."""
    print(f"\n{'='*70}")
    print(f"Testing {signal_name.upper()}")
    print(f"{'='*70}")

    passed = 0
    failed = 0

    for test_case in test_cases:
        result = func(test_case['text'])
        expected = test_case['expected'][signal_name]

        # Compare results
        match = result == expected
        status = "✓ PASS" if match else "✗ FAIL"
        print(f"\n{status} · {test_case['name']}")

        if not match:
            failed += 1
            print(f"  Expected: {expected}")
            print(f"  Got:      {result}")
        else:
            passed += 1

    print(f"\n{'-'*70}")
    print(f"Results: {passed} passed, {failed} failed")
    return passed, failed


def main():
    print(f"\n{'='*70}")
    print("KEYWORD EXTRACTION VALIDATION")
    print(f"{'='*70}")
    print("Testing extraction patterns on realistic clinic website text samples")

    total_passed = 0
    total_failed = 0

    # Test each extractor
    p, f = test_extractor(extract_billing_keywords, TEST_CASES, 'billing')
    total_passed += p
    total_failed += f

    p, f = test_extractor(extract_format_keywords, TEST_CASES, 'format')
    total_passed += p
    total_failed += f

    p, f = test_extractor(extract_ownership_keywords, TEST_CASES, 'ownership')
    total_passed += p
    total_failed += f

    # Final summary
    print(f"\n{'='*70}")
    print(f"OVERALL: {total_passed} passed, {total_failed} failed")
    print(f"{'='*70}\n")

    if total_failed == 0:
        print("✅ All tests passed! Extractors are ready for production.")
    else:
        print(f"⚠️  {total_failed} tests failed. Review patterns above.")

    return 0 if total_failed == 0 else 1


if __name__ == "__main__":
    exit(main())
