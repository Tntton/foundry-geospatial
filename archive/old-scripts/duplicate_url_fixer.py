from flask import Flask, render_template_string, request, jsonify
import pandas as pd

app = Flask(__name__)

def load_db():
    return pd.read_csv('data/clinics/Master Sheet/comprehensive_clinic_database.csv')

def save_db(df):
    df.to_csv('data/clinics/Master Sheet/comprehensive_clinic_database.csv', index=False)

def get_duplicate_url_clinics():
    db = load_db()
    # Filter to only corporate clinics
    db = db[db['ownership'] == 'Corporate']
    # Find all URLs that appear more than once
    url_counts = db['website'].value_counts()
    dup_urls = url_counts[url_counts > 1].index.tolist()
    # Filter to only clinics with duplicate URLs
    dup_clinics = db[db['website'].isin(dup_urls)].copy()
    return dup_clinics

HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Duplicate URL Fixer</title>
    <style>
        body { font-family: Arial; margin: 20px; background: #f5f5f5; }
        .header { background: #2c3e50; color: white; padding: 20px; border-radius: 4px; margin-bottom: 20px; }
        .filters { background: white; padding: 15px; margin-bottom: 20px; border-radius: 4px; }
        select { padding: 8px; margin: 5px; border: 1px solid #bdc3c7; border-radius: 4px; }
        button { padding: 10px 15px; margin: 5px; cursor: pointer; background: #3498db; color: white; border: none; border-radius: 4px; font-weight: bold; }
        button:hover { background: #2980b9; }
        .save-btn { background: #27ae60; }
        .save-btn:hover { background: #229954; }
        table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        th { background: #34495e; color: white; padding: 12px; text-align: left; }
        td { padding: 12px; border-bottom: 1px solid #ecf0f1; }
        .url-header { background: #e67e22; color: white; padding: 12px; font-weight: bold; border-top: 3px solid #3498db; }
        .url-header a { color: white; text-decoration: underline; }
        .clinic-row { border-left: 4px solid #e67e22; background: #fff9e6; }
        .clinic-row:hover { background: #ffe6b3; }
        .clinic-row.marked-delete { background: #ffcccc; opacity: 0.7; }
        input.url-input { width: 100%; padding: 8px; border: 2px solid #3498db; border-radius: 4px; font-size: 13px; }
        input.url-input:focus { outline: none; border-color: #27ae60; background: #fffacd; }
        .delete-btn { background: #e74c3c; padding: 4px 8px; font-size: 11px; border: none; border-radius: 3px; color: white; cursor: pointer; }
        .delete-btn:hover { background: #c0392b; }
        .delete-btn.marked { background: #c0392b; }
        .url-display { color: #3498db; font-size: 12px; word-break: break-all; }
        .clinic-count { display: inline-block; background: #3498db; color: white; padding: 2px 8px; border-radius: 12px; margin-left: 10px; font-size: 12px; }
        .stats { background: #e67e22; color: white; padding: 15px; border-radius: 4px; margin-bottom: 20px; font-size: 18px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Duplicate URL Fixer</h1>
        <p>Fix clinics that are sharing the same URL</p>
    </div>

    <div class="stats" id="stats"></div>

    <div class="filters">
        <label>Filter by Chain:</label>
        <select id="chainFilter" onchange="filterTable()">
            <option value="">All Chains</option>
        </select>
        <button onclick="clearFilters()">Clear Filters</button>
        <button onclick="saveCsv()" class="save-btn">💾 Save All URL Changes</button>
    </div>

    <table id="dataTable">
        <thead>
            <tr>
                <th>Chain</th>
                <th>Clinic ID</th>
                <th>Clinic Name</th>
                <th>Address / Suburb</th>
                <th>Current URL (Shared)</th>
                <th>Enter Correct URL Here</th>
                <th>Action</th>
            </tr>
        </thead>
        <tbody id="tableBody"></tbody>
    </table>

    <script>
        let allData = [];
        let changes = {};
        let deletions = new Set();

        async function loadData() {
            console.log("Loading duplicate URL data...");
            const response = await fetch('/api/duplicates');
            allData = await response.json();

            console.log("Loaded " + allData.length + " clinics with duplicate URLs");

            // Populate chain filter
            const chains = [...new Set(allData.map(r => r['Corporate Chain']))].sort();
            const select = document.getElementById('chainFilter');
            chains.forEach(chain => {
                const option = document.createElement('option');
                option.value = chain;
                option.text = chain;
                select.appendChild(option);
            });

            updateStats();
            renderTable(allData);
        }

        function updateStats() {
            const numUrls = [...new Set(allData.map(r => r['website']))].length;
            const stats = document.getElementById('stats');
            stats.innerHTML = `<strong>${allData.length} clinics</strong> with <strong>${numUrls} duplicate URLs</strong>`;
        }

        function filterTable() {
            let filtered = allData;
            const chain = document.getElementById('chainFilter').value;
            if (chain) {
                filtered = filtered.filter(r => r['Corporate Chain'] === chain);
            }
            renderTable(filtered);
        }

        function renderTable(rows) {
            const tbody = document.getElementById('tableBody');
            tbody.innerHTML = '';

            // Group by URL
            const urlGroups = {};
            rows.forEach(row => {
                const url = row['website'] || '(empty)';
                if (!urlGroups[url]) {
                    urlGroups[url] = [];
                }
                urlGroups[url].push(row);
            });

            // Sort by count (most duplicated first)
            const sortedUrls = Object.keys(urlGroups).sort((a, b) => {
                return urlGroups[b].length - urlGroups[a].length;
            });

            sortedUrls.forEach(url => {
                const clinics = urlGroups[url];

                // URL group header
                const headerTr = document.createElement('tr');
                headerTr.className = 'url-header';
                headerTr.innerHTML = `
                    <td colspan="6">
                        ⚠️ <a href="${url}" target="_blank">${url === '(empty)' ? 'NO URL' : url}</a>
                        <span class="clinic-count">${clinics.length} clinics sharing this URL</span>
                    </td>
                `;
                tbody.appendChild(headerTr);

                // Clinics in this group
                clinics.forEach(clinic => {
                    const tr = document.createElement('tr');
                    tr.className = 'clinic-row';
                    tr.id = 'row_' + clinic['clinic_id'];

                    const addr = clinic['address'] || '';
                    const suburb = clinic['suburb'] || '';
                    const fullAddr = (addr.substring(0, 40) + (suburb ? ' (' + suburb + ')' : '')).substring(0, 60);

                    tr.innerHTML = `
                        <td>${clinic['Corporate Chain']}</td>
                        <td><strong>${clinic['clinic_id']}</strong></td>
                        <td>${clinic['clinic_name']}</td>
                        <td style="font-size: 11px;">${fullAddr}</td>
                        <td><div class="url-display">${url === '(empty)' ? '(no URL)' : url}</div></td>
                        <td><input type="text" class="url-input" id="url_${clinic['clinic_id']}" value="" placeholder="Enter new URL or leave blank" onchange="recordChange(${clinic['clinic_id']}, this.value)"></td>
                        <td><button class="delete-btn" id="del_${clinic['clinic_id']}" onclick="toggleDelete(${clinic['clinic_id']})">Delete Clinic</button></td>
                    `;
                    tbody.appendChild(tr);
                });
            });
        }

        function recordChange(clinicId, newUrl) {
            changes[clinicId] = newUrl;
            console.log("Recorded change for clinic " + clinicId + ": " + newUrl);
        }

        function toggleDelete(clinicId) {
            const btn = document.getElementById('del_' + clinicId);
            const row = document.getElementById('row_' + clinicId);

            if (deletions.has(clinicId)) {
                deletions.delete(clinicId);
                btn.classList.remove('marked');
                row.classList.remove('marked-delete');
            } else {
                deletions.add(clinicId);
                btn.classList.add('marked');
                row.classList.add('marked-delete');
            }
            console.log("Deletions: " + Array.from(deletions).join(", "));
        }

        function clearFilters() {
            document.getElementById('chainFilter').value = '';
            filterTable();
        }

        async function saveCsv() {
            const changedIds = Object.keys(changes);
            const deletedIds = Array.from(deletions);
            const totalChanges = changedIds.length + deletedIds.length;

            if (totalChanges === 0) {
                alert('No changes made');
                return;
            }

            const msg = (changedIds.length > 0 ? changedIds.length + ' URL change' + (changedIds.length > 1 ? 's' : '') : '') +
                       (changedIds.length > 0 && deletedIds.length > 0 ? ' + ' : '') +
                       (deletedIds.length > 0 ? deletedIds.length + ' clinic' + (deletedIds.length > 1 ? 's' : '') + ' to delete' : '');

            if (!confirm('Save ' + msg + ' to database?')) return;

            const response = await fetch('/api/update-urls', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    changes: changes,
                    deletions: deletedIds
                })
            });

            if (response.ok) {
                alert('✓ Changes saved!' + (deletedIds.length > 0 ? ' (' + deletedIds.length + ' clinics deleted)' : ''));
                changes = {};
                deletions.clear();
                loadData();
            } else {
                alert('✗ Failed to save');
            }
        }

        loadData();
    </script>
</body>
</html>
'''

@app.route('/')
def index():
    return render_template_string(HTML_TEMPLATE)

@app.route('/api/duplicates')
def get_duplicates():
    dup_clinics = get_duplicate_url_clinics()
    dup_clinics = dup_clinics.fillna('')
    return jsonify(dup_clinics.to_dict('records'))

@app.route('/api/update-urls', methods=['POST'])
def update_urls():
    data = request.json
    changes = data.get('changes', {})
    deletions = data.get('deletions', [])

    db = load_db()

    # Apply URL changes
    for clinic_id_str, new_url in changes.items():
        clinic_id = int(clinic_id_str)
        db.loc[db['clinic_id'] == clinic_id, 'website'] = new_url

    # Delete clinics
    if deletions:
        deletion_ids = [int(cid) for cid in deletions]
        db = db[~db['clinic_id'].isin(deletion_ids)]

    save_db(db)
    return jsonify({'status': 'saved', 'deleted': len(deletions)})

if __name__ == '__main__':
    print("Starting Duplicate URL Fixer at http://localhost:8001")
    app.run(debug=True, port=8001, use_reloader=False)
