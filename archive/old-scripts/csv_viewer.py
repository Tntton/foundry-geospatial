
from flask import Flask, render_template_string, request, jsonify
import pandas as pd

app = Flask(__name__)
CSV_PATH = 'corporate_chain_csv_exports/corporate_chain_master_database.csv'

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>GP Clinics Database</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            max-width: 100%;
            margin: 0 auto;
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            border-bottom: 2px solid #007bff;
            padding-bottom: 15px;
        }
        h1 {
            color: #333;
            margin: 0;
        }
        .refresh-btn {
            background: #007bff;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
        }
        .refresh-btn:hover {
            background: #0056b3;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }
        .stat-box {
            background: #f8f9fa;
            padding: 15px;
            border-left: 4px solid #007bff;
            border-radius: 4px;
        }
        .stat-label {
            color: #666;
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
        }
        .stat-value {
            color: #007bff;
            font-size: 24px;
            font-weight: bold;
            margin-top: 5px;
        }
        .filters {
            display: flex;
            gap: 15px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .filter-group {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        .filter-label {
            font-size: 12px;
            font-weight: bold;
            color: #666;
            text-transform: uppercase;
        }
        input[type="text"],
        select {
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }
        input[type="text"] {
            width: 300px;
        }
        select {
            width: 250px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        th {
            background: #007bff;
            color: white;
            padding: 12px;
            text-align: left;
            font-weight: bold;
            position: sticky;
            top: 0;
        }
        td {
            padding: 10px 12px;
            border-bottom: 1px solid #ddd;
            cursor: pointer;
        }
        tr:hover {
            background: #f0f0f0;
            cursor: pointer;
        }
        tr.complete {
            background-color: #d4edda;
        }
        tr.complete:hover {
            background-color: #c3e6cb;
        }
        .truncate {
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        a {
            color: #007bff;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        .last-update {
            color: #999;
            font-size: 12px;
            margin-top: 15px;
        }
        
        /* Modal styles */
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
        }
        .modal.active {
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .modal-content {
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            width: 90%;
            max-width: 500px;
            max-height: 80vh;
            overflow-y: auto;
        }
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            border-bottom: 2px solid #007bff;
            padding-bottom: 10px;
        }
        .modal-header h2 {
            margin: 0;
            color: #333;
        }
        .close-btn {
            background: #ccc;
            border: none;
            color: #333;
            font-size: 20px;
            cursor: pointer;
            width: 30px;
            height: 30px;
            border-radius: 4px;
        }
        .close-btn:hover {
            background: #bbb;
        }
        .form-group {
            margin-bottom: 15px;
        }
        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
            color: #333;
            font-size: 14px;
        }
        .form-group input,
        .form-group select {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
            box-sizing: border-box;
        }
        .button-group {
            display: flex;
            gap: 10px;
            justify-content: space-between;
            margin-top: 20px;
        }
        .button-group-right {
            display: flex;
            gap: 10px;
        }
        .save-btn {
            background: #28a745;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
        }
        .save-btn:hover {
            background: #218838;
        }
        .cancel-btn {
            background: #6c757d;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
        }
        .cancel-btn:hover {
            background: #5a6268;
        }
        .delete-btn {
            background: #dc3545;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
        }
        .delete-btn:hover {
            background: #c82333;
        }
        .clinic-info {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 20px;
            border-left: 4px solid #007bff;
        }
        .clinic-info p {
            margin: 5px 0;
            font-size: 13px;
        }
        .editable-cell {
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 3px;
            transition: background-color 0.2s;
        }
        .editable-cell:hover {
            background-color: #fff3cd;
        }
        .cell-edit {
            padding: 4px 6px;
            border: 2px solid #007bff;
            border-radius: 3px;
            background: white;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 GP Clinics Database</h1>
            <button class="refresh-btn" onclick="location.reload()">🔄 Refresh</button>
        </div>
        
        <div class="stats">
            <div class="stat-box">
                <div class="stat-label">Total Clinics</div>
                <div class="stat-value">{{ total_clinics }}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">With Doctors</div>
                <div class="stat-value">{{ with_doctors }}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Complete Data</div>
                <div class="stat-value" style="color: #28a745;">{{ complete_data }}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">With Pathology</div>
                <div class="stat-value">{{ with_pathology }}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">With Radiology</div>
                <div class="stat-value">{{ with_radiology }}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">With Allied Health</div>
                <div class="stat-value">{{ with_allied }}</div>
            </div>
        </div>

        <div class="filters">
            <div class="filter-group">
                <label class="filter-label">Search Clinic Name</label>
                <input type="text" id="search" placeholder="Type clinic name..." onkeyup="filterTable(); saveFilters()">
            </div>
            <div class="filter-group">
                <label class="filter-label">Corporate Chain</label>
                <select id="chainFilter" onchange="filterTable(); saveFilters()">
                    <option value="">All Chains</option>
                    {% for chain in chains %}
                    <option value="{{ chain }}">{{ chain }}</option>
                    {% endfor %}
                </select>
            </div>
            <div class="filter-group">
                <label class="filter-label">Bulk Edit</label>
                <button class="refresh-btn" onclick="toggleBulkEdit()" style="background: #6c757d;">📋 Bulk Edit</button>
            </div>
            <div class="filter-group">
                <label class="filter-label">Show Only</label>
                <select id="completeFilter" onchange="filterTable(); saveFilters()">
                    <option value="">All</option>
                    <option value="incomplete">Incomplete Only</option>
                    <option value="complete">Complete Only</option>
                </select>
            </div>
        </div>

        <table id="dataTable">
            <thead>
                <tr>
                    <th><input type="checkbox" id="selectAll" onchange="toggleSelectAll()" style="display:none;"></th>
                    <th>Clinic Name</th>
                    <th>Corporate Chain</th>
                    <th>Location</th>
                    <th>Website</th>
                    <th>Billing</th>
                    <th>Doctors</th>
                    <th>Doctor Count</th>
                    <th>Pathology</th>
                    <th>Radiology</th>
                    <th>Allied Health</th>
                    <th>Website Issue</th>
                </tr>
            </thead>
            <tbody>
                {% for index, row in df.iterrows() %}
                <tr {% if is_complete(row) %}class="complete"{% endif %} onclick="if (!bulkEditMode) editClinic({{ index }})">
                    <td onclick="event.stopPropagation();"><input type="checkbox" class="row-checkbox" data-index="{{ index }}" style="display:none;"></td>
                    <td class="truncate"><strong>{{ row['Clinic Name'] }}</strong></td>
                    <td>{{ row['Corporate Chain'] }}</td>
                    <td class="truncate">{{ row['State'] }}</td>
                    <td>
                        {% if pd.notna(row['URL']) %}
                            <a href="{{ row['URL'] }}" onclick="openInSecondWindow('{{ row['URL'] }}'); event.stopPropagation(); return false;">🔗 Visit</a>
                        {% else %}
                            -
                        {% endif %}
                    </td>
                    <td onclick="event.stopPropagation();">{{ row['Billing Type'] if pd.notna(row['Billing Type']) else '-' }}</td>
                    <td class="truncate" onclick="event.stopPropagation();">{{ row['Doctor Names Clean'][:60] if pd.notna(row['Doctor Names Clean']) else '-' }}</td>
                    <td onclick="event.stopPropagation();">{{ row['Doctor Count'] if pd.notna(row['Doctor Count']) else 0 }}</td>
                    <td onclick="event.stopPropagation();">{{ row['Pathology'] if pd.notna(row['Pathology']) else '-' }}</td>
                    <td onclick="event.stopPropagation();">{{ row['Radiology/Imaging'] if pd.notna(row['Radiology/Imaging']) else '-' }}</td>
                    <td class="editable-cell" onclick="if (!bulkEditMode) { editCell(event, {{ index }}, 'alliedHealth'); event.stopPropagation(); }">{{ row['Allied Health'] if pd.notna(row['Allied Health']) else '-' }}</td>
                    <td class="editable-cell" onclick="if (!bulkEditMode) { editCell(event, {{ index }}, 'websiteIssue'); event.stopPropagation(); }" style="background: #ffe6e6;">{{ row['Website Issue'] if pd.notna(row['Website Issue']) else '-' }}</td>
                </tr>
                {% endfor %}
            </tbody>
        </table>

        <div class="last-update">
            Last updated: {{ now }}
        </div>
    </div>

    <!-- Bulk Edit Modal -->
    <div id="bulkEditModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2>Bulk Edit</h2>
                <button class="close-btn" onclick="closeBulkEditModal()">&times;</button>
            </div>
            
            <div class="form-group">
                <label>Select Field to Edit</label>
                <select id="bulkField">
                    <option value="">-- Choose Field --</option>
                    <option value="billing">Billing</option>
                    <option value="doctorCount">Doctor Count</option>
                    <option value="pathology">Pathology</option>
                    <option value="radiology">Radiology/Imaging</option>
                    <option value="alliedHealth">Allied Health</option>
                </select>
            </div>
            
            <div class="form-group">
                <label>Value</label>
                <select id="bulkValue" onchange="updateValueOptions()">
                    <option value="">-- Choose Value --</option>
                </select>
            </div>
            
            <script>
                document.getElementById('bulkField').addEventListener('change', function() {
                    const valueSelect = document.getElementById('bulkValue');
                    const field = this.value;
                    
                    // Clear existing options
                    valueSelect.innerHTML = '<option value="">-- Choose Value --</option>';
                    
                    if (field === 'billing') {
                        valueSelect.innerHTML += '<option value="Bulk Billing">Bulk Billing</option>';
                        valueSelect.innerHTML += '<option value="Mixed Billing">Mixed Billing</option>';
                        valueSelect.innerHTML += '<option value="Private Billing">Private Billing</option>';
                    } else if (field === 'pathology' || field === 'radiology' || field === 'alliedHealth') {
                        valueSelect.innerHTML += '<option value="Yes">Yes</option>';
                        valueSelect.innerHTML += '<option value="No">No</option>';
                    } else if (field === 'doctorCount') {
                        valueSelect.innerHTML = '<input type="number" id="bulkValue" min="0" placeholder="Enter count" style="width: 100%; padding: 10px;">';
                    }
                });
            </script>
            
            <div id="valueInfo" style="background: #e7f3ff; padding: 10px; border-radius: 4px; margin-bottom: 15px; display: none;">
                For numeric values (Doctor Count), enter a number. For Yes/No fields, select from the dropdown.
            </div>
            
            <div class="button-group">
                <button class="cancel-btn" onclick="closeBulkEditModal()">Cancel</button>
                <button class="save-btn" onclick="applyBulkEdit()">Apply to Selected</button>
            </div>
        </div>
    </div>

    <!-- Edit Modal -->
    <div id="editModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2>Edit Clinic</h2>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <div class="clinic-info">
                <p><strong id="clinicName"></strong></p>
                <p id="clinicChain"></p>
                <p id="clinicLocation"></p>
            </div>
            
            <div class="form-group">
                <label>Billing</label>
                <select id="billing">
                    <option value="">-</option>
                    <option value="Bulk Billing">Bulk Billing</option>
                    <option value="Mixed Billing">Mixed Billing</option>
                    <option value="Private Billing">Private Billing</option>
                </select>
            </div>
            
            <div class="form-group">
                <label>Doctor Count</label>
                <input type="number" id="doctorCount" min="0" step="1" placeholder="0">
            </div>
            
            <div class="form-group">
                <label>Pathology</label>
                <select id="pathology">
                    <option value="">-</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                </select>
            </div>
            
            <div class="form-group">
                <label>Radiology/Imaging</label>
                <select id="radiology">
                    <option value="">-</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                </select>
            </div>
            
            <div class="form-group">
                <label>Allied Health</label>
                <select id="alliedHealth">
                    <option value="">-</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                </select>
            </div>
            
            <div class="form-group">
                <label>Website Issue (can't scrape doctors)</label>
                <select id="websiteIssue">
                    <option value="">-</option>
                    <option value="Yes">Yes - Bot Protection/JS Required</option>
                    <option value="No">No</option>
                </select>
            </div>

            <div class="form-group">
                <label>URL</label>
                <input type="url" id="url" placeholder="https://..." style="width: 100%; padding: 10px;">
            </div>

            <div class="button-group">
                <button class="delete-btn" onclick="deleteClinic()">🗑️ Delete Clinic</button>
                <div class="button-group-right">
                    <button class="cancel-btn" onclick="closeModal()">Cancel</button>
                    <button class="save-btn" onclick="saveClinic()">Save</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        let currentEditIndex = null;

        function filterTable() {
            const searchInput = document.getElementById("search");
            const chainSelect = document.getElementById("chainFilter");
            const completeSelect = document.getElementById("completeFilter");
            const searchFilter = searchInput.value.toLowerCase();
            const chainFilter = chainSelect.value.toLowerCase();
            const completeFilter = completeSelect.value;
            const table = document.getElementById("dataTable");
            const rows = table.getElementsByTagName("tr");
            
            for (let i = 1; i < rows.length; i++) {
                const cells = rows[i].getElementsByTagName("td");
                const clinicName = cells[0].textContent.toLowerCase();
                const corporateChain = cells[1].textContent.toLowerCase();
                const isComplete = rows[i].classList.contains('complete');
                
                const matchesSearch = clinicName.includes(searchFilter);
                const matchesChain = chainFilter === "" || corporateChain === chainFilter;
                const matchesComplete = 
                    completeFilter === "" ? true :
                    completeFilter === "complete" ? isComplete :
                    completeFilter === "incomplete" ? !isComplete : true;
                
                rows[i].style.display = (matchesSearch && matchesChain && matchesComplete) ? "" : "none";
            }
        }

        function editClinic(index) {
            currentEditIndex = index;
            const table = document.getElementById("dataTable");
            const rows = table.getElementsByTagName("tbody")[0].getElementsByTagName("tr");

            if (index < rows.length) {
                const cells = rows[index].getElementsByTagName("td");
                const clinicName = cells[1].textContent;
                const chain = cells[2].textContent;
                const location = cells[3].textContent;

                // Extract URL from href attribute in the link
                const urlCell = cells[4];
                const link = urlCell.querySelector("a");
                const url = link ? link.getAttribute("href") : "";

                const billing = cells[5].textContent;
                const doctorCount = cells[7].textContent;
                const pathology = cells[8].textContent;
                const radiology = cells[9].textContent;
                const alliedHealth = cells[10].textContent;

                document.getElementById("clinicName").textContent = clinicName;
                document.getElementById("clinicChain").textContent = "Chain: " + chain;
                document.getElementById("clinicLocation").textContent = "Location: " + location;

                document.getElementById("billing").value = billing === "-" ? "" : billing;
                document.getElementById("doctorCount").value = doctorCount === "0" ? "" : doctorCount;
                document.getElementById("pathology").value = pathology === "-" ? "" : pathology;
                document.getElementById("radiology").value = radiology === "-" ? "" : radiology;
                document.getElementById("alliedHealth").value = alliedHealth === "-" ? "" : alliedHealth;
                document.getElementById("url").value = url;

                const websiteIssue = cells[11].textContent;
                document.getElementById("websiteIssue").value = websiteIssue === "-" ? "" : websiteIssue;

                document.getElementById("editModal").classList.add("active");
            }
        }

        function closeModal() {
            document.getElementById("editModal").classList.remove("active");
            currentEditIndex = null;
        }

        function saveClinic() {
            const billing = document.getElementById("billing").value || null;
            const doctorCount = document.getElementById("doctorCount").value ? parseInt(document.getElementById("doctorCount").value) : null;
            const pathology = document.getElementById("pathology").value || null;
            const radiology = document.getElementById("radiology").value || null;
            const alliedHealth = document.getElementById("alliedHealth").value || null;
            const websiteIssue = document.getElementById("websiteIssue").value || null;
            const url = document.getElementById("url").value || null;

            fetch('/api/update-clinic', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    index: currentEditIndex,
                    billing: billing,
                    doctorCount: doctorCount,
                    pathology: pathology,
                    radiology: radiology,
                    alliedHealth: alliedHealth,
                    websiteIssue: websiteIssue,
                    url: url
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    alert("Clinic updated successfully!");
                    location.reload();
                } else {
                    alert("Error: " + data.error);
                }
            })
            .catch(error => {
                alert("Error saving: " + error);
            });
        }

        function deleteClinic() {
            const clinicName = document.getElementById("clinicName").textContent;
            if (confirm(`Are you sure you want to delete "${clinicName}"? This cannot be undone.`)) {
                fetch('/api/delete-clinic', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        index: currentEditIndex
                    })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        alert("Clinic deleted successfully!");
                        location.reload();
                    } else {
                        alert("Error: " + data.error);
                    }
                })
                .catch(error => {
                    alert("Error deleting: " + error);
                });
            }
        }

        // Save and load filters
        function saveFilters() {
            const search = document.getElementById("search").value;
            const chain = document.getElementById("chainFilter").value;
            const complete = document.getElementById("completeFilter").value;
            
            localStorage.setItem('searchFilter', search);
            localStorage.setItem('chainFilter', chain);
            localStorage.setItem('completeFilter', complete);
        }
        
        function loadFilters() {
            const search = localStorage.getItem('searchFilter') || '';
            const chain = localStorage.getItem('chainFilter') || '';
            const complete = localStorage.getItem('completeFilter') || '';
            
            document.getElementById("search").value = search;
            document.getElementById("chainFilter").value = chain;
            document.getElementById("completeFilter").value = complete;
            
            filterTable();
        }
        
        // Load filters on page load
        window.addEventListener('load', loadFilters);

        // Inline editing for cells
        let editingCell = null;
        
        function editCell(event, index, field) {
            event.stopPropagation();
            
            // Don't edit if already editing
            if (editingCell) return;
            
            const cell = event.target;
            const currentValue = cell.textContent.trim();
            editingCell = cell;
            
            // Create select dropdown
            const select = document.createElement('select');
            select.className = 'cell-edit';
            select.style.width = '100%';
            
            if (field === 'websiteIssue') {
                select.innerHTML = `
                    <option value="">-</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                `;
            } else {
                select.innerHTML = `
                    <option value="">-</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                `;
            }
            select.value = currentValue === '-' ? '' : currentValue;
            
            // Store original content
            const originalContent = cell.innerHTML;
            
            // Replace cell content
            cell.innerHTML = '';
            cell.appendChild(select);
            
            // Open dropdown and focus
            setTimeout(() => {
                select.click();
                select.focus();
            }, 0);
            
            // Handle change
            select.addEventListener('change', (e) => {
                e.stopPropagation();
                const newValue = select.value || null;
                saveInlineEdit(index, field, newValue);
            }, {once: true});
            
            // Handle escape
            select.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    cell.innerHTML = originalContent;
                    editingCell = null;
                }
            });
            
            // Handle blur - but give time for click
            select.addEventListener('blur', () => {
                setTimeout(() => {
                    if (editingCell === cell) {
                        cell.innerHTML = originalContent;
                        editingCell = null;
                    }
                }, 200);
            });
        }
        
        function saveInlineEdit(index, field, value) {
            const data = {};
            data[field] = value;
            data['index'] = index;
            
            fetch('/api/update-clinic', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            })
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    location.reload();
                } else {
                    alert('Error saving: ' + result.error);
                    editingCell = null;
                }
            })
            .catch(error => {
                alert('Error: ' + error);
                editingCell = null;
            });
        }

        // Bulk edit functionality
        let bulkEditMode = false;
        
        function toggleBulkEdit() {
            bulkEditMode = !bulkEditMode;
            const checkboxes = document.querySelectorAll('.row-checkbox, #selectAll');
            const selectAllBtn = document.getElementById('selectAll');
            
            checkboxes.forEach(cb => {
                cb.style.display = bulkEditMode ? 'inline-block' : 'none';
            });
            
            if (bulkEditMode) {
                showBulkEditForm();
            } else {
                closeBulkEditModal();
            }
        }
        
        function toggleSelectAll() {
            const checkboxes = document.querySelectorAll('.row-checkbox');
            const selectAll = document.getElementById('selectAll');
            checkboxes.forEach(cb => {
                cb.checked = selectAll.checked;
            });
        }
        
        function showBulkEditForm() {
            document.getElementById('bulkEditModal').classList.add('active');
        }
        
        function closeBulkEditModal() {
            document.getElementById('bulkEditModal').classList.remove('active');
        }
        
        function applyBulkEdit() {
            const field = document.getElementById('bulkField').value;
            const value = document.getElementById('bulkValue').value;
            const checkboxes = document.querySelectorAll('.row-checkbox:checked');
            
            if (checkboxes.length === 0) {
                alert('Please select at least one clinic');
                return;
            }
            
            if (!field || !value) {
                alert('Please select a field and enter a value');
                return;
            }
            
            let count = 0;
            checkboxes.forEach(cb => {
                const index = parseInt(cb.getAttribute('data-index'));
                const data = {index: index};
                data[field] = value;
                
                fetch('/api/update-clinic', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(data)
                })
                .then(r => r.json())
                .then(d => {
                    count++;
                    if (count === checkboxes.length) {
                        alert(`Updated ${count} clinics`);
                        location.reload();
                    }
                });
            });
        }

        // Open URLs in a dedicated second window
        function openInSecondWindow(url) {
            // On Mac: try to position on secondary display
            // If this doesn't work, you can manually drag the window to your second monitor
            // Or adjust the left value based on your setup:
            //   - left=2560+ for displays to the right
            //   - left=-1920 for displays to the left
            const w = window.open(url, 'clinicWindow', 'width=1200,height=800,left=2560,top=0');
            
            // Try to move focus to the new window
            if (w) w.focus();
        }

        // Close modal when clicking outside
        window.onclick = function(event) {
            const modal = document.getElementById("editModal");
            if (event.target === modal) {
                closeModal();
            }
        }
    </script>
</body>
</html>
"""

def is_complete(row):
    """Check if row has all required data filled"""
    # If Website Issue = Yes, automatically mark as complete
    website_issue = pd.notna(row.get('Website Issue')) and row.get('Website Issue') == 'Yes'
    if website_issue:
        return True

    has_billing = pd.notna(row['Billing Type']) and row['Billing Type'] != ''
    has_pathology = pd.notna(row['Pathology']) and row['Pathology'] != ''
    has_radiology = pd.notna(row['Radiology/Imaging']) and row['Radiology/Imaging'] != ''
    has_allied = pd.notna(row['Allied Health']) and row['Allied Health'] != ''
    has_doctors = pd.notna(row['Doctor Count']) and row['Doctor Count'] > 0

    return has_billing and has_pathology and has_radiology and has_allied and has_doctors

@app.route('/')
def index():
    df = pd.read_csv(CSV_PATH)
    chains = sorted([c for c in df['Corporate Chain'].unique() if pd.notna(c)])
    
    complete_count = sum(1 for _, row in df.iterrows() if is_complete(row))
    
    return render_template_string(
        HTML_TEMPLATE,
        df=df,
        pd=pd,
        chains=chains,
        is_complete=is_complete,
        total_clinics=len(df),
        with_doctors=df['Doctor Names Clean'].notna().sum(),
        with_pathology=(df['Pathology'] == 'Yes').sum(),
        with_radiology=(df['Radiology/Imaging'] == 'Yes').sum(),
        with_allied=(df['Allied Health'] == 'Yes').sum(),
        complete_data=complete_count,
        now=pd.Timestamp.now().strftime('%Y-%m-%d %H:%M:%S')
    )

@app.route('/api/update-clinic', methods=['POST'])
def update_clinic():
    try:
        data = request.json
        index = data.get('index')
        
        df = pd.read_csv(CSV_PATH)
        row_index = df.index[index]
        
        # Update fields
        if data.get('billing'):
            df.at[row_index, 'Billing Type'] = data['billing']
        if data.get('doctorCount') is not None:
            df.at[row_index, 'Doctor Count'] = data['doctorCount']
        if data.get('pathology'):
            df.at[row_index, 'Pathology'] = data['pathology']
        if data.get('radiology'):
            df.at[row_index, 'Radiology/Imaging'] = data['radiology']
        if data.get('alliedHealth'):
            df.at[row_index, 'Allied Health'] = data['alliedHealth']
        if data.get('websiteIssue'):
            df.at[row_index, 'Website Issue'] = data['websiteIssue']
        if data.get('url'):
            df.at[row_index, 'URL'] = data['url']

        # Save
        df.to_csv(CSV_PATH, index=False)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/delete-clinic', methods=['POST'])
def delete_clinic():
    try:
        data = request.json
        index = data.get('index')
        
        df = pd.read_csv(CSV_PATH)
        row_index = df.index[index]
        
        # Delete row
        df = df.drop(row_index)
        df = df.reset_index(drop=True)
        
        # Save
        df.to_csv(CSV_PATH, index=False)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

if __name__ == '__main__':
    print("🌐 Starting CSV viewer on http://localhost:8000")
    print("📝 Click any row to edit or delete")
    print("🟢 Green rows = Complete data (all fields + Doctor Count > 0)")
    print("Press Ctrl+C to stop")
    app.run(debug=True, port=8000, use_reloader=True)
