/* ============================================================
   attendance.js — Attendance marking logic
   NWS Soft Attendance System
   ============================================================ */

window.AttendanceManager = {
  scanInterval: null,
  lastMarkedTime: {}, // employeeId -> timestamp (cooldown)
  COOLDOWN_MS: 5 * 60 * 1000, // 5 minutes between marks

  async startScanning(videoElement, canvasElement, statusElement, resultElement) {
    if (this.scanInterval) this.stopScanning();

    // Set canvas dimensions to match video
    canvasElement.width = videoElement.videoWidth || 640;
    canvasElement.height = videoElement.videoHeight || 480;
    canvasElement.setAttribute('data-source-width', canvasElement.width);
    canvasElement.setAttribute('data-source-height', canvasElement.height);

    statusElement.className = 'attendance-status scanning';
    statusElement.textContent = 'Scanning for faces...';

    this.scanInterval = setInterval(async () => {
      if (!CameraManager.isActive()) return;

      try {
        const result = await FaceRecognition.recognizeFace(videoElement);

        if (result.matched && result.employee) {
          // Draw green box with name
          FaceRecognition.drawDetection(
            canvasElement,
            result.detection,
            result.employee.name,
            true
          );

          // Try to mark attendance if cooldown allows
          if (this.canMarkAttendance(result.employee.id)) {
            const attendanceResult = this._autoMark(result.employee);
            statusElement.className = 'attendance-status recognized';
            statusElement.textContent = `✓ Recognized: ${result.employee.name}`;
            resultElement.innerHTML = `
              <div class="result-name">${result.employee.name}</div>
              <div class="result-action">${attendanceResult.message}</div>
            `;
          } else {
            statusElement.className = 'attendance-status recognized';
            statusElement.textContent = `✓ ${result.employee.name} — Already marked`;
          }
        } else if (result.detection) {
          // Face detected but not recognized
          FaceRecognition.drawDetection(
            canvasElement,
            result.detection,
            'Unknown',
            false
          );
          statusElement.className = 'attendance-status scanning';
          statusElement.textContent = 'Face detected — Not recognized';
          resultElement.innerHTML = '';
        } else {
          // No face at all
          FaceRecognition.clearCanvas(canvasElement);
          statusElement.className = 'attendance-status scanning';
          statusElement.textContent = 'Scanning for faces...';
          resultElement.innerHTML = '';
        }
      } catch (err) {
        console.error('Scan error:', err);
      }
    }, 1500); // Scan every 1.5 seconds
  },

  stopScanning() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  },

  _autoMark(employee) {
    const today = this._todayDate();
    const todayRecords = StorageManager.getAttendance({ date: today, employeeId: employee.id });

    if (todayRecords.length === 0) {
      // No record today → check in
      return this.markCheckIn(employee);
    }

    const latestRecord = todayRecords[0];
    if (!latestRecord.checkOut) {
      // Has check-in but no check-out → check out
      return this.markCheckOut(employee);
    }

    return { success: false, message: 'Already checked in and out today' };
  },

  markCheckIn(employee) {
    const now = new Date();
    const today = this._todayDate();
    const timeStr = this._timeString(now);

    // Check if already checked in
    const existing = StorageManager.getAttendance({ date: today, employeeId: employee.id });
    if (existing.length > 0) {
      return { success: false, message: 'Already checked in today' };
    }

    const status = this.getAttendanceStatus(timeStr);
    const record = {
      id: this.generateId(),
      employeeId: employee.id,
      name: employee.name,
      department: employee.department || '',
      date: today,
      checkIn: now.toISOString(),
      checkOut: null,
      status: status,
      duration: null
    };

    StorageManager.saveAttendance(record);
    this.lastMarkedTime[employee.id] = Date.now();

    // Show toast
    if (window.App) {
      const statusText = status === 'late' ? '(Late)' : '(On Time)';
      App.showToast(`${employee.name} checked in at ${timeStr} ${statusText}`, status === 'late' ? 'warning' : 'success');
    }

    // Refresh today's attendance UI
    this._refreshTodayTable();

    return { success: true, message: `Checked in at ${timeStr}`, record };
  },

  markCheckOut(employee) {
    const now = new Date();
    const today = this._todayDate();
    const timeStr = this._timeString(now);

    const records = StorageManager.getAttendance({ date: today, employeeId: employee.id });
    const record = records.find(r => !r.checkOut);
    if (!record) {
      return { success: false, message: 'No active check-in found' };
    }

    const duration = this.calculateDuration(record.checkIn, now.toISOString());
    StorageManager.updateAttendance(record.id, {
      checkOut: now.toISOString(),
      duration: duration
    });

    this.lastMarkedTime[employee.id] = Date.now();

    if (window.App) {
      App.showToast(`${employee.name} checked out at ${timeStr} (${duration})`, 'info');
    }

    this._refreshTodayTable();

    return { success: true, message: `Checked out at ${timeStr} (${duration})` };
  },

  canMarkAttendance(employeeId) {
    const lastTime = this.lastMarkedTime[employeeId];
    if (!lastTime) return true;
    return (Date.now() - lastTime) >= this.COOLDOWN_MS;
  },

  getTodayAttendance() {
    const today = this._todayDate();
    return StorageManager.getAttendance({ date: today });
  },

  getAttendanceStatus(timeStr) {
    const settings = StorageManager.getSettings();
    const officeStart = settings.officeStartTime || '09:00';
    const threshold = settings.lateThreshold || 15;

    // Parse office start time
    const [startH, startM] = officeStart.split(':').map(Number);
    const lateMinutes = startH * 60 + startM + threshold;

    // Parse check-in time (HH:MM AM/PM format)
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return 'on-time';

    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3].toUpperCase();

    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    const checkInMinutes = hours * 60 + minutes;

    return checkInMinutes > lateMinutes ? 'late' : 'on-time';
  },

  calculateDuration(checkIn, checkOut) {
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diffMs = end - start;

    if (diffMs < 0) return '0m';

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  },

  exportToCSV(records) {
    if (!records || records.length === 0) {
      if (window.App) App.showToast('No records to export', 'warning');
      return;
    }

    const headers = ['Employee Name', 'Employee ID', 'Department', 'Date', 'Check-in', 'Check-out', 'Duration', 'Status'];
    const rows = records.map(r => [
      r.name,
      r.employeeId,
      r.department || '',
      r.date,
      r.checkIn ? new Date(r.checkIn).toLocaleTimeString() : '',
      r.checkOut ? new Date(r.checkOut).toLocaleTimeString() : '',
      r.duration || '',
      r.status || ''
    ]);

    const csv = [headers, ...rows].map(row =>
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nws-attendance-${this._todayDate()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (window.App) App.showToast('CSV exported successfully', 'success');
  },

  generateId() {
    return 'att_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
  },

  _todayDate() {
    return new Date().toISOString().split('T')[0];
  },

  _timeString(date) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  },

  _refreshTodayTable() {
    if (window.DashboardManager) {
      DashboardManager.updateStats();
      DashboardManager.renderRecentActivity();
    }

    // Refresh today's attendance list on the attendance page
    const tbody = document.getElementById('today-attendance-list');
    if (!tbody) return;

    const records = this.getTodayAttendance();
    if (records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state" style="padding:40px;">No attendance records today</td></tr>';
      return;
    }

    tbody.innerHTML = records.map(r => `
      <tr>
        <td><strong>${r.name}</strong></td>
        <td>${r.employeeId}</td>
        <td>${r.department || '—'}</td>
        <td>${r.checkIn ? new Date(r.checkIn).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'}</td>
        <td>${r.checkOut ? new Date(r.checkOut).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'}</td>
        <td><span class="badge ${r.status}">${r.status === 'on-time' ? 'On Time' : 'Late'}</span></td>
      </tr>
    `).join('');
  }
};
