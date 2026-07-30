from flask import Flask, render_template_string, request, jsonify
import pandas as pd
import os
import sys

app = Flask(__name__)

# Use command-line argument if provided, otherwise use default
CSV_PATH = sys.argv[1] if len(sys.argv) > 1 else '/Users/joshting/Desktop/GP Intelligence Platform/GP Platform Code/data/clinics/Corporate Only/NEW Corporate List.csv'

def load_csv():
    return pd.read_csv(CSV_PATH)

def save_csv(df):
    df.to_csv(CSV_PATH, index=False)

def is_complete(row):
    """Check if clinic data is complete"""
    if pd.notna(row['Website Issue']) and str(row['Website Issue']).lower() == 'yes':
        return True
    if pd.notna(row['Doctor Count']) and row['Doctor Count'] > 0:
        return True
    return False

HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Corporate List Viewer</title>
    <style>
        body { font-family: Arial; margin: 20px; }
        .filters { margin-bottom: 20px; }
        input, select { padding: 8px; margin: 5px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #4CAF50; color: white; }
        tr:nth-child(even) { background-color: #f2f2f2; }
        tr.complete { background-color: #c8e6c9; }
        .status-bar { margin: 20px 0; padding: 10px; background: #f0f0f0; }
        button { padding: 8px 15px; margin: 5px; cursor: pointer; background: #4CAF50; color: white; border: none; border-radius: 4px; }
        button:hover { background: #45a049; }
        select.edit-select { width: 100%; padding: 4px; }
        input.edit-input { padding: 4px; border: 1px solid #ccc; }
        .delete-btn { background: #f44336; font-size: 12px; }
        .delete-btn:hover { background: #da190b; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; }
        .modal.show { display: flex; align-items: center; justify-content: center; }
        .modal-content { background: white; padding: 30px; border-radius: 8px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; }
        .modal-header { font-size: 18px; font-weight: bold; margin-bottom: 20px; }
        .modal-field { margin-bottom: 15px; }
        .modal-label { font-weight: bold; font-size: 12px; display: block; margin-bottom: 5px; }
        .modal-input { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
        .modal-buttons { margin-top: 25px; display: flex; gap: 10px; justify-content: flex-end; }
        .btn-save { background: #4CAF50; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
        .btn-save:hover { background: #45a049; }
        .btn-cancel { background: #999; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
        .btn-cancel:hover { background: #777; }
        .edit-btn { background: #2196F3; color: white; padding: 5px 10px; font-size: 12px; border: none; border-radius: 4px; cursor: pointer; }
        .edit-btn:hover { background: #0b7dda; }
    </style>
</head>
<body>
    <h1>Corporate List Editor - NEW Corporate List</h1>
    
    <div class="status-bar">
        <strong>Total Clinics:</strong> <span id="total">0</span> | 
        <strong>Completed:</strong> <span id="completed">0</span> | 
        <strong>Incomplete:</strong> <span id="incomplete">0</span>
    </div>

    <div class="filters">
        <input type="text" id="search" placeholder="Search clinic name..." style="width: 300px;">
        <button onclick="filterByComplete()">Incomplete Only</button>
        <button onclick="filterByComplete('complete')">Completed Only</button>
        <input type="hidden" id="filterComplete" value="">
        <select id="filterCorporate">
            <option value="">All Corporate Chains</option>
        </select>
        <select id="filterURL">
            <option value="">All URLs</option>
            <option value="missing">Missing URLs Only</option>
            <option value="has">Has URLs Only</option>
        </select>
        <select id="filterAddress">
            <option value="">All Addresses</option>
            <option value="missing">Missing Addresses Only</option>
            <option value="has">Has Addresses Only</option>
        </select>
        <select id="filterState">
            <option value="">All States</option>
            <option value="missing">Missing States Only</option>
            <option value="has">Has States Only</option>
        </select>
        <select id="filterBilling">
            <option value="">All Billing Types</option>
            <option value="missing">Missing Billing Only</option>
            <option value="has">Has Billing Only</option>
        </select>
        <button onclick="clearFilters()">Clear Filters</button>
        <button onclick="location.reload()">Refresh</button>
    </div>

    <!-- Edit Modal -->
    <div id="editModal" class="modal">
        <div class="modal-content">
            <div class="modal-header" id="modalTitle"></div>
            <div id="modalFields"></div>
            <div class="modal-buttons">
                <button class="btn-cancel" onclick="closeModal()">Cancel</button>
                <button class="btn-save" onclick="saveModal()">Save Changes</button>
            </div>
        </div>
    </div>

    <table id="dataTable">
        <thead>
            <tr>
                <th>Corporate Chain</th>
                <th>Clinic Name</th>
                <th>Address</th>
                <th>URL</th>
                <th>State</th>
                <th>Doctor Count</th>
                <th>Pathology</th>
                <th>Radiology/Imaging</th>
                <th>Website Issue</th>
                <th>Billing Type</th>
                <th>Allied Health</th>
                <th>Action</th>
            </tr>
        </thead>
        <tbody id="tableBody"></tbody>
    </table>

    <script>
        let data = [];

        async function loadData() {
            const response = await fetch('/api/data');
            data = await response.json();
            populateFilters();
            filterTable();
            updateStats();
        }

        function renderTable(rows) {
            const tbody = document.getElementById('tableBody');
            tbody.innerHTML = '';

            rows.forEach((row) => {
                // Find the actual index in the full data array
                const actualIndex = data.findIndex(d => d['Clinic Name'] === row['Clinic Name'] && d['Corporate Chain'] === row['Corporate Chain']);

                const tr = document.createElement('tr');
                if (row.complete) tr.classList.add('complete');

                tr.innerHTML = `
                    <td>${row['Corporate Chain']}</td>
                    <td>${row['Clinic Name']}</td>
                    <td>${row['Address'] || ''}</td>
                    <td><a href="${row['URL']}" target="_blank" style="font-size: 11px;">${row['URL'] ? row['URL'].substring(0, 40) + '...' : ''}</a></td>
                    <td>${row['State']}</td>
                    <td>${row['Doctor Count'] || ''}</td>
                    <td>${row['Pathology'] || ''}</td>
                    <td>${row['Radiology/Imaging'] || ''}</td>
                    <td>${row['Website Issue'] || ''}</td>
                    <td>${row['Billing Type']}</td>
                    <td>${row['Allied Health'] || ''}</td>
                    <td><button class="edit-btn" onclick="openModal(${actualIndex})">Edit</button> <button class="delete-btn" onclick="deleteRow(${actualIndex})">Delete</button></td>
                `;
                tbody.appendChild(tr);
            });
        }

        let editingIndex = null;
        let editingData = {};

        function openModal(index) {
            editingIndex = index;
            editingData = JSON.parse(JSON.stringify(data[index]));

            document.getElementById('modalTitle').textContent = `Edit: ${data[index]['Clinic Name']}`;

            const fields = ['Corporate Chain', 'Clinic Name', 'Address', 'URL', 'State', 'Doctor Count', 'Doctor Names Clean', 'Pathology', 'Radiology/Imaging', 'Website Issue', 'Billing Type', 'Allied Health'];
            let html = '';

            fields.forEach(field => {
                const value = editingData[field] || '';
                const inputType = field === 'Doctor Count' ? 'number' : 'text';

                html += `
                    <div class="modal-field">
                        <label class="modal-label">${field}</label>
                        <input type="text" class="modal-input" id="field-${field}" value="${value}" />
                    </div>
                `;
            });

            document.getElementById('modalFields').innerHTML = html;
            document.getElementById('editModal').classList.add('show');
        }

        function closeModal() {
            document.getElementById('editModal').classList.remove('show');
            editingIndex = null;
            editingData = {};
        }

        async function saveModal() {
            const fields = ['Corporate Chain', 'Clinic Name', 'Address', 'URL', 'State', 'Doctor Count', 'Doctor Names Clean', 'Pathology', 'Radiology/Imaging', 'Website Issue', 'Billing Type', 'Allied Health'];

            for (let field of fields) {
                const newValue = document.getElementById(`field-${field}`).value;
                if (editingData[field] !== newValue) {
                    const response = await fetch('/api/update-cell', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({index: editingIndex, field: field, value: newValue})
                    });

                    if (!response.ok) {
                        alert(`Failed to save ${field}`);
                        return;
                    }
                }
            }

            closeModal();
            await loadData();
        }

        async function deleteRow(index) {
            if (!confirm('Delete this clinic?')) return;
            const response = await fetch('/api/delete-row', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({index})
            });
            
            if (response.ok) {
                await loadData();
            }
        }

        function populateFilters() {
            const chains = [...new Set(data.map(r => r['Corporate Chain']))].sort();
            const select = document.getElementById('filterCorporate');
            const currentValue = select.value;
            // Clear existing options (keep the default one)
            while (select.options.length > 1) {
                select.remove(1);
            }
            chains.forEach(chain => {
                const option = document.createElement('option');
                option.value = chain;
                option.text = chain;
                select.appendChild(option);
            });
            select.value = currentValue;
        }

        function filterTable() {
            let filtered = data;

            const search = document.getElementById('search').value.toLowerCase();
            filtered = filtered.filter(r => r['Clinic Name'].toLowerCase().includes(search));

            const complete = document.getElementById('filterComplete').value;
            if (complete === 'complete') filtered = filtered.filter(r => r.complete);
            if (complete === 'incomplete') filtered = filtered.filter(r => !r.complete);

            const chain = document.getElementById('filterCorporate').value;
            if (chain) filtered = filtered.filter(r => r['Corporate Chain'] === chain);

            const url = document.getElementById('filterURL').value;
            if (url === 'missing') filtered = filtered.filter(r => !r['URL'] || r['URL'] === null);
            if (url === 'has') filtered = filtered.filter(r => r['URL'] && r['URL'] !== null);

            const address = document.getElementById('filterAddress').value;
            if (address === 'missing') filtered = filtered.filter(r => !r['Address'] || r['Address'] === null);
            if (address === 'has') filtered = filtered.filter(r => r['Address'] && r['Address'] !== null);

            const state = document.getElementById('filterState').value;
            if (state === 'missing') filtered = filtered.filter(r => !r['State'] || r['State'] === null);
            if (state === 'has') filtered = filtered.filter(r => r['State'] && r['State'] !== null);

            const billing = document.getElementById('filterBilling').value;
            if (billing === 'missing') filtered = filtered.filter(r => !r['Billing Type'] || r['Billing Type'] === null);
            if (billing === 'has') filtered = filtered.filter(r => r['Billing Type'] && r['Billing Type'] !== null);

            renderTable(filtered);
        }

        function clearFilters() {
            document.getElementById('search').value = '';
            document.getElementById('filterComplete').value = '';
            document.getElementById('filterCorporate').value = '';
            document.getElementById('filterURL').value = '';
            document.getElementById('filterAddress').value = '';
            document.getElementById('filterState').value = '';
            document.getElementById('filterBilling').value = '';
            filterTable();
        }

        function filterByComplete(filter = 'incomplete') {
            document.getElementById('filterComplete').value = filter;
            filterTable();
        }

        function updateStats() {
            const completed = data.filter(r => r.complete).length;
            document.getElementById('total').textContent = data.length;
            document.getElementById('completed').textContent = completed;
            document.getElementById('incomplete').textContent = data.length - completed;
        }

        document.getElementById('search').addEventListener('input', filterTable);
        document.getElementById('filterCorporate').addEventListener('change', filterTable);
        document.getElementById('filterURL').addEventListener('change', filterTable);
        document.getElementById('filterAddress').addEventListener('change', filterTable);
        document.getElementById('filterState').addEventListener('change', filterTable);
        document.getElementById('filterBilling').addEventListener('change', filterTable);

        // Close modal when clicking outside
        document.getElementById('editModal').addEventListener('click', function(e) {
            if (e.target === this) closeModal();
        });

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
    data = []
    for idx, row in df.iterrows():
        row_dict = row.to_dict()
        # Convert NaN to None (null in JSON)
        row_dict = {k: (None if pd.isna(v) else v) for k, v in row_dict.items()}
        row_dict['complete'] = is_complete(row)
        data.append(row_dict)
    return jsonify(data)

@app.route('/api/update-cell', methods=['POST'])
def update_cell():
    req = request.json
    df = load_csv()
    df.at[req['index'], req['field']] = req['value']
    save_csv(df)
    return jsonify({'status': 'ok'})

@app.route('/api/delete-row', methods=['POST'])
def delete_row():
    req = request.json
    df = load_csv()
    df = df.drop(req['index']).reset_index(drop=True)
    save_csv(df)
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    app.run(debug=True, port=8000, use_reloader=True)
