(function () {
  'use strict';

  const root = document.getElementById('adminRoot');
  const toastEl = document.getElementById('adminToast');

  const CATEGORIES = [
    'Beds',
    'Sofas',
    'Almari / Wardrobes',
    'Chairs',
    'Dining Tables',
    'Dressing Tables',
    'TV Units',
    'Cabinets',
    'Office Furniture',
    'Other Furniture'
  ];

  const BOOKING_STATUSES = [
    'Pending',
    'Confirmed',
    'Processing',
    'Ready for Delivery',
    'Completed',
    'Cancelled'
  ];

  const adminState = {
    authenticated: false,
    username: '',
    activeTab: 'overview',
    stats: null,
    products: [],
    bookings: [],
    enquiries: [],
    bookingSearch: '',
    bookingStatusFilter: 'All',
    editingProductId: null
  };

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  function esc(val) {
    const div = document.createElement('div');
    div.textContent = val == null ? '' : String(val);
    return div.innerHTML;
  }

  function formatINR(num) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(num || 0);
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await res.json();
    if (res.status === 401 && adminState.authenticated) {
      adminState.authenticated = false;
      renderLogin('Session expired. Please log in again.');
      throw new Error('Session expired');
    }
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Request failed');
    }
    return data;
  }

  // ==========================================================================
  // LOGIN VIEW
  // ==========================================================================
  function renderLogin(errorMsg = '') {
    root.innerHTML = `
      <div style="min-height:100vh;display:grid;place-items:center;padding:20px;">
        <div class="clay-card" style="max-width:430px;width:100%;padding:34px;">
          <div style="width:56px;height:56px;border-radius:18px;background:linear-gradient(135deg,var(--orange),var(--coral));color:#fff;font-family:'Outfit',sans-serif;font-weight:800;font-size:1.35rem;display:grid;place-items:center;margin-bottom:16px;box-shadow:var(--clay-btn);">TG</div>
          <h1 style="font-size:1.65rem;margin-bottom:6px;">Admin Dashboard Login</h1>
          <p style="color:var(--brown-soft);font-size:0.92rem;margin-bottom:22px;">Taufeeq Gaadi Centre &amp; Furniture Management Portal</p>
          ${errorMsg ? `<div style="background:#FEE2E2;color:#991B1B;padding:11px 14px;border-radius:14px;font-size:0.88rem;font-weight:600;margin-bottom:16px;">${esc(errorMsg)}</div>` : ''}
          <form id="adminLoginForm" style="display:flex;flex-direction:column;gap:14px;">
            <div>
              <label style="display:block;font-size:0.84rem;font-weight:700;margin-bottom:5px;">Administrator Username</label>
              <input type="text" id="loginUsername" required autocomplete="username" placeholder="Enter admin username" />
            </div>
            <div>
              <label style="display:block;font-size:0.84rem;font-weight:700;margin-bottom:5px;">Password</label>
              <input type="password" id="loginPassword" required autocomplete="current-password" placeholder="Enter admin password" />
            </div>
            <button type="submit" id="loginSubmitBtn" class="btn-clay btn-primary" style="margin-top:6px;">Sign In Securely</button>
          </form>
          <div style="margin-top:20px;text-align:center;">
            <a href="/" style="color:var(--brown-soft);font-size:0.86rem;text-decoration:none;font-weight:600;">&larr; Back to Customer Storefront</a>
          </div>
        </div>
      </div>
    `;

    document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('loginSubmitBtn');
      const username = document.getElementById('loginUsername').value.trim();
      const password = document.getElementById('loginPassword').value;

      btn.disabled = true;
      btn.textContent = 'Authenticating...';
      try {
        const data = await api('/api/admin/login', {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });
        adminState.authenticated = true;
        adminState.username = data.username;
        toast('Welcome back, ' + data.username);
        await loadAllDashboardData();
      } catch (err) {
        renderLogin(err.message);
      }
    });
  }

  // ==========================================================================
  // DATA LOADING
  // ==========================================================================
  async function loadAllDashboardData() {
    try {
      const [ov, pr, bk, en] = await Promise.all([
        api('/api/admin/overview'),
        api('/api/admin/products'),
        api(`/api/admin/bookings?status=${encodeURIComponent(adminState.bookingStatusFilter)}&search=${encodeURIComponent(adminState.bookingSearch)}`),
        api('/api/admin/enquiries')
      ]);
      adminState.stats = ov.stats;
      adminState.products = pr.products;
      adminState.bookings = bk.bookings;
      adminState.enquiries = en.enquiries;
      renderDashboard();
    } catch (err) {
      if (adminState.authenticated) toast(err.message);
    }
  }

  // ==========================================================================
  // MAIN DASHBOARD RENDERER
  // ==========================================================================
  function renderDashboard() {
    root.innerHTML = `
      <div class="admin-topbar">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,var(--orange),var(--coral));color:#fff;font-family:'Outfit',sans-serif;font-weight:800;display:grid;place-items:center;">TG</div>
          <div>
            <strong style="display:block;font-size:1.05rem;">Taufeeq Gaadi Centre &amp; Furniture</strong>
            <span style="font-size:0.8rem;color:var(--brown-soft);">Logged in as <strong>${esc(adminState.username)}</strong></span>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <a href="/" target="_blank" class="btn-clay btn-ghost">View Live Site</a>
          <button type="button" id="logoutBtn" class="btn-clay btn-brown">Logout</button>
        </div>
      </div>

      <div class="admin-container">
        <div class="tabs">
          <button class="tab-btn ${adminState.activeTab === 'overview' ? 'active' : ''}" data-tab="overview">Dashboard Overview</button>
          <button class="tab-btn ${adminState.activeTab === 'products' ? 'active' : ''}" data-tab="products">Products (${adminState.products.length})</button>
          <button class="tab-btn ${adminState.activeTab === 'bookings' ? 'active' : ''}" data-tab="bookings">Bookings (${adminState.bookings.length})</button>
          <button class="tab-btn ${adminState.activeTab === 'enquiries' ? 'active' : ''}" data-tab="enquiries">Enquiries (${adminState.enquiries.length})</button>
        </div>

        <div id="tabContent"></div>
      </div>

      <div class="modal-backdrop" id="adminModal">
        <div class="clay-card modal-box" id="adminModalBody"></div>
      </div>
    `;

    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await fetch('/api/admin/logout', { method: 'POST' });
      adminState.authenticated = false;
      renderLogin('You have been logged out.');
    });

    root.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.activeTab = btn.getAttribute('data-tab');
        renderDashboard();
      });
    });

    document.getElementById('adminModal').addEventListener('click', (e) => {
      if (e.target.id === 'adminModal') e.currentTarget.classList.remove('open');
    });

    const container = document.getElementById('tabContent');
    if (adminState.activeTab === 'overview') renderOverviewTab(container);
    else if (adminState.activeTab === 'products') renderProductsTab(container);
    else if (adminState.activeTab === 'bookings') renderBookingsTab(container);
    else if (adminState.activeTab === 'enquiries') renderEnquiriesTab(container);
  }

  // ==========================================================================
  // TAB 1: OVERVIEW
  // ==========================================================================
  function renderOverviewTab(container) {
    const s = adminState.stats || {
      totalProducts: 0,
      totalBookings: 0,
      pendingBookings: 0,
      confirmedBookings: 0,
      completedBookings: 0,
      totalEnquiries: 0,
      categoryBreakdown: []
    };

    const maxCat = Math.max(1, ...s.categoryBreakdown.map((c) => c.count));

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card" style="background:linear-gradient(135deg,#F97316,#FB7185);">
          <div style="font-size:0.85rem;opacity:0.9;">Total Products</div>
          <div style="font-size:2.1rem;font-weight:800;font-family:'Outfit',sans-serif;">${s.totalProducts}</div>
        </div>
        <div class="stat-card" style="background:linear-gradient(135deg,#0D9488,#14B8A6);">
          <div style="font-size:0.85rem;opacity:0.9;">Total Bookings</div>
          <div style="font-size:2.1rem;font-weight:800;font-family:'Outfit',sans-serif;">${s.totalBookings}</div>
        </div>
        <div class="stat-card" style="background:linear-gradient(135deg,#F59E0B,#FBBF24);color:#3E2723;">
          <div style="font-size:0.85rem;font-weight:700;">Pending Bookings</div>
          <div style="font-size:2.1rem;font-weight:800;font-family:'Outfit',sans-serif;">${s.pendingBookings}</div>
        </div>
        <div class="stat-card" style="background:linear-gradient(135deg,#2563EB,#3B82F6);">
          <div style="font-size:0.85rem;opacity:0.9;">Confirmed Bookings</div>
          <div style="font-size:2.1rem;font-weight:800;font-family:'Outfit',sans-serif;">${s.confirmedBookings}</div>
        </div>
        <div class="stat-card" style="background:linear-gradient(135deg,#16A34A,#22C55E);">
          <div style="font-size:0.85rem;opacity:0.9;">Completed Bookings</div>
          <div style="font-size:2.1rem;font-weight:800;font-family:'Outfit',sans-serif;">${s.completedBookings}</div>
        </div>
        <div class="stat-card" style="background:linear-gradient(135deg,#5D4037,#3E2723);">
          <div style="font-size:0.85rem;opacity:0.9;">Customer Enquiries</div>
          <div style="font-size:2.1rem;font-weight:800;font-family:'Outfit',sans-serif;">${s.totalEnquiries}</div>
        </div>
      </div>

      <div class="clay-card">
        <h3 style="margin-bottom:16px;">Catalog Distribution by Category</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          ${s.categoryBreakdown.length === 0 ? '<p>No products categorized yet.</p>' : s.categoryBreakdown.map((item) => {
            const pct = Math.round((item.count / maxCat) * 100);
            return `
              <div>
                <div style="display:flex;justify-content:space-between;font-size:0.9rem;font-weight:700;margin-bottom:4px;">
                  <span>${esc(item._id)}</span>
                  <span>${item.count} item(s)</span>
                </div>
                <div style="height:12px;background:#F3E5D8;border-radius:999px;overflow:hidden;">
                  <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,var(--orange),var(--teal));border-radius:999px;"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // TAB 2: PRODUCT MANAGEMENT
  // ==========================================================================
  function renderProductsTab(container) {
    container.innerHTML = `
      <div class="clay-card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
          <div>
            <h2>Furniture Catalog Management</h2>
            <p style="color:var(--brown-soft);font-size:0.9rem;">Add new furniture, replace sample items, update pricing, or toggle availability.</p>
          </div>
          <button type="button" id="addNewProductBtn" class="btn-clay btn-primary">+ Add Furniture Product</button>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Price</th>
                <th>Status</th>
                <th>Tags</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${adminState.products.map((p) => {
                const thumb = (p.images && p.images[0]) || '';
                return `
                  <tr>
                    <td>
                      <div style="display:flex;align-items:center;gap:12px;">
                        <img src="${esc(thumb)}" alt="" style="width:52px;height:52px;border-radius:12px;object-fit:cover;background:#eee;" />
                        <div>
                          <strong>${esc(p.name)}</strong>
                          ${p.isSample ? '<span class="badge badge-Pending" style="margin-left:6px;">Sample</span>' : ''}
                          <div style="font-size:0.8rem;color:var(--brown-soft);">${esc(p.material || '')}</div>
                        </div>
                      </div>
                    </td>
                    <td>${esc(p.category)}</td>
                    <td>
                      <strong>${formatINR(p.price)}</strong>
                      ${p.discountPercent > 0 ? `<div style="font-size:0.78rem;color:var(--orange-dark);">${p.discountPercent}% off</div>` : ''}
                    </td>
                    <td>
                      <span class="badge ${p.inStock ? 'badge-Completed' : 'badge-Cancelled'}">${p.inStock ? 'In Stock' : 'Out of Stock'}</span>
                    </td>
                    <td>
                      ${p.featured ? '<span class="badge badge-Confirmed">Featured</span>' : ''}
                    </td>
                    <td>
                      <div style="display:flex;gap:8px;">
                        <button type="button" class="btn-clay btn-ghost edit-prod-btn" data-id="${esc(p._id)}" style="padding:7px 13px;font-size:0.84rem;">Edit</button>
                        <button type="button" class="btn-clay btn-danger del-prod-btn" data-id="${esc(p._id)}" style="padding:7px 13px;font-size:0.84rem;">Delete</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('addNewProductBtn').addEventListener('click', () => openProductFormModal(null));

    container.querySelectorAll('.edit-prod-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const prod = adminState.products.find((p) => p._id === btn.getAttribute('data-id'));
        if (prod) openProductFormModal(prod);
      });
    });

    container.querySelectorAll('.del-prod-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this product permanently from MongoDB?')) return;
        try {
          await api('/api/admin/products/' + btn.getAttribute('data-id'), { method: 'DELETE' });
          toast('Product deleted.');
          await loadAllDashboardData();
        } catch (err) {
          toast(err.message);
        }
      });
    });
  }

  function openProductFormModal(product) {
    const modal = document.getElementById('adminModal');
    const body = document.getElementById('adminModalBody');
    const isEdit = Boolean(product);

    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
        <h2>${isEdit ? 'Edit Furniture Product' : 'Add New Furniture Product'}</h2>
        <button type="button" id="closeProdModal" class="btn-clay btn-ghost" style="padding:8px 14px;">&#10005;</button>
      </div>
      <form id="productCrudForm" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div style="grid-column:span 2;">
          <label style="font-size:0.84rem;font-weight:700;">Product Name *</label>
          <input type="text" id="pName" required value="${esc(product?.name || '')}" />
        </div>
        <div>
          <label style="font-size:0.84rem;font-weight:700;">Category *</label>
          <select id="pCategory" required>
            ${CATEGORIES.map((c) => `<option value="${esc(c)}" ${product?.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.84rem;font-weight:700;">Price (INR) *</label>
          <input type="number" id="pPrice" min="0" required value="${product?.price ?? ''}" />
        </div>
        <div>
          <label style="font-size:0.84rem;font-weight:700;">Discount (%)</label>
          <input type="number" id="pDiscount" min="0" max="90" value="${product?.discountPercent ?? 0}" />
        </div>
        <div>
          <label style="font-size:0.84rem;font-weight:700;">Material</label>
          <input type="text" id="pMaterial" value="${esc(product?.material || 'Seasoned Teak Wood')}" />
        </div>
        <div>
          <label style="font-size:0.84rem;font-weight:700;">Sizes (comma separated)</label>
          <input type="text" id="pSizes" value="${esc((product?.sizes || ['Standard']).join(', '))}" />
        </div>
        <div>
          <label style="font-size:0.84rem;font-weight:700;">Colours (comma separated)</label>
          <input type="text" id="pColors" value="${esc((product?.colors || ['Royal Walnut', 'Natural Teak']).join(', '))}" />
        </div>
        <div style="grid-column:span 2;">
          <label style="font-size:0.84rem;font-weight:700;">Image URLs (one per line or comma-separated) *</label>
          <textarea id="pImages" rows="3" required placeholder="https://example.com/furniture1.jpg">${esc((product?.images || []).join('\n'))}</textarea>
        </div>
        <div style="grid-column:span 2;">
          <label style="font-size:0.84rem;font-weight:700;">Description *</label>
          <textarea id="pDescription" rows="3" required>${esc(product?.description || '')}</textarea>
        </div>
        <div style="grid-column:span 2;display:flex;gap:20px;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="pInStock" style="width:auto;" ${product ? (product.inStock ? 'checked' : '') : 'checked'} />
            <span>Available In Stock</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="pFeatured" style="width:auto;" ${product?.featured ? 'checked' : ''} />
            <span>Featured Product</span>
          </label>
        </div>
        <div style="grid-column:span 2;">
          <button type="submit" class="btn-clay btn-primary" style="width:100%;">${isEdit ? 'Save Product Changes' : 'Create Product'}</button>
        </div>
      </form>
    `;

    modal.classList.add('open');
    document.getElementById('closeProdModal').onclick = () => modal.classList.remove('open');

    document.getElementById('productCrudForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        name: document.getElementById('pName').value.trim(),
        category: document.getElementById('pCategory').value,
        price: Number(document.getElementById('pPrice').value),
        discountPercent: Number(document.getElementById('pDiscount').value || 0),
        material: document.getElementById('pMaterial').value.trim(),
        sizes: document.getElementById('pSizes').value,
        colors: document.getElementById('pColors').value,
        images: document.getElementById('pImages').value,
        description: document.getElementById('pDescription').value.trim(),
        inStock: document.getElementById('pInStock').checked,
        featured: document.getElementById('pFeatured').checked
      };

      try {
        if (isEdit) {
          await api('/api/admin/products/' + product._id, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
          toast('Product updated in MongoDB.');
        } else {
          await api('/api/admin/products', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          toast('New product added to catalog.');
        }
        modal.classList.remove('open');
        await loadAllDashboardData();
      } catch (err) {
        toast(err.message);
      }
    });
  }

  // ==========================================================================
  // TAB 3: BOOKING MANAGEMENT
  // ==========================================================================
  function renderBookingsTab(container) {
    container.innerHTML = `
      <div class="clay-card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:18px;">
          <h2>Customer Furniture Bookings</h2>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <input type="search" id="adminBookingSearch" value="${esc(adminState.bookingSearch)}" placeholder="Search Booking ID or Name..." style="width:240px;" />
            <select id="adminBookingStatus" style="width:190px;">
              <option value="All">All Statuses</option>
              ${BOOKING_STATUSES.map((st) => `<option value="${esc(st)}" ${adminState.bookingStatusFilter === st ? 'selected' : ''}>${esc(st)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Booking ID</th>
                <th>Customer</th>
                <th>Furniture &amp; Specs</th>
                <th>Delivery Location</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${adminState.bookings.length === 0 ? '<tr><td colspan="6" style="text-align:center;">No bookings match your criteria.</td></tr>' : adminState.bookings.map((b) => `
                <tr>
                  <td>
                    <strong>${esc(b.bookingId)}</strong>
                    <div style="font-size:0.78rem;color:var(--brown-soft);">${new Date(b.createdAt).toLocaleDateString('en-IN')}</div>
                  </td>
                  <td>
                    <strong>${esc(b.customerName)}</strong>
                    <div style="font-size:0.82rem;">Mob: ${esc(b.mobileNumber)}</div>
                    <div style="font-size:0.82rem;color:var(--teal);">WA: ${esc(b.whatsappNumber)}</div>
                  </td>
                  <td>
                    <strong>${esc(b.furnitureName)}</strong> (x${b.quantity})
                    <div style="font-size:0.8rem;color:var(--brown-soft);">Colour: ${esc(b.preferredColor)} | Size: ${esc(b.preferredSize)}</div>
                    ${b.unitPrice ? `<div style="font-size:0.82rem;font-weight:700;">Est: ${formatINR(b.unitPrice * b.quantity)}</div>` : ''}
                  </td>
                  <td>
                    <div>${esc(b.city)} - ${esc(b.pinCode)}</div>
                    <div style="font-size:0.8rem;color:var(--brown-soft);max-width:210px;">${esc(b.deliveryAddress)}</div>
                  </td>
                  <td>
                    <select class="status-select" data-id="${esc(b._id)}" style="padding:8px 10px;font-weight:700;">
                      ${BOOKING_STATUSES.map((st) => `<option value="${esc(st)}" ${b.status === st ? 'selected' : ''}>${esc(st)}</option>`).join('')}
                    </select>
                  </td>
                  <td>
                    <div style="display:flex;gap:6px;">
                      <button type="button" class="btn-clay btn-ghost view-bk-btn" data-id="${esc(b._id)}" style="padding:7px 11px;font-size:0.82rem;">Details</button>
                      <button type="button" class="btn-clay btn-danger del-bk-btn" data-id="${esc(b._id)}" style="padding:7px 11px;font-size:0.82rem;">Delete</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    let searchTimer;
    document.getElementById('adminBookingSearch').addEventListener('input', (e) => {
      adminState.bookingSearch = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadAllDashboardData, 300);
    });

    document.getElementById('adminBookingStatus').addEventListener('change', (e) => {
      adminState.bookingStatusFilter = e.target.value;
      loadAllDashboardData();
    });

    container.querySelectorAll('.status-select').forEach((sel) => {
      sel.addEventListener('change', async () => {
        try {
          await api('/api/admin/bookings/' + sel.getAttribute('data-id'), {
            method: 'PATCH',
            body: JSON.stringify({ status: sel.value })
          });
          toast('Booking status updated to ' + sel.value);
          await loadAllDashboardData();
        } catch (err) {
          toast(err.message);
        }
      });
    });

    container.querySelectorAll('.view-bk-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const b = adminState.bookings.find((item) => item._id === btn.getAttribute('data-id'));
        if (!b) return;
        const modal = document.getElementById('adminModal');
        const body = document.getElementById('adminModalBody');
        body.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <h2>Booking Details: ${esc(b.bookingId)}</h2>
            <button type="button" id="closeBkModal" class="btn-clay btn-ghost" style="padding:8px 14px;">&#10005;</button>
          </div>
          <div style="display:grid;gap:10px;font-size:0.95rem;">
            <div><strong>Status:</strong> ${esc(b.status)}</div>
            <div><strong>Customer Name:</strong> ${esc(b.customerName)}</div>
            <div><strong>Mobile Number:</strong> ${esc(b.mobileNumber)}</div>
            <div><strong>WhatsApp Number:</strong> ${esc(b.whatsappNumber)}</div>
            <div><strong>Selected Furniture:</strong> ${esc(b.furnitureName)} (Qty: ${b.quantity})</div>
            <div><strong>Preferred Colour:</strong> ${esc(b.preferredColor)}</div>
            <div><strong>Preferred Size:</strong> ${esc(b.preferredSize)}</div>
            <div><strong>Address:</strong> ${esc(b.deliveryAddress)}, ${esc(b.city)} - ${esc(b.pinCode)}</div>
            <div><strong>Customer Message:</strong> ${esc(b.message || 'None')}</div>
            <div><strong>Submitted On:</strong> ${new Date(b.createdAt).toLocaleString('en-IN')}</div>
          </div>
        `;
        modal.classList.add('open');
        document.getElementById('closeBkModal').onclick = () => modal.classList.remove('open');
      });
    });

    container.querySelectorAll('.del-bk-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this booking record permanently?')) return;
        try {
          await api('/api/admin/bookings/' + btn.getAttribute('data-id'), { method: 'DELETE' });
          toast('Booking deleted.');
          await loadAllDashboardData();
        } catch (err) {
          toast(err.message);
        }
      });
    });
  }

  // ==========================================================================
  // TAB 4: CUSTOMER ENQUIRIES
  // ==========================================================================
  function renderEnquiriesTab(container) {
    container.innerHTML = `
      <div class="clay-card">
        <h2 style="margin-bottom:16px;">Customer Enquiries</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Customer</th>
                <th>Phone</th>
                <th>Product</th>
                <th>Message</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${adminState.enquiries.length === 0 ? '<tr><td colspan="7" style="text-align:center;">No customer enquiries yet.</td></tr>' : adminState.enquiries.map((en) => `
                <tr>
                  <td>${new Date(en.createdAt).toLocaleDateString('en-IN')}</td>
                  <td><strong>${esc(en.customerName)}</strong></td>
                  <td>${esc(en.phoneNumber)}</td>
                  <td>${esc(en.productName)}</td>
                  <td style="max-width:280px;">${esc(en.message)}</td>
                  <td>
                    <select class="enq-status-select" data-id="${esc(en._id)}" style="padding:7px 10px;font-weight:700;">
                      ${['New', 'Contacted', 'Resolved'].map((st) => `<option value="${st}" ${en.status === st ? 'selected' : ''}>${st}</option>`).join('')}
                    </select>
                  </td>
                  <td>
                    <button type="button" class="btn-clay btn-danger del-enq-btn" data-id="${esc(en._id)}" style="padding:7px 12px;font-size:0.82rem;">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.querySelectorAll('.enq-status-select').forEach((sel) => {
      sel.addEventListener('change', async () => {
        try {
          await api('/api/admin/enquiries/' + sel.getAttribute('data-id'), {
            method: 'PATCH',
            body: JSON.stringify({ status: sel.value })
          });
          toast('Enquiry status updated.');
          await loadAllDashboardData();
        } catch (err) {
          toast(err.message);
        }
      });
    });

    container.querySelectorAll('.del-enq-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this enquiry?')) return;
        try {
          await api('/api/admin/enquiries/' + btn.getAttribute('data-id'), { method: 'DELETE' });
          toast('Enquiry deleted.');
          await loadAllDashboardData();
        } catch (err) {
          toast(err.message);
        }
      });
    });
  }

  // ==========================================================================
  // INITIALIZE ADMIN SESSION
  // ==========================================================================
  async function bootAdmin() {
    try {
      const res = await fetch('/api/admin/session');
      const data = await res.json();
      if (res.ok && data.authenticated) {
        adminState.authenticated = true;
        adminState.username = data.username;
        await loadAllDashboardData();
      } else {
        renderLogin();
      }
    } catch (_) {
      renderLogin();
    }
  }

  bootAdmin();
})();
