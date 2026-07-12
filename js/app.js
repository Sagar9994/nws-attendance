/* ============================================================
   app.js — Main application controller, routing, auth
   NWS Soft Attendance System
   ============================================================ */

window.App = {
  currentPage: 'dashboard',
  isLoggedIn: false,
  modelsReady: false,
  capturedDescriptor: null, // Temporarily stores face descriptor during registration

  /* ---------- Initialization ---------- */
  async init() {
    this.showLoading('Syncing database...');
    
    // Connect to Supabase/localStorage and populate local cache
    await StorageManager.init();
    
    this.hideLoading();

    // Ensure default admin exists in the cache
    StorageManager.getAdmin();

    // Set up all event listeners
    this._setupEventListeners();

    // Show login page
    this._showLogin();

    // Start loading face-api models in background
    this._loadModels();

    // Start clock
    DashboardManager.startClock();

    // Periodically fetch database updates every 30 seconds
    setInterval(async () => {
      if (StorageManager.isCloudActive && this.isLoggedIn) {
        await StorageManager.syncFromCloud();
        FaceRecognition.buildFaceMatcher();
        if (this.currentPage === 'dashboard') {
          DashboardManager.refreshAll();
        } else if (this.currentPage === 'register') {
          DashboardManager.renderEmployeeList();
        } else if (this.currentPage === 'logs') {
          this._filterLogs();
        }
      }
    }, 30000);
  },

  /* ---------- Model Loading ---------- */
  async _loadModels() {
    const statusEl = document.getElementById('model-status');
    const statusText = statusEl ? statusEl.querySelector('.model-status-text') : null;

    if (statusEl) statusEl.className = 'model-status loading';

    const result = await FaceRecognition.loadModels((msg) => {
      if (statusText) statusText.textContent = msg;
    });

    if (result.success) {
      this.modelsReady = true;
      if (statusEl) statusEl.className = 'model-status ready';
      if (statusText) statusText.textContent = 'AI Ready';
    } else {
      if (statusEl) statusEl.className = 'model-status';
      if (statusText) statusText.textContent = 'Model load failed';
      this.showToast('Failed to load face recognition models. Some features may not work.', 'error');
    }
  },

  /* ---------- Event Listeners ---------- */
  _setupEventListeners() {
    // Login form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleLogin();
      });
    }

    // Sidebar navigation
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.addEventListener('click', () => {
        this.navigateTo(item.getAttribute('data-page'));
      });
    });

    // Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', () => this.handleLogout());

    // Mobile toggle
    const mobileToggle = document.getElementById('mobile-toggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (mobileToggle) {
      mobileToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
      });
    }
    if (overlay) {
      overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
      });
    }

    // --- Attendance Page ---
    const startCamBtn = document.getElementById('start-camera-btn');
    if (startCamBtn) startCamBtn.addEventListener('click', () => this.handleStartCamera('attendance'));

    const stopCamBtn = document.getElementById('stop-camera-btn');
    if (stopCamBtn) stopCamBtn.addEventListener('click', () => this.handleStopCamera('attendance'));

    // --- Register Page ---
    const regStartCam = document.getElementById('register-start-camera-btn');
    if (regStartCam) regStartCam.addEventListener('click', () => this.handleStartCamera('register'));

    const captureFaceBtn = document.getElementById('capture-face-btn');
    if (captureFaceBtn) captureFaceBtn.addEventListener('click', () => this.handleCaptureFace());

    const registerBtn = document.getElementById('register-btn');
    if (registerBtn) registerBtn.addEventListener('click', () => this.handleRegisterEmployee());

    const clearRegBtn = document.getElementById('clear-register-btn');
    if (clearRegBtn) clearRegBtn.addEventListener('click', () => this._clearRegisterForm());

    // Employee delete (event delegation)
    const employeeList = document.getElementById('employee-list');
    if (employeeList) {
      employeeList.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('[data-delete-id]');
        if (deleteBtn) {
          this.handleDeleteEmployee(deleteBtn.getAttribute('data-delete-id'));
        }
      });
    }

    // --- Logs Page ---
    const logDateFilter = document.getElementById('log-date-filter');
    if (logDateFilter) logDateFilter.addEventListener('change', () => this._filterLogs());

    const logSearch = document.getElementById('log-search');
    if (logSearch) logSearch.addEventListener('input', () => this._filterLogs());

    const exportCsvBtn = document.getElementById('export-csv-btn');
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => this.handleExportCSV());

    // --- Reports Page ---
    const genReportBtn = document.getElementById('generate-report-btn');
    if (genReportBtn) genReportBtn.addEventListener('click', () => this.handleGenerateReport());

    // --- Settings Page ---
    const changePwBtn = document.getElementById('change-password-btn');
    if (changePwBtn) changePwBtn.addEventListener('click', () => this.handleChangePassword());

    const saveSettingsBtn = document.getElementById('save-settings-btn');
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', () => this.handleSaveSettings());

    const backupBtn = document.getElementById('backup-btn');
    if (backupBtn) backupBtn.addEventListener('click', () => this.handleExportData());

    const restoreBtn = document.getElementById('restore-btn');
    if (restoreBtn) restoreBtn.addEventListener('click', () => {
      document.getElementById('restore-file-input').click();
    });

    const restoreFileInput = document.getElementById('restore-file-input');
    if (restoreFileInput) restoreFileInput.addEventListener('change', (e) => this.handleImportData(e));

    const clearDataBtn = document.getElementById('clear-data-btn');
    if (clearDataBtn) clearDataBtn.addEventListener('click', () => this.handleClearData());

    // Load saved settings into form
    this._loadSettingsForm();

    // Set default date filters
    const today = new Date().toISOString().split('T')[0];
    if (logDateFilter) logDateFilter.value = today;
    const reportFrom = document.getElementById('report-date-from');
    const reportTo = document.getElementById('report-date-to');
    if (reportTo) reportTo.value = today;
    if (reportFrom) {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 30);
      reportFrom.value = weekAgo.toISOString().split('T')[0];
    }
  },

  /* ---------- Auth ---------- */
  _showLogin() {
    document.getElementById('login-page').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
    this.isLoggedIn = false;
  },

  handleLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    if (!username || !password) {
      errorEl.textContent = 'Please enter username and password';
      return;
    }

    if (StorageManager.verifyPassword(username, password)) {
      this.isLoggedIn = true;
      document.getElementById('login-page').style.display = 'none';
      document.getElementById('app-container').style.display = 'flex';
      errorEl.textContent = '';

      // Reset form
      document.getElementById('login-username').value = '';
      document.getElementById('login-password').value = '';

      // Navigate to dashboard
      this.navigateTo('dashboard');
      this.showToast('Welcome back, Admin!', 'success');
    } else {
      errorEl.textContent = 'Invalid username or password';
      // Shake animation
      errorEl.style.animation = 'none';
      void errorEl.offsetHeight; // Reflow
      errorEl.style.animation = 'shake 0.4s ease';
    }
  },

  handleLogout() {
    // Stop all camera/scanning activity
    AttendanceManager.stopScanning();
    CameraManager.stopCamera();

    this._showLogin();
    this.showToast('Signed out successfully', 'info');
  },

  /* ---------- Navigation ---------- */
  navigateTo(page) {
    // Stop camera/scanning when leaving camera pages
    if (this.currentPage === 'attendance') {
      AttendanceManager.stopScanning();
      CameraManager.stopCamera(document.getElementById('attendance-video'));
      const statusEl = document.getElementById('attendance-status');
      if (statusEl) { statusEl.className = 'attendance-status idle'; statusEl.textContent = 'Start the camera to begin face recognition'; }
      const resultEl = document.getElementById('attendance-result');
      if (resultEl) resultEl.innerHTML = '';
      const liveInd = document.getElementById('attendance-live-indicator');
      if (liveInd) liveInd.style.display = 'none';
      const startBtn = document.getElementById('start-camera-btn');
      const stopBtn = document.getElementById('stop-camera-btn');
      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
    }
    if (this.currentPage === 'register') {
      CameraManager.stopCamera(document.getElementById('register-video'));
    }

    // Hide all pages
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));

    // Show target page
    const targetSection = document.getElementById('page-' + page);
    if (targetSection) targetSection.classList.add('active');

    // Update sidebar active state
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-page') === page);
    });

    // Update page title
    const titles = {
      dashboard: 'Dashboard',
      attendance: 'Mark Attendance',
      register: 'Register Employee',
      logs: 'Attendance Log',
      reports: 'Reports',
      settings: 'Settings'
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = titles[page] || page;

    this.currentPage = page;

    // Close mobile sidebar
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');

    // Page-specific initialization
    switch (page) {
      case 'dashboard':
        DashboardManager.refreshAll();
        break;
      case 'register':
        DashboardManager.renderEmployeeList();
        break;
      case 'logs':
        this._filterLogs();
        break;
      case 'attendance':
        AttendanceManager._refreshTodayTable();
        break;
      case 'settings':
        this._loadSettingsForm();
        break;
    }
  },

  /* ---------- Camera Handlers ---------- */
  async handleStartCamera(page) {
    const videoId = page === 'attendance' ? 'attendance-video' : 'register-video';
    const videoEl = document.getElementById(videoId);

    const result = await CameraManager.startCamera(videoEl);

    if (result.success) {
      if (page === 'attendance') {
        document.getElementById('start-camera-btn').disabled = true;
        document.getElementById('stop-camera-btn').disabled = false;
        document.getElementById('attendance-live-indicator').style.display = 'flex';

        // Set canvas dimensions
        const canvas = document.getElementById('attendance-canvas');
        canvas.width = videoEl.videoWidth || 640;
        canvas.height = videoEl.videoHeight || 480;

        // Start scanning
        if (this.modelsReady) {
          AttendanceManager.startScanning(
            videoEl,
            canvas,
            document.getElementById('attendance-status'),
            document.getElementById('attendance-result')
          );
        } else {
          const statusEl = document.getElementById('attendance-status');
          statusEl.className = 'attendance-status error';
          statusEl.textContent = 'Face recognition models still loading...';
        }
      } else if (page === 'register') {
        document.getElementById('capture-face-btn').disabled = false;
        // Set canvas dimensions
        const canvas = document.getElementById('register-canvas');
        canvas.width = videoEl.videoWidth || 480;
        canvas.height = videoEl.videoHeight || 360;
      }
    } else {
      this.showToast(result.message, 'error');
    }
  },

  handleStopCamera(page) {
    if (page === 'attendance') {
      AttendanceManager.stopScanning();
      CameraManager.stopCamera(document.getElementById('attendance-video'));
      FaceRecognition.clearCanvas(document.getElementById('attendance-canvas'));
      document.getElementById('start-camera-btn').disabled = false;
      document.getElementById('stop-camera-btn').disabled = true;
      document.getElementById('attendance-live-indicator').style.display = 'none';
      const statusEl = document.getElementById('attendance-status');
      statusEl.className = 'attendance-status idle';
      statusEl.textContent = 'Start the camera to begin face recognition';
      document.getElementById('attendance-result').innerHTML = '';
    } else if (page === 'register') {
      CameraManager.stopCamera(document.getElementById('register-video'));
      FaceRecognition.clearCanvas(document.getElementById('register-canvas'));
      document.getElementById('capture-face-btn').disabled = true;
    }
  },

  /* ---------- Face Capture for Registration ---------- */
  async handleCaptureFace() {
    const videoEl = document.getElementById('register-video');
    const canvasEl = document.getElementById('register-canvas');
    const statusEl = document.getElementById('face-capture-status');

    if (!this.modelsReady) {
      statusEl.className = 'face-capture-status error';
      statusEl.textContent = 'Face recognition models still loading...';
      return;
    }

    statusEl.className = 'face-capture-status';
    statusEl.textContent = 'Detecting face...';

    const detection = await FaceRecognition.detectFace(videoEl);

    if (detection) {
      this.capturedDescriptor = detection.descriptor;
      FaceRecognition.drawDetection(canvasEl, detection.detection, 'Face Captured ✓', true);
      statusEl.className = 'face-capture-status success';
      statusEl.textContent = '✓ Face captured successfully! Fill the form and click Register.';
      document.getElementById('register-btn').disabled = false;
    } else {
      this.capturedDescriptor = null;
      FaceRecognition.clearCanvas(canvasEl);
      statusEl.className = 'face-capture-status error';
      statusEl.textContent = '✗ No face detected. Please look directly at the camera and try again.';
      document.getElementById('register-btn').disabled = true;
    }
  },

  /* ---------- Employee Registration ---------- */
  handleRegisterEmployee() {
    const name = document.getElementById('register-name').value.trim();
    const id = document.getElementById('register-id').value.trim();
    const department = document.getElementById('register-department').value;
    const email = document.getElementById('register-email').value.trim();

    if (!name) { this.showToast('Please enter employee name', 'warning'); return; }
    if (!id) { this.showToast('Please enter employee ID', 'warning'); return; }
    if (!department) { this.showToast('Please select a department', 'warning'); return; }
    if (!this.capturedDescriptor) { this.showToast('Please capture a face first', 'warning'); return; }

    // Check if ID already exists
    const existing = StorageManager.getEmployee(id);
    if (existing) {
      // Add face sample to existing employee
      const descriptors = [...existing.faceDescriptor, this.capturedDescriptor];
      StorageManager.saveEmployee({ ...existing, faceDescriptor: descriptors });
      FaceRecognition.buildFaceMatcher();
      this.showToast(`Added face sample to ${existing.name} (${descriptors.length} samples)`, 'success');
    } else {
      // New employee
      const employee = {
        id,
        name,
        department,
        email,
        faceDescriptor: [this.capturedDescriptor],
        registeredAt: new Date().toISOString()
      };
      StorageManager.saveEmployee(employee);
      FaceRecognition.buildFaceMatcher();
      this.showToast(`${name} registered successfully!`, 'success');
    }

    this._clearRegisterForm();
    DashboardManager.renderEmployeeList();
    DashboardManager.updateStats();
  },

  _clearRegisterForm() {
    document.getElementById('register-name').value = '';
    document.getElementById('register-id').value = '';
    document.getElementById('register-department').value = '';
    document.getElementById('register-email').value = '';
    this.capturedDescriptor = null;
    document.getElementById('register-btn').disabled = true;
    const statusEl = document.getElementById('face-capture-status');
    if (statusEl) { statusEl.className = 'face-capture-status'; statusEl.textContent = ''; }
    const canvas = document.getElementById('register-canvas');
    if (canvas) FaceRecognition.clearCanvas(canvas);
  },

  handleDeleteEmployee(id) {
    const employee = StorageManager.getEmployee(id);
    if (!employee) return;

    this.showConfirm(
      'Delete Employee',
      `Are you sure you want to delete "${employee.name}"? This cannot be undone.`,
      () => {
        StorageManager.deleteEmployee(id);
        FaceRecognition.buildFaceMatcher();
        DashboardManager.renderEmployeeList();
        DashboardManager.updateStats();
        this.showToast(`${employee.name} deleted`, 'info');
      }
    );
  },

  /* ---------- Logs ---------- */
  _filterLogs() {
    const date = document.getElementById('log-date-filter').value;
    const search = document.getElementById('log-search').value.trim();
    DashboardManager.renderAttendanceLog({ date: date || undefined, search: search || undefined });
  },

  handleExportCSV() {
    const date = document.getElementById('log-date-filter').value;
    const search = document.getElementById('log-search').value.trim();
    const records = StorageManager.getAttendance({ date: date || undefined, search: search || undefined });
    AttendanceManager.exportToCSV(records);
  },

  /* ---------- Reports ---------- */
  handleGenerateReport() {
    const dateFrom = document.getElementById('report-date-from').value;
    const dateTo = document.getElementById('report-date-to').value;
    const department = document.getElementById('report-department-filter').value;

    if (!dateFrom || !dateTo) {
      this.showToast('Please select both start and end dates', 'warning');
      return;
    }

    DashboardManager.generateReport(dateFrom, dateTo, department || null);
    this.showToast('Report generated', 'success');
  },

  /* ---------- Settings ---------- */
  _loadSettingsForm() {
    const settings = StorageManager.getSettings();
    const setVal = (id, val) => { const e = document.getElementById(id); if (e) e.value = val; };
    setVal('office-start-time', settings.officeStartTime);
    setVal('office-end-time', settings.officeEndTime);
    setVal('late-threshold', settings.lateThreshold);
  },

  async handleChangePassword() {
    const current = document.getElementById('current-password').value;
    const newPw = document.getElementById('new-password').value;
    const confirm = document.getElementById('confirm-password').value;

    if (!current || !newPw || !confirm) {
      this.showToast('Please fill all password fields', 'warning');
      return;
    }
    if (newPw !== confirm) {
      this.showToast('New passwords do not match', 'error');
      return;
    }
    if (newPw.length < 4) {
      this.showToast('Password must be at least 4 characters', 'warning');
      return;
    }

    this.showLoading('Updating password...');
    const result = await StorageManager.changePassword(current, newPw);
    this.hideLoading();

    if (result.success) {
      this.showToast(result.message, 'success');
      document.getElementById('current-password').value = '';
      document.getElementById('new-password').value = '';
      document.getElementById('confirm-password').value = '';
    } else {
      this.showToast(result.message, 'error');
    }
  },

  handleSaveSettings() {
    const officeStartTime = document.getElementById('office-start-time').value;
    const officeEndTime = document.getElementById('office-end-time').value;
    const lateThreshold = parseInt(document.getElementById('late-threshold').value) || 15;

    StorageManager.saveSettings({ officeStartTime, officeEndTime, lateThreshold });
    this.showToast('Settings saved successfully', 'success');
  },

  /* ---------- Data Management ---------- */
  handleExportData() {
    StorageManager.downloadBackup();
    this.showToast('Backup downloaded — save to Google Drive or commit to Git', 'success');
  },

  handleImportData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = StorageManager.importAllData(e.target.result);
      if (result.success) {
        this.showToast(result.message, 'success');
        FaceRecognition.buildFaceMatcher();
        DashboardManager.refreshAll();
      } else {
        this.showToast(result.message, 'error');
      }
      event.target.value = ''; // Reset file input
    };
    reader.readAsText(file);
  },

  handleClearData() {
    this.showConfirm(
      'Clear All Data',
      'This will permanently delete ALL employees, attendance records, and settings. This cannot be undone!',
      () => {
        StorageManager.clearAllData();
        StorageManager.getAdmin(); // Recreate default admin
        FaceRecognition.buildFaceMatcher();
        DashboardManager.refreshAll();
        DashboardManager.renderEmployeeList();
        this.showToast('All data cleared', 'info');
      }
    );
  },

  /* ---------- Toast Notifications ---------- */
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = {
      success: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
      error: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
      warning: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>',
      info: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message">${message}</span>
      <div class="toast-progress"></div>
    `;

    toast.addEventListener('click', () => {
      toast.classList.add('dismissing');
      setTimeout(() => toast.remove(), 300);
    });

    container.appendChild(toast);

    // Auto dismiss after 4 seconds
    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add('dismissing');
        setTimeout(() => toast.remove(), 300);
      }
    }, 4000);
  },

  /* ---------- Confirm Dialog ---------- */
  showConfirm(title, message, onConfirm) {
    const overlay = document.getElementById('confirm-overlay');
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-message');
    const cancelBtn = document.getElementById('confirm-cancel-btn');
    const okBtn = document.getElementById('confirm-ok-btn');

    titleEl.textContent = title;
    msgEl.textContent = message;
    overlay.classList.remove('hidden');

    const cleanup = () => {
      overlay.classList.add('hidden');
      cancelBtn.replaceWith(cancelBtn.cloneNode(true));
      okBtn.replaceWith(okBtn.cloneNode(true));
    };

    document.getElementById('confirm-cancel-btn').addEventListener('click', cleanup);
    document.getElementById('confirm-ok-btn').addEventListener('click', () => {
      cleanup();
      onConfirm();
    });
  },

  /* ---------- Loading Overlay ---------- */
  showLoading(message) {
    const overlay = document.getElementById('loading-overlay');
    const textEl = document.getElementById('loading-text');
    if (overlay) overlay.classList.remove('hidden');
    if (textEl) textEl.textContent = message || 'Loading...';
  },

  hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('hidden');
  },

  /* ---------- Utility Formatters ---------- */
  formatTime(date) {
    return new Date(date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  },

  formatDate(date) {
    return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  },

  formatDateTime(date) {
    return this.formatDate(date) + ' ' + this.formatTime(date);
  }
};

/* ---------- Boot ---------- */
document.addEventListener('DOMContentLoaded', () => App.init());
