// ─── CONFIG ───────────────────────────────
const API_BASE = 'http://10.16.7.230:5000/api';
// ⚠️ Change this IP if your Flask server IP changes!

let allSnacks = [];
let restockQty = 10;
let currentEditId = null;
let lowStockAlerted = false;

// ─── INIT ─────────────────────────────────
window.addEventListener('load', () => {
  setTimeout(() => {
    document.getElementById('splash').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    loadDashboard();
  }, 2500);
});

// ─── NAVIGATION ───────────────────────────
function navigate(page, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  btn.classList.add('active');
  if (page === 'dashboard') loadDashboard();
  if (page === 'inventory') loadInventory();
  if (page === 'restock') loadRestockPage();
  if (page === 'demographics') loadDemographics();
}

// ─── API HELPER ───────────────────────────
async function api(endpoint, method = 'GET', body = null) {
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API_BASE + endpoint, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (e) {
    console.error('API Error:', e.message);
    return null;
  }
}

// ─── TOAST ────────────────────────────────
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3000);
}

// ─── VIBRATE + SOUND ALERT ────────────────
function triggerLowStockAlert(items) {
  // Vibrate phone
  if (navigator.vibrate) {
    navigator.vibrate([300, 100, 300, 100, 300]);
  }

  // Play alert sound
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.3, 0.6].forEach(delay => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.25);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.25);
    });
  } catch (e) {
    console.log('Audio not supported');
  }

  // Show alert modal
  const body = document.getElementById('alert-modal-body');
  body.innerHTML = items.map(s => `
    <div class="alert-item" style="margin-bottom:8px;">
      <div>
        <div class="name">⚠️ ${s.name}</div>
        <div class="stock">Only ${s.stock} left — Threshold: ${s.threshold}</div>
      </div>
      <span style="color:var(--danger);font-weight:800;font-size:20px;">${s.stock}</span>
    </div>
  `).join('');
  document.getElementById('alert-modal').style.display = 'flex';
}

function closeAlertModal() {
  document.getElementById('alert-modal').style.display = 'none';
}

// ─── DASHBOARD ────────────────────────────
async function loadDashboard() {
  const stats = await api('/stats');
  if (!stats) {
    document.getElementById('stat-products').textContent = '0';
    document.getElementById('stat-sold').textContent = '0';
    document.getElementById('stat-revenue').textContent = '₱0';
    document.getElementById('stat-alerts').textContent = '0';
    document.getElementById('low-stock-list').innerHTML = '<div class="empty-state">Could not load data. Check connection.</div>';
    document.getElementById('best-sellers-list').innerHTML = '<div class="empty-state">No data</div>';
    return;
  }

  document.getElementById('stat-products').textContent = stats.total_products;
  document.getElementById('stat-sold').textContent = stats.total_sold;
  document.getElementById('stat-revenue').textContent = '₱' + Number(stats.total_revenue).toFixed(2);
  document.getElementById('stat-alerts').textContent = stats.low_stock_alerts.length;

  // Low stock badge
  const badge = document.getElementById('alert-badge');
  const count = document.getElementById('alert-count');
  if (stats.low_stock_alerts.length > 0) {
    badge.style.display = 'flex';
    count.textContent = stats.low_stock_alerts.length;

    // Trigger vibration + sound only once per session
    if (!lowStockAlerted) {
      lowStockAlerted = true;
      triggerLowStockAlert(stats.low_stock_alerts);
    }
  } else {
    badge.style.display = 'none';
  }

  // Low stock list
  const lowList = document.getElementById('low-stock-list');
  lowList.innerHTML = stats.low_stock_alerts.length === 0
    ? '<div class="empty-state">✅ All stocks are sufficient</div>'
    : stats.low_stock_alerts.map(s => `
        <div class="alert-item">
          <div>
            <div class="name">⚠️ ${s.name}</div>
            <div class="stock">Only ${s.stock} left (threshold: ${s.threshold})</div>
          </div>
          <span style="color:var(--danger);font-weight:800;font-size:22px;">${s.stock}</span>
        </div>
      `).join('');

  // Best sellers
  const sellerList = document.getElementById('best-sellers-list');
  const maxSold = stats.best_sellers[0]?.total_sold || 1;
  sellerList.innerHTML = stats.best_sellers.length === 0
    ? '<div class="empty-state">No sales data yet</div>'
    : stats.best_sellers.map((s, i) => `
        <div class="seller-item">
          <div class="seller-rank ${i === 0 ? 'gold' : ''}">${i + 1}</div>
          <div class="seller-info">
            <div class="seller-name">${s.name}</div>
            <div class="seller-sold">${s.total_sold} sold · ₱${s.price}</div>
            <div class="seller-bar">
              <div class="seller-bar-fill" style="width:${(s.total_sold / maxSold) * 100}%"></div>
            </div>
          </div>
        </div>
      `).join('');
}

// ─── INVENTORY ────────────────────────────
async function loadInventory() {
  const data = await api('/snacks');
  allSnacks = data || [];
  renderSnacks(allSnacks);
}

const ICONS = { chips:'🥔', cookies:'🍪', candy:'🍬', drinks:'🥤', nuts:'🥜', general:'📦' };

function renderSnacks(snacks) {
  const list = document.getElementById('snack-list');
  list.innerHTML = snacks.length === 0
    ? '<div class="empty-state">No snacks found. Add one!</div>'
    : snacks.map(s => `
        <div class="snack-card ${s.stock <= s.threshold ? 'low-stock' : ''}">
          <div class="snack-icon">${ICONS[s.category] || '📦'}</div>
          <div class="snack-info">
            <div class="snack-name">${s.name}</div>
            <div class="snack-meta">₱${s.price} · ${s.category} · Sold: ${s.total_sold}</div>
            <div class="snack-stock ${s.stock <= s.threshold ? 'low' : 'ok'}">
              Stock: ${s.stock} ${s.stock <= s.threshold ? '⚠️ Low!' : '✓'}
            </div>
          </div>
          <div class="snack-actions">
            <button class="icon-btn edit" onclick="openEditModal('${s.id}')">
              <i class="fas fa-edit"></i>
            </button>
            <button class="icon-btn delete" onclick="deleteSnack('${s.id}', '${s.name}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `).join('');
}

function filterSnacks() {
  const q = document.getElementById('search-input').value.toLowerCase();
  renderSnacks(allSnacks.filter(s =>
    s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
  ));
}

// ─── MODAL ────────────────────────────────
function openAddModal() {
  currentEditId = null;
  document.getElementById('modal-title').textContent = 'Add New Snack';
  document.getElementById('field-name').value = '';
  document.getElementById('field-category').value = 'chips';
  document.getElementById('field-price').value = '';
  document.getElementById('field-stock').value = '';
  document.getElementById('field-threshold').value = '10';
  document.getElementById('modal-overlay').style.display = 'flex';
}

function openEditModal(id) {
  const s = allSnacks.find(x => x.id === id);
  if (!s) return;
  currentEditId = id;
  document.getElementById('modal-title').textContent = 'Edit Snack';
  document.getElementById('field-name').value = s.name;
  document.getElementById('field-category').value = s.category;
  document.getElementById('field-price').value = s.price;
  document.getElementById('field-stock').value = s.stock;
  document.getElementById('field-threshold').value = s.threshold;
  document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
}

async function saveSnack() {
  const name = document.getElementById('field-name').value.trim();
  const category = document.getElementById('field-category').value;
  const price = parseFloat(document.getElementById('field-price').value);
  const stock = parseInt(document.getElementById('field-stock').value);
  const threshold = parseInt(document.getElementById('field-threshold').value);

  if (!name) { showToast('Please enter a snack name', 'error'); return; }
  if (isNaN(price) || price < 0) { showToast('Please enter a valid price', 'error'); return; }
  if (isNaN(stock) || stock < 0) { showToast('Please enter a valid stock', 'error'); return; }

  const data = { name, category, price, stock, threshold: isNaN(threshold) ? 10 : threshold };

  showToast('Saving...', '');

  const result = currentEditId
    ? await api('/snacks/' + currentEditId, 'PUT', data)
    : await api('/snacks', 'POST', data);

  if (result) {
    showToast(currentEditId ? '✅ Snack updated!' : '✅ Snack added!', 'success');
    closeModal();
    loadStockAlerted = false;
    await loadInventory();
    await loadDashboard();
  } else {
    showToast('❌ Failed to save. Check connection.', 'error');
  }
}

async function deleteSnack(id, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  const result = await api('/snacks/' + id, 'DELETE');
  if (result) {
    showToast('Deleted!', 'success');
    await loadInventory();
    await loadDashboard();
  } else {
    showToast('Failed to delete', 'error');
  }
}

// ─── RESTOCK ──────────────────────────────
async function loadRestockPage() {
  const data = await api('/snacks');
  allSnacks = data || [];

  const sel = document.getElementById('restock-snack');
  sel.innerHTML = allSnacks.length === 0
    ? '<option>No snacks found</option>'
    : allSnacks.map(s =>
        `<option value="${s.id}" data-name="${s.name}" data-stock="${s.stock}">
          ${s.name} (Current: ${s.stock})
        </option>`
      ).join('');

  restockQty = 10;
  document.getElementById('restock-qty-display').textContent = restockQty;
  updateRestockPreview();

  // Load restock history
  loadRestockHistory();
}

async function loadRestockHistory() {
  const data = await api('/snacks');
  // Show restock logs from Firestore if available
  const histEl = document.getElementById('restock-history');
  histEl.innerHTML = '<div class="empty-state">No restock history yet</div>';
}

function changeRestockQty(delta) {
  restockQty = Math.max(1, restockQty + delta);
  document.getElementById('restock-qty-display').textContent = restockQty;
  updateRestockPreview();
}

function updateRestockPreview() {
  const sel = document.getElementById('restock-snack');
  if (!sel || !sel.options[sel.selectedIndex]) return;
  const opt = sel.options[sel.selectedIndex];
  const name = opt.dataset.name || opt.text;
  const current = parseInt(opt.dataset.stock) || 0;
  document.getElementById('restock-preview').textContent =
    `${name}: ${current} → ${current + restockQty} units`;
}

async function confirmRestock() {
  const sel = document.getElementById('restock-snack');
  const snack_id = sel.value;
  if (!snack_id) { showToast('Select a snack first', 'error'); return; }

  showToast('Restocking...', '');
  const result = await api('/snacks/' + snack_id + '/restock', 'POST', { quantity: restockQty });

  if (result) {
    showToast('✅ Restocked successfully!', 'success');
    lowStockAlerted = false;
    await loadRestockPage();
    await loadDashboard();
  } else {
    showToast('❌ Restock failed. Check connection.', 'error');
  }
}

// ─── DEMOGRAPHICS ─────────────────────────
async function loadDemographics() {
  const data = await api('/demographics');

  if (!data) {
    document.getElementById('peak-hour').textContent = '--';
    document.getElementById('peak-day').textContent = '--';
    document.getElementById('total-txns').textContent = '0';
    document.getElementById('category-chart').innerHTML = '<div class="empty-state">No data yet</div>';
    document.getElementById('top-snacks-list').innerHTML = '<div class="empty-state">No data yet</div>';
    document.getElementById('daily-chart').innerHTML = '<div class="empty-state">No data yet</div>';
    document.getElementById('hourly-chart').innerHTML = '<div class="empty-state">No data yet</div>';
    document.getElementById('transactions-list').innerHTML = '<div class="empty-state">No transactions yet</div>';
    return;
  }

  // Peak info
  const hour = parseInt(data.peak_hour);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  document.getElementById('peak-hour').textContent = `${h12}${ampm}`;
  document.getElementById('peak-day').textContent = data.peak_day || 'N/A';
  document.getElementById('total-txns').textContent = data.total_transactions || 0;

  // Category chart
  renderChart('category-chart', data.category_sales, ICONS);

  // Top snacks
  const topEl = document.getElementById('top-snacks-list');
  const maxSold = data.top_snacks[0]?.sold || 1;
  topEl.innerHTML = data.top_snacks.length === 0
    ? '<div class="empty-state">No sales data yet</div>'
    : data.top_snacks.map((s, i) => `
        <div class="seller-item">
          <div class="seller-rank ${i === 0 ? 'gold' : ''}">${i + 1}</div>
          <div class="seller-info">
            <div class="seller-name">${s.name}</div>
            <div class="seller-sold">${s.sold} sold</div>
            <div class="seller-bar">
              <div class="seller-bar-fill" style="width:${(s.sold / maxSold) * 100}%"></div>
            </div>
          </div>
        </div>
      `).join('');

  // Daily chart
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dailyData = {};
  days.forEach(d => { dailyData[d] = data.daily_sales[d] || 0; });
  renderChart('daily-chart', dailyData, {});

  // Hourly chart (show only 6am-10pm)
  const hourlyData = {};
  for (let h = 6; h <= 22; h++) {
    const label = `${h % 12 || 12}${h >= 12 ? 'PM' : 'AM'}`;
    hourlyData[label] = data.hourly_sales[String(h)] || 0;
  }
  renderChart('hourly-chart', hourlyData, {});

  // Transactions
  const txns = await api('/transactions?limit=20');
  const txnEl = document.getElementById('transactions-list');
  txnEl.innerHTML = !txns || txns.length === 0
    ? '<div class="empty-state">No transactions yet</div>'
    : txns.map(t => `
        <div class="txn-item">
          <div>
            <div class="txn-name">${t.snack_name}</div>
            <div class="txn-meta">Qty: ${t.quantity} · ${t.timestamp ? new Date(t.timestamp).toLocaleString() : 'N/A'}</div>
          </div>
          <div class="txn-amount">₱${Number(t.total || 0).toFixed(2)}</div>
        </div>
      `).join('');
}

function renderChart(containerId, dataObj, icons) {
  const el = document.getElementById(containerId);
  const entries = Object.entries(dataObj);
  const maxVal = Math.max(...entries.map(e => e[1]), 1);

  el.innerHTML = entries.length === 0
    ? '<div class="empty-state">No data yet</div>'
    : entries.map(([label, count]) => `
        <div class="chart-bar-row">
          <div class="chart-label">${icons[label] || ''} ${label}</div>
          <div class="chart-bar-track">
            <div class="chart-bar-fill" style="width:${Math.max((count / maxVal) * 100, count > 0 ? 5 : 0)}%"></div>
          </div>
          <div class="chart-count">${count}</div>
        </div>
      `).join('');
}