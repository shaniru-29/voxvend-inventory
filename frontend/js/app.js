// ─── CONFIG ───────────────────────────────
const API_BASE = 'https://voxvend-inventory.onrender.com/api';

let allSnacks = [];
let saleQty = 1;
let currentEditId = null;
let lowStockAlerted = false;

// ─── INIT ─────────────────────────────────
window.addEventListener('load', () => {
  setupNotifications();
  setTimeout(() => {
    document.getElementById('splash').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    loadDashboard();
    setInterval(checkLowStockSilently, 5 * 60 * 1000);
  }, 2500);
});

async function setupNotifications() {
  try {
    const { LocalNotifications } = window.Capacitor?.Plugins || {};
    if (!LocalNotifications) return;
    await LocalNotifications.requestPermissions();
  } catch (e) {
    console.log('Notifications not available:', e);
  }
}

async function checkLowStockSilently() {
  const stats = await api('/stats');
  if (stats && stats.low_stock_alerts.length > 0) {
    triggerLowStockAlert(stats.low_stock_alerts);
  }
}

// ─── NAVIGATION ───────────────────────────
function navigate(page, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  btn.classList.add('active');
  if (page === 'dashboard') loadDashboard();
  if (page === 'inventory') loadInventory();
  if (page === 'sale') loadSalePage();
  if (page === 'demographics') loadDemographics();
}

// ─── API HELPER ───────────────────────────
async function api(endpoint, method = 'GET', body = null) {
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
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
  if (navigator.vibrate) {
    navigator.vibrate([300, 100, 300, 100, 300]);
  }
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
    document.getElementById('low-stock-list').innerHTML = '<div class="empty-state">Could not load. Check connection.</div>';
    document.getElementById('best-sellers-list').innerHTML = '<div class="empty-state">No data</div>';
    return;
  }

  document.getElementById('stat-products').textContent = stats.total_products;
  document.getElementById('stat-sold').textContent = stats.total_sold;
  document.getElementById('stat-revenue').textContent = '₱' + Number(stats.total_revenue).toFixed(2);
  document.getElementById('stat-alerts').textContent = stats.low_stock_alerts.length;

  const badge = document.getElementById('alert-badge');
  const count = document.getElementById('alert-count');
  if (stats.low_stock_alerts.length > 0) {
    badge.style.display = 'flex';
    count.textContent = stats.low_stock_alerts.length;
    if (!lowStockAlerted) {
      lowStockAlerted = true;
      triggerLowStockAlert(stats.low_stock_alerts);
    }
  } else {
    badge.style.display = 'none';
  }

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
    lowStockAlerted = false;
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

// ─── RECORD SALE ──────────────────────────
async function loadSalePage() {
  const data = await api('/snacks');
  allSnacks = data || [];

  const sel = document.getElementById('sale-snack');
  sel.innerHTML = allSnacks.length === 0
    ? '<option>No snacks available</option>'
    : allSnacks.map(s =>
        `<option value="${s.id}" data-name="${s.name}" data-price="${s.price}" data-stock="${s.stock}">
          ${s.name} (Stock: ${s.stock}) - ₱${s.price}
        </option>`
      ).join('');

  saleQty = 1;
  document.getElementById('sale-qty-display').textContent = 1;
  updateSalePreview();
  loadRecentSales();
}

function changeSaleQty(delta) {
  saleQty = Math.max(1, saleQty + delta);
  document.getElementById('sale-qty-display').textContent = saleQty;
  updateSalePreview();
}

function updateSalePreview() {
  const sel = document.getElementById('sale-snack');
  if (!sel || !sel.options[sel.selectedIndex]) return;
  const opt = sel.options[sel.selectedIndex];
  const name = opt.dataset.name || opt.text;
  const price = parseFloat(opt.dataset.price) || 0;
  const stock = parseInt(opt.dataset.stock) || 0;
  const total = (price * saleQty).toFixed(2);
  const remaining = stock - saleQty;

  document.getElementById('sale-preview').innerHTML = `
    <div style="font-size:16px;">${name} × ${saleQty} = <b>₱${total}</b></div>
    <div style="font-size:12px;margin-top:4px;opacity:0.8;">
      Stock after sale: ${remaining >= 0 ? remaining : '❌ Not enough stock!'}
    </div>
  `;
}

async function confirmSale() {
  const sel = document.getElementById('sale-snack');
  const snack_id = sel.value;
  const opt = sel.options[sel.selectedIndex];
  const stock = parseInt(opt.dataset.stock) || 0;

  if (!snack_id) { showToast('Select a snack first', 'error'); return; }
  if (saleQty > stock) { showToast('❌ Not enough stock!', 'error'); return; }

  showToast('Recording sale...', '');

  const result = await api('/purchase', 'POST', {
    snack_id,
    quantity: saleQty
  });

  if (result) {
    showToast('✅ Sale recorded!', 'success');
    lowStockAlerted = false;
    saleQty = 1;
    document.getElementById('sale-qty-display').textContent = 1;

    // Show low stock warning if needed
    if (result.low_stock) {
      showToast(`⚠️ Low stock alert sent to Telegram!`, 'error');
    }

    await loadSalePage();
    await loadDashboard();
  } else {
    showToast('❌ Failed to record sale.', 'error');
  }
}

async function loadRecentSales() {
  const txns = await api('/transactions?limit=10');
  const el = document.getElementById('recent-sales-list');
  el.innerHTML = !txns || txns.length === 0
    ? '<div class="empty-state">No sales recorded yet</div>'
    : txns.map(t => `
        <div class="txn-item">
          <div>
            <div class="txn-name">${t.snack_name}</div>
            <div class="txn-meta">
              Qty: ${t.quantity} · ${t.timestamp ? new Date(t.timestamp).toLocaleString() : 'N/A'}
            </div>
          </div>
          <div class="txn-amount">₱${Number(t.total || 0).toFixed(2)}</div>
        </div>
      `).join('');
}

// ─── DEMOGRAPHICS ─────────────────────────
async function loadDemographics() {
  const data = await api('/demographics');

  if (!data) {
    ['peak-hour','peak-day','total-txns'].forEach(id => {
      document.getElementById(id).textContent = '--';
    });
    ['category-chart','top-snacks-list','daily-chart','hourly-chart','transactions-list'].forEach(id => {
      document.getElementById(id).innerHTML = '<div class="empty-state">No data yet</div>';
    });
    return;
  }

  const hour = parseInt(data.peak_hour);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  document.getElementById('peak-hour').textContent = `${h12}${ampm}`;
  document.getElementById('peak-day').textContent = data.peak_day || 'N/A';
  document.getElementById('total-txns').textContent = data.total_transactions || 0;

  renderChart('category-chart', data.category_sales, ICONS);

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

  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const dailyData = {};
  days.forEach(d => { dailyData[d] = data.daily_sales[d] || 0; });
  renderChart('daily-chart', dailyData, {});

  const hourlyData = {};
  for (let h = 6; h <= 22; h++) {
    const label = `${h % 12 || 12}${h >= 12 ? 'PM' : 'AM'}`;
    hourlyData[label] = data.hourly_sales[String(h)] || 0;
  }
  renderChart('hourly-chart', hourlyData, {});

  const txns = await api('/transactions?limit=20');
  const txnEl = document.getElementById('transactions-list');
  txnEl.innerHTML = !txns || txns.length === 0
    ? '<div class="empty-state">No transactions yet</div>'
    : txns.map(t => `
        <div class="txn-item">
          <div>
            <div class="txn-name">${t.snack_name}</div>
            <div class="txn-meta">
              Qty: ${t.quantity} · ${t.timestamp ? new Date(t.timestamp).toLocaleString() : 'N/A'}
            </div>
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
            <div class="chart-bar-fill" style="width:${Math.max((count/maxVal)*100, count > 0 ? 5 : 0)}%"></div>
          </div>
          <div class="chart-count">${count}</div>
        </div>
      `).join('');
}