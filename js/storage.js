/* ============================================================
   storage.js — LocalStorage abstraction with export/import
   NWS Soft Attendance System
   ============================================================ */

window.StorageManager = {
  KEYS: {
    ADMIN: 'nws_admin',
    EMPLOYEES: 'nws_employees',
    ATTENDANCE: 'nws_attendance',
    SETTINGS: 'nws_settings'
  },

  /* ---------- Helpers ---------- */
  _get(key) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch { return null; }
  },

  _set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },

  hashPassword(password) {
    // djb2 hash — simple, synchronous
    let hash = 5381;
    for (let i = 0; i < password.length; i++) {
      hash = ((hash << 5) + hash) + password.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit int
    }
    return 'djb2_' + Math.abs(hash).toString(36);
  },

  /* ---------- Admin Management ---------- */
  getAdmin() {
    let admin = this._get(this.KEYS.ADMIN);
    if (!admin) {
      // Create default admin
      admin = {
        username: 'admin',
        passwordHash: this.hashPassword('admin123')
      };
      this._set(this.KEYS.ADMIN, admin);
    }
    return admin;
  },

  setAdmin(username, passwordHash) {
    this._set(this.KEYS.ADMIN, { username, passwordHash });
  },

  verifyPassword(username, password) {
    const admin = this.getAdmin();
    return admin.username === username && admin.passwordHash === this.hashPassword(password);
  },

  changePassword(currentPassword, newPassword) {
    const admin = this.getAdmin();
    if (admin.passwordHash !== this.hashPassword(currentPassword)) {
      return { success: false, message: 'Current password is incorrect' };
    }
    this.setAdmin(admin.username, this.hashPassword(newPassword));
    return { success: true, message: 'Password changed successfully' };
  },

  /* ---------- Employee CRUD ---------- */
  getEmployees() {
    const employees = this._get(this.KEYS.EMPLOYEES) || [];
    // Convert stored arrays back to Float32Array for face descriptors
    return employees.map(emp => ({
      ...emp,
      faceDescriptor: emp.faceDescriptor ? emp.faceDescriptor.map(d => new Float32Array(d)) : []
    }));
  },

  getEmployee(id) {
    const employees = this.getEmployees();
    return employees.find(e => e.id === id) || null;
  },

  saveEmployee(employee) {
    const employees = this._get(this.KEYS.EMPLOYEES) || [];
    // Convert Float32Array to regular arrays for JSON storage
    const storable = {
      ...employee,
      faceDescriptor: employee.faceDescriptor
        ? employee.faceDescriptor.map(d => Array.from(d))
        : []
    };

    const existingIndex = employees.findIndex(e => e.id === employee.id);
    if (existingIndex >= 0) {
      employees[existingIndex] = storable;
    } else {
      employees.push(storable);
    }
    this._set(this.KEYS.EMPLOYEES, employees);
  },

  deleteEmployee(id) {
    let employees = this._get(this.KEYS.EMPLOYEES) || [];
    employees = employees.filter(e => e.id !== id);
    this._set(this.KEYS.EMPLOYEES, employees);
  },

  /* ---------- Attendance CRUD ---------- */
  getAttendance(filters = {}) {
    let records = this._get(this.KEYS.ATTENDANCE) || [];

    if (filters.date) {
      records = records.filter(r => r.date === filters.date);
    }
    if (filters.employeeId) {
      records = records.filter(r => r.employeeId === filters.employeeId);
    }
    if (filters.dateFrom) {
      records = records.filter(r => r.date >= filters.dateFrom);
    }
    if (filters.dateTo) {
      records = records.filter(r => r.date <= filters.dateTo);
    }
    if (filters.search) {
      const s = filters.search.toLowerCase();
      records = records.filter(r =>
        (r.name && r.name.toLowerCase().includes(s)) ||
        (r.employeeId && r.employeeId.toLowerCase().includes(s))
      );
    }

    // Sort by date descending, then by checkIn descending
    records.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.checkIn || '').localeCompare(a.checkIn || '');
    });

    return records;
  },

  saveAttendance(record) {
    const records = this._get(this.KEYS.ATTENDANCE) || [];
    records.push(record);
    this._set(this.KEYS.ATTENDANCE, records);
  },

  updateAttendance(id, updates) {
    const records = this._get(this.KEYS.ATTENDANCE) || [];
    const index = records.findIndex(r => r.id === id);
    if (index >= 0) {
      records[index] = { ...records[index], ...updates };
      this._set(this.KEYS.ATTENDANCE, records);
      return true;
    }
    return false;
  },

  /* ---------- Settings ---------- */
  getSettings() {
    return this._get(this.KEYS.SETTINGS) || {
      officeStartTime: '09:00',
      officeEndTime: '18:00',
      lateThreshold: 15,
      matchThreshold: 0.6
    };
  },

  saveSettings(settings) {
    const current = this.getSettings();
    this._set(this.KEYS.SETTINGS, { ...current, ...settings });
  },

  /* ---------- Export / Import ---------- */
  exportAllData() {
    return JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      admin: this._get(this.KEYS.ADMIN),
      employees: this._get(this.KEYS.EMPLOYEES) || [],
      attendance: this._get(this.KEYS.ATTENDANCE) || [],
      settings: this._get(this.KEYS.SETTINGS)
    }, null, 2);
  },

  importAllData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (!data.version) {
        return { success: false, message: 'Invalid backup file format' };
      }
      if (data.admin) this._set(this.KEYS.ADMIN, data.admin);
      if (data.employees) this._set(this.KEYS.EMPLOYEES, data.employees);
      if (data.attendance) this._set(this.KEYS.ATTENDANCE, data.attendance);
      if (data.settings) this._set(this.KEYS.SETTINGS, data.settings);
      return {
        success: true,
        message: `Imported ${(data.employees || []).length} employees, ${(data.attendance || []).length} attendance records`
      };
    } catch (e) {
      return { success: false, message: 'Failed to parse backup file: ' + e.message };
    }
  },

  downloadBackup() {
    const data = this.exportAllData();
    const date = new Date().toISOString().split('T')[0];
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nws-attendance-backup-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /* ---------- Utility ---------- */
  clearAllData() {
    Object.values(this.KEYS).forEach(key => localStorage.removeItem(key));
  },

  getStorageSize() {
    let total = 0;
    Object.values(this.KEYS).forEach(key => {
      const item = localStorage.getItem(key);
      if (item) total += item.length * 2; // UTF-16
    });
    return total;
  }
};
