from flask import Flask, render_template_string, request, jsonify
import pandas as pd
import sys

app = Flask(__name__)

def load_db():
    return pd.read_csv('data/clinics/Master Sheet/comprehensive_clinic_database.csv')

def save_db(df):
    df.to_csv('data/clinics/Master Sheet/comprehensive_clinic_database.csv', index=False)

HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>URL Corrector</title>
    <style>
        body { font-family: Arial; margin: 20px; background: #f5f5f5; }
        .header { background: #2c3e50; color: white; padding: 20px; border-radius: 4px; margin-bottom: 20px; }
        .filters { background: white; padding: 15px; margin-bottom: 20px; border-radius: 4px; }
        input, select { padding: 8px; margin: 5px; border: 1px solid #bdc3c7; border-radius: 4px; }
        button { padding: 8px 15px; margin: 5px; cursor: pointer; background: #3498db; color: white; border: none; border-radius: 4px; }
        button:hover { background: #2980b9; }
        table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        th { background: #34495e; color: white; padding: 12px; text-align: left; }
        td { padding: 12px; border-bottom: 1px solid #ecf0f1; }
        tr:hover { background: #f8f9fa; }
        .missing-url { background: #fff3cd; }
        .duplicate-url { background: #f8d7da; }
        .good-url { background: #d4edda; }
        input[type="text"] { width: 100%; padding: 6px; border: 1px solid #bdc3c7; }
        .save-btn { background: #27ae60; }
        .save-btn:hover { background: #229954; }
        .status { padding: 10px; margin: 10px 0; border-radius: 4px; }
        .issue-count { display: inline-block; background: #e74c3c; color: white; padding: 5px 10px; border-radius: 20px; margin: 5px; }
        .url-group-header { background: #34495e; color: white; padding: 10px; font-weight: bold; border-top: 3px solid #3498db; }
        .url-group-count { background: #3498db; color: white; padding: 2px 8px; border-radius: 12px; margin-left: 10px; font-size: 12px; }
        .url-clinic-row { border-left: 4px solid #3498db; }
        .url-clinic-row:first-child { border-top: 2px solid #3498db; }
    </style>
</head>
<body>
    <div class="header">
        <h1>URL Corrector</h1>
        <p>Review and correct clinic website URLs</p>
    </div>

    <div class="filters">
        <label>Chain:</label>
        <select id="chainFilter">
            <option value="">All Chains</option>
        </select>

        <label>Show:</label>
        <select id="statusFilter">
            <option value="">All Clinics</option>
            <option value="missing">Missing URLs Only</option>
            <option value="duplicate">Duplicate URLs Only</option>
        </select>

        <button onclick="filterTable()">Filter</button>
        <button onclick="clearFilters()">Clear</button>
        <button onclick="saveCsv()" class="save-btn">Save All Changes</button>
    </div>

    <div class="status">
        <span id="stats"></span>
    </div>

    <table id="dataTable">
        <thead>
            <tr>
                <th>Chain</th>
                <th>Clinic ID</th>
                <th>Clinic Name</th>
                <th>Address</th>
                <th>Current URL</th>
                <th>Issue</th>
                <th>New URL</th>
            </tr>
        </thead>
        <tbody id="tableBody"></tbody>
    </table>

    <script>
        let fullData = [];

        async function loadData() {
            const response = await fetch('/api/data');
            fullData = await response.json();

            // Populate chain filter
            const chains = [...new Set(fullData.map(r => r['Corporate Chain']))].sort();
            const select = document.getElementById('chainFilter');
            chains.forEach(chain => {
                const option = document.createElement('option');
                option.value = chain;
                option.text = chain;
                select.appendChild(option);
            });

            updateStats();
            // Default to showing only duplicates
            document.getElementById('statusFilter').value = 'duplicate';
            filterTable();
        }

        function updateStats() {
            const missing = fullData.filter(r => !r['website'] || r['website'].trim() === '').length;
            const total = fullData.length;
            const stats = document.getElementById('stats');
            stats.innerHTML = `<strong>Total:</strong> ${total} clinics | <span class="issue-count">Missing URL: ${missing}</span>`;
        }

        function filterTable() {
            let filtered = fullData;

            const chain = document.getElementById('chainFilter').value;
            if (chain) {
                filtered = filtered.filter(r => r['Corporate Chain'] === chain);
            }

            const status = document.getElementById('statusFilter').value;
            if (status === 'missing') {
                filtered = filtered.filter(r => !r['website'] || r['website'].trim() === '');
            } else if (status === 'duplicate') {
                // Find URLs that appear multiple times
                const urlCounts = {};
                fullData.forEach(r => {
                    if (r['website'] && r['website'].trim()) {
                        urlCounts[r['website']] = (urlCounts[r['website']] || 0) + 1;
                    }
                });
                const dupUrls = Object.keys(urlCounts).filter(url => urlCounts[url] > 1);
                filtered = filtered.filter(r => dupUrls.includes(r['website']));
            }

            renderTable(filtered);
        }

        function renderTable(rows) {
            const tbody = document.getElementById('tableBody');
            tbody.innerHTML = '';

            // Group by URL
            const urlGroups = {};
            rows.forEach((row, idx) => {
                const url = row['website'] || '(NO URL)';
                if (!urlGroups[url]) {
                    urlGroups[url] = [];
                }
                urlGroups[url].push({row, idx});
            });

            // Sort URL groups by count (duplicates first)
            const sortedUrls = Object.keys(urlGroups).sort((a, b) => {
                return urlGroups[b].length - urlGroups[a].length;
            });

            sortedUrls.forEach(url => {
                const clinics = urlGroups[url];
                const urlCount = clinics.length;
                const isDuplicate = urlCount > 1 && url !== '(NO URL)';

                // Add URL group header
                const headerTr = document.createElement('tr');
                headerTr.className = 'url-group-header';
                const headerColor = url === '(NO URL)' ? '#e74c3c' : isDuplicate ? '#e67e22' : '#27ae60';
                headerTr.style.background = headerColor;
                headerTr.innerHTML = `
                    <td colspan="7">
                        ${isDuplicate ? '⚠️' : url === '(NO URL)' ? '❌' : '✓'}
                        <strong>${url === '(NO URL)' ? 'MISSING URLS' : url}</strong>
                        <span class="url-group-count">${urlCount} clinic${urlCount > 1 ? 's' : ''}</span>
                    </td>
                `;
                tbody.appendChild(headerTr);

                // Add clinics in this URL group
                clinics.forEach(({row, idx}) => {
                    const tr = document.createElement('tr');
                    tr.className = 'url-clinic-row';

                    let issueClass = '';
                    let issueText = '';
                    if (!row['website'] || row['website'].trim() === '') {
                        issueClass = 'missing-url';
                        issueText = '❌ Missing';
                    } else if (urlCount > 1) {
                        issueClass = 'duplicate-url';
                        issueText = `⚠️ Shared (${urlCount}x)`;
                    } else {
                        issueClass = 'good-url';
                        issueText = '✓ OK';
                    }

                    tr.style.background = issueClass === 'missing-url' ? '#fff3cd' : issueClass === 'duplicate-url' ? '#f8d7da' : '#d4edda';

                    const globalIdx = fullData.indexOf(row);

                    tr.innerHTML = `
                        <td>${row['Corporate Chain']}</td>
                        <td>${row['clinic_id']}</td>
                        <td>${row['clinic_name']}</td>
                        <td style="font-size: 11px;">${row['address']}</td>
                        <td><a href="${row['website'] || '#'}" target="_blank" style="color: #3498db; font-size: 11px;">${row['website'] ? row['website'].substring(0, 50) + '...' : '(empty)'}</a></td>
                        <td>${issueText}</td>
                        <td><input type="text" value="${row['website'] || ''}" onchange="updateUrl(${globalIdx}, this.value)" placeholder="Enter URL here"></td>
                    `;
                    tbody.appendChild(tr);
                });
            });
        }

        function updateUrl(idx, newUrl) {
            fullData[idx]['website'] = newUrl;
        }

        function clearFilters() {
            document.getElementById('chainFilter').value = '';
            document.getElementById('statusFilter').value = '';
            filterTable();
        }

        async function saveCsv() {
            if (!confirm('Save all URL changes to database?')) return;

            const response = await fetch('/api/save', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(fullData)
            });

            if (response.ok) {
                alert('✓ URLs saved to database');
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

@app.route('/api/data')
def get_data():
    db = load_db()
    db = db.fillna('')
    return jsonify(db.to_dict('records'))

@app.route('/api/save', methods=['POST'])
def save_data():
    data = request.json
    df = pd.DataFrame(data)
    save_db(df)
    return jsonify({'status': 'saved'})

if __name__ == '__main__':
    print("Starting URL editor at http://localhost:8001")
    app.run(debug=True, port=8001, use_reloader=False)
