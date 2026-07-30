from flask import Flask, render_template_string, request, jsonify
import pandas as pd
import sys
import os

app = Flask(__name__)

CSV_PATH = sys.argv[1] if len(sys.argv) > 1 else '/tmp/duplicate_urls_for_review.csv'

def load_csv():
    return pd.read_csv(CSV_PATH)

def save_csv(df):
    df.to_csv(CSV_PATH, index=False)

HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Duplicate URLs Reviewer</title>
    <style>
        body { font-family: Arial; margin: 20px; background: #f5f5f5; }
        .header { background: #2c3e50; color: white; padding: 20px; border-radius: 4px; margin-bottom: 20px; }
        .stats { display: flex; gap: 30px; margin-bottom: 20px; }
        .stat { background: white; padding: 15px; border-radius: 4px; border-left: 4px solid #3498db; }
        .stat-number { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .stat-label { font-size: 12px; color: #7f8c8d; }
        .filters { margin-bottom: 20px; }
        select, input { padding: 8px; margin: 5px; border: 1px solid #bdc3c7; border-radius: 4px; }
        button { padding: 8px 15px; margin: 5px; cursor: pointer; background: #3498db; color: white; border: none; border-radius: 4px; }
        button:hover { background: #2980b9; }
        table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        th { background: #34495e; color: white; padding: 12px; text-align: left; }
        td { padding: 12px; border-bottom: 1px solid #ecf0f1; }
        tr:hover { background: #f8f9fa; }
        .url-group { background: #ecf0f1; font-weight: bold; }
        input[type="checkbox"] { cursor: pointer; }
        textarea { width: 100%; padding: 8px; border: 1px solid #bdc3c7; border-radius: 4px; }
        .save-btn { background: #27ae60; }
        .save-btn:hover { background: #229954; }
        .delete-btn { background: #e74c3c; }
        .delete-btn:hover { background: #c0392b; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Duplicate URLs Reviewer</h1>
        <p>Review and mark clinics to keep or delete</p>
    </div>

    <div class="stats">
        <div class="stat">
            <div class="stat-number" id="totalCount">0</div>
            <div class="stat-label">Total Clinics</div>
        </div>
        <div class="stat">
            <div class="stat-number" id="urlGroupCount">0</div>
            <div class="stat-label">URL Groups</div>
        </div>
        <div class="stat">
            <div class="stat-number" id="chainCount">0</div>
            <div class="stat-label">Chains</div>
        </div>
    </div>

    <div class="filters">
        <input type="text" id="search" placeholder="Search clinic name..." style="width: 300px;">
        <select id="chainFilter">
            <option value="">All Chains</option>
        </select>
        <button onclick="filterTable()">Filter</button>
        <button onclick="clearFilters()">Clear</button>
        <button onclick="saveCsv()" class="save-btn">Save Changes</button>
    </div>

    <table id="dataTable">
        <thead>
            <tr>
                <th>Chain</th>
                <th>Duplicate URL</th>
                <th>Clinic ID</th>
                <th>Clinic Name</th>
                <th>Address</th>
                <th>Suburb</th>
                <th>Recommendation</th>
                <th>Action</th>
                <th>Your Decision</th>
            </tr>
        </thead>
        <tbody id="tableBody"></tbody>
    </table>

    <script>
        let fullData = [];
        let urlGroups = {};

        async function loadData() {
            const response = await fetch('/api/data');
            fullData = await response.json();

            // Group by URL
            urlGroups = {};
            fullData.forEach(row => {
                const key = row['Duplicate URL'];
                if (!urlGroups[key]) urlGroups[key] = [];
                urlGroups[key].push(row);
            });

            // Populate chain filter
            const chains = [...new Set(fullData.map(r => r['Corporate Chain']))].sort();
            const select = document.getElementById('chainFilter');
            chains.forEach(chain => {
                const option = document.createElement('option');
                option.value = chain;
                option.text = chain;
                select.appendChild(option);
            });

            // Update stats
            document.getElementById('totalCount').textContent = fullData.length;
            document.getElementById('urlGroupCount').textContent = Object.keys(urlGroups).length;
            document.getElementById('chainCount').textContent = chains.length;

            filterTable();
        }

        function filterTable() {
            let filtered = fullData;

            const search = document.getElementById('search').value.toLowerCase();
            if (search) {
                filtered = filtered.filter(r =>
                    r['Clinic Name'].toLowerCase().includes(search) ||
                    r['Address'].toLowerCase().includes(search)
                );
            }

            const chain = document.getElementById('chainFilter').value;
            if (chain) {
                filtered = filtered.filter(r => r['Corporate Chain'] === chain);
            }

            renderTable(filtered);
        }

        function renderTable(rows) {
            const tbody = document.getElementById('tableBody');
            tbody.innerHTML = '';

            let lastUrl = null;
            rows.forEach((row, idx) => {
                const tr = document.createElement('tr');
                if (row['Duplicate URL'] !== lastUrl) {
                    tr.classList.add('url-group');
                    lastUrl = row['Duplicate URL'];
                }

                const recColor = row['Recommendation'] === 'KEEP' ? '#d4edda' : '#f8d7da';
                tr.style.backgroundColor = recColor;

                tr.innerHTML = `
                    <td>${row['Corporate Chain']}</td>
                    <td><a href="${row['Duplicate URL']}" target="_blank" style="color: #3498db; font-size: 11px;">${row['Duplicate URL'].substring(0, 45)}...</a></td>
                    <td><strong>${row['Clinic ID']}</strong></td>
                    <td>${row['Clinic Name']}</td>
                    <td style="font-size: 11px;">${row['Address']}</td>
                    <td>${row['Suburb']}</td>
                    <td><strong style="color: ${row['Recommendation'] === 'KEEP' ? '#27ae60' : '#e74c3c'}">${row['Recommendation']}</strong></td>
                    <td>
                        <button onclick="markKeep(${rows.indexOf(row)})" style="background: #27ae60; color: white; padding: 4px 8px; margin: 2px; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; font-weight: bold;">✓ KEEP</button>
                        <button onclick="markDelete(${rows.indexOf(row)})" style="background: #e74c3c; color: white; padding: 4px 8px; margin: 2px; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; font-weight: bold;">✗ DELETE</button>
                    </td>
                    <td><span id="status_${rows.indexOf(row)}" style="font-weight: bold;">${row['Confirm?'] || ''}</span></td>
                `;
                tbody.appendChild(tr);
            });
        }

        function updateCell(idx, field, value) {
            fullData[idx][field] = value;
        }

        function markKeep(idx) {
            fullData[idx]['Confirm?'] = 'KEEP';
            document.getElementById(`status_${idx}`).textContent = 'KEEP';
            document.getElementById(`status_${idx}`).style.color = '#27ae60';
            document.getElementById(`status_${idx}`).style.fontWeight = 'bold';
        }

        function markDelete(idx) {
            fullData[idx]['Confirm?'] = 'DELETE';
            document.getElementById(`status_${idx}`).textContent = 'DELETE';
            document.getElementById(`status_${idx}`).style.color = '#e74c3c';
            document.getElementById(`status_${idx}`).style.fontWeight = 'bold';
        }

        function clearFilters() {
            document.getElementById('search').value = '';
            document.getElementById('chainFilter').value = '';
            filterTable();
        }

        async function saveCsv() {
            const response = await fetch('/api/save', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(fullData)
            });

            if (response.ok) {
                alert('✓ Changes saved to CSV');
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
    df = load_csv()
    df = df.fillna('')
    return jsonify(df.to_dict('records'))

@app.route('/api/save', methods=['POST'])
def save_data():
    data = request.json
    df = pd.DataFrame(data)
    save_csv(df)
    return jsonify({'status': 'saved'})

if __name__ == '__main__':
    print(f"Loading CSV from: {CSV_PATH}")
    print(f"Starting viewer at http://localhost:8000")
    app.run(debug=True, port=8000, use_reloader=False)
