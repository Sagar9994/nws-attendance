/* ============================================================
   storage.js — Supabase cloud sync + local fallback cache
   NWS Soft Attendance System
   ============================================================ */

window.StorageManager = {
  // --- SUPABASE CONFIGURATION ---
  // You will replace these with your credentials
  SUPABASE_URL: 'YOUR_SUPABASE_URL',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
  
  supabase: null,
  isCloudActive: false,

  // --- LOCAL SYNCHRONOUS CACHE ---
  cache: {
    admin: { username: 'admin', passwordHash: 'djb2_6kefv7' }, // admin123
    employees: [],
    attendance: [],
    settings: {
      officeStartTime: '09:00',
      officeEndTime: '18:00',
      lateThreshold: 15,
      matchThreshold: 0.6
    }
  },

  /* ---------- Initial Cache Sync ---------- */
  async init() {
    this.isCloudActive = (this.SUPABASE_URL !== 'YOUR_SUPABASE_URL' && this.SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY');

    if (this.isCloudActive) {
      try {
        this.supabase = supabase.createClient(this.SUPABASE_URL, this.SUPABASE_ANON_KEY);
        console.log('Supabase client initialized. Syncing data...');
        await this.syncFromCloud();
        console.log('Supabase cloud sync completed successfully!');
      } catch (err) {
        console.error('Supabase connection failed. Falling back to local storage:', err);
        this.isCloudActive = false;
        this.syncFromLocal();
      }
    } else {
      console.log('Supabase credentials not set. Using local storage mode.');
      this.syncFromLocal();
    }
  },

  async syncFromCloud() {
    // 1. Fetch Admin
    const { data: adminData } = await this.supabase.from('nws_admin').select('*').limit(1);
    if (adminData && adminData.length > 0) {
      this.cache.admin = {
        username: adminData[0].username,
        passwordHash: adminData[0].password_hash
      };
    } else {
      // Seed default admin in cloud if table empty
      await this.supabase.from('nws_admin').insert([
        { username: 'admin', password_hash: this.hashPassword('admin123') }
      ]);
    }

    // 2. Fetch Settings
    const { data: settingsData } = await this.supabase.from('nws_settings').select('*').limit(1);
    if (settingsData && settingsData.length > 0) {
      this.cache.settings = {
        officeStartTime: settingsData[0].office_start_time,
        officeEndTime: settingsData[0].office_end_time,
        lateThreshold: settingsData[0].late_threshold,
        matchThreshold: settingsData[0].match_threshold
      };
    } else {
      // Seed default settings in cloud if table empty
      await this.supabase.from('nws_settings').insert([
        {
          office_start_time: '09:00',
          office_end_time: '18:00',
          late_threshold: 15,
          match_threshold: 0.6
        }
      ]);
    }

    // 3. Fetch Employees
    const { data: empData } = await this.supabase.from('nws_employees').select('*');
    if (empData) {
      this.cache.employees = empData.map(e => ({
        id: e.id,
        name: e.name,
        department: e.department,
        email: e.email,
        faceDescriptor: e.face_descriptor ? e.face_descriptor.map(d => new Float32Array(d)) : [],
        registeredAt: e.registered_at
      }));
    }

    // 4. Fetch Attendance
    const { data: attData } = await this.supabase.from('nws_attendance').select('*');
    if (attData) {
      this.cache.attendance = attData;
    }
  },

  syncFromLocal() {
    try {
      const admin = localStorage.getItem('nws_admin');
      if (admin) this.cache.admin = JSON.parse(admin);

      const settings = localStorage.getItem('nws_settings');
      if (settings) this.cache.settings = JSON.parse(settings);

      const employees = localStorage.getItem('nws_employees');
      if (employees) {
        this.cache.employees = JSON.parse(employees).map(emp => ({
          ...emp,
          faceDescriptor: emp.faceDescriptor ? emp.faceDescriptor.map(d => new Float32Array(d)) : []
        }));
      }

      const attendance = localStorage.getItem('nws_attendance');
      if (attendance) this.cache.attendance = JSON.parse(attendance);
    } catch (e) {
      console.error('Error parsing local storage:', e);
    }
  },

  saveToLocalFallback() {
    if (this.isCloudActive) return; // Don't write to localStorage if in cloud mode
    localStorage.setItem('nws_admin', JSON.stringify(this.cache.admin));
    localStorage.setItem('nws_settings', JSON.stringify(this.cache.settings));
    localStorage.setItem('nws_attendance', JSON.stringify(this.cache.attendance));
    
    const serializedEmployees = this.cache.employees.map(emp => ({
      ...emp,
      faceDescriptor: emp.faceDescriptor ? emp.faceDescriptor.map(d => Array.from(d)) : []
    }));
    localStorage.setItem('nws_employees', JSON.stringify(serializedEmployees));
  },

  /* ---------- Password Hash Helper ---------- */
  hashPassword(password) {
    let hash = 5381;
    for (let i = 0; i < password.length; i++) {
      hash = ((hash << 5) + hash) + password.charCodeAt(i);
      hash = hash & hash;
    }
    return 'djb2_' + Math.abs(hash).toString(36);
  },

  /* ---------- Admin Management ---------- */
  getAdmin() {
    return this.cache.admin;
  },

  async setAdmin(username, passwordHash) {
    this.cache.admin = { username, passwordHash };
    this.saveToLocalFallback();

    if (this.isCloudActive) {
      // Upsert into Supabase (assume single row with id 1)
      await this.supabase.from('nws_admin').upsert([
        { id: 1, username, password_hash: passwordHash }
      ]);
    }
  },

  verifyPassword(username, password) {
    const admin = this.getAdmin();
    return admin.username === username && admin.passwordHash === this.hashPassword(password);
  },

  async changePassword(currentPassword, newPassword) {
    const admin = this.getAdmin();
    if (admin.passwordHash !== this.hashPassword(currentPassword)) {
      return { success: false, message: 'Current password is incorrect' };
    }
    const newHash = this.hashPassword(newPassword);
    await this.setAdmin(admin.username, newHash);
    return { success: true, message: 'Password changed successfully' };
  },

  /* ---------- Employee CRUD ---------- */
  getEmployees() {
    return this.cache.employees;
  },

  getEmployee(id) {
    return this.cache.employees.find(e => e.id === id) || null;
  },

  async saveEmployee(employee) {
    const existingIndex = this.cache.employees.findIndex(e => e.id === employee.id);
    if (existingIndex >= 0) {
      this.cache.employees[existingIndex] = employee;
    } else {
      this.cache.employees.push(employee);
    }
    this.saveToLocalFallback();

    if (this.isCloudActive) {
      const serializableDescriptor = employee.faceDescriptor
        ? employee.faceDescriptor.map(d => Array.from(d))
        : [];
        
      await this.supabase.from('nws_employees').upsert([
        {
          id: employee.id,
          name: employee.name,
          department: employee.department,
          email: employee.email,
          face_descriptor: serializableDescriptor,
          registered_at: employee.registeredAt
        }
      ]);
    }
  },

  async deleteEmployee(id) {
    this.cache.employees = this.cache.employees.filter(e => e.id !== id);
    this.saveToLocalFallback();

    if (this.isCloudActive) {
      await this.supabase.from('nws_employees').delete().eq('id', id);
    }
  },

  /* ---------- Attendance CRUD ---------- */
  getAttendance(filters = {}) {
    let records = [...this.cache.attendance];

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

    records.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.checkIn || '').localeCompare(a.checkIn || '');
    });

    return records;
  },

  async saveAttendance(record) {
    this.cache.attendance.push(record);
    this.saveToLocalFallback();

    if (this.isCloudActive) {
      await this.supabase.from('nws_attendance').insert([record]);
    }
  },

  async updateAttendance(id, updates) {
    const index = this.cache.attendance.findIndex(r => r.id === id);
    if (index >= 0) {
      this.cache.attendance[index] = { ...this.cache.attendance[index], ...updates };
      this.saveToLocalFallback();

      if (this.isCloudActive) {
        await this.supabase.from('nws_attendance').update(updates).eq('id', id);
      }
      return true;
    }
    return false;
  },

  /* ---------- Settings ---------- */
  getSettings() {
    return this.cache.settings;
  },

  async saveSettings(settings) {
    this.cache.settings = { ...this.cache.settings, ...settings };
    this.saveToLocalFallback();

    if (this.isCloudActive) {
      await this.supabase.from('nws_settings').upsert([
        {
          id: 1,
          office_start_time: this.cache.settings.officeStartTime,
          office_end_time: this.cache.settings.officeEndTime,
          late_threshold: this.cache.settings.lateThreshold,
          match_threshold: this.cache.settings.matchThreshold
        }
      ]);
    }
  },

  /* ---------- Export / Import / Reset ---------- */
  exportAllData() {
    const serializedEmployees = this.cache.employees.map(emp => ({
      ...emp,
      faceDescriptor: emp.faceDescriptor ? emp.faceDescriptor.map(d => Array.from(d)) : []
    }));
    return JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      admin: this.cache.admin,
      employees: serializedEmployees,
      attendance: this.cache.attendance,
      settings: this.cache.settings
    }, null, 2);
  },

  async importAllData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (!data.version) {
        return { success: false, message: 'Invalid backup file format' };
      }

      this.cache.admin = data.admin || this.cache.admin;
      this.cache.settings = data.settings || this.cache.settings;
      this.cache.attendance = data.attendance || [];
      this.cache.employees = (data.employees || []).map(emp => ({
        ...emp,
        faceDescriptor: emp.faceDescriptor ? emp.faceDescriptor.map(d => new Float32Array(d)) : []
      }));

      this.saveToLocalFallback();

      if (this.isCloudActive) {
        // Clear cloud and load imported data
        await this.supabase.from('nws_admin').upsert([{ id: 1, username: this.cache.admin.username, password_hash: this.cache.admin.passwordHash }]);
        await this.supabase.from('nws_settings').upsert([{
          id: 1,
          office_start_time: this.cache.settings.officeStartTime,
          office_end_time: this.cache.settings.officeEndTime,
          late_threshold: this.cache.settings.lateThreshold,
          match_threshold: this.cache.settings.matchThreshold
        }]);

        // Bulk delete and insert employees
        await this.supabase.from('nws_employees').delete().neq('id', 'dummy');
        if (data.employees && data.employees.length > 0) {
          await this.supabase.from('nws_employees').insert(
            data.employees.map(emp => ({
              id: emp.id,
              name: emp.name,
              department: emp.department,
              email: emp.email,
              face_descriptor: emp.faceDescriptor,
              registered_at: emp.registeredAt
            }))
          );
        }

        // Bulk delete and insert attendance
        await this.supabase.from('nws_attendance').delete().neq('id', 'dummy');
        if (data.attendance && data.attendance.length > 0) {
          // Chunk insertions in case of massive attendance list
          const chunks = [];
          for (let i = 0; i < data.attendance.length; i += 100) {
            chunks.push(data.attendance.slice(i, i + 100));
          }
          for (const chunk of chunks) {
            await this.supabase.from('nws_attendance').insert(chunk);
          }
        }
      }

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

  async clearAllData() {
    this.cache.admin = { username: 'admin', passwordHash: 'djb2_6kefv7' };
    this.cache.employees = [];
    this.cache.attendance = [];
    this.cache.settings = {
      officeStartTime: '09:00',
      officeEndTime: '18:00',
      lateThreshold: 15,
      matchThreshold: 0.6
    };

    localStorage.removeItem('nws_admin');
    localStorage.removeItem('nws_settings');
    localStorage.removeItem('nws_attendance');
    localStorage.removeItem('nws_employees');

    if (this.isCloudActive) {
      await this.supabase.from('nws_admin').delete().neq('id', 0);
      await this.supabase.from('nws_settings').delete().neq('id', 0);
      await this.supabase.from('nws_employees').delete().neq('id', 'dummy');
      await this.supabase.from('nws_attendance').delete().neq('id', 'dummy');
    }
  },

  getStorageSize() {
    return JSON.stringify(this.cache).length * 2;
  }
};
