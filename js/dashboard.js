/* ============================================================
   dashboard.js — Charts, stats, and UI rendering
   NWS Soft Attendance System
   ============================================================ */

window.DashboardManager = {
  attendanceChart: null,
  reportChart: null,
  clockInterval: null,

  init() {
    this.updateStats();
    this.renderAttendanceChart();
    this.renderRecentActivity();
    this.startClock();
  },

  /* ---------- Stats Cards ---------- */
  updateStats() {
    const employees = StorageManager.getEmployees();
    const today = new Date().toISOString().split('T')[0];
    const todayRecords = StorageManager.getAttendance({ date: today });

    const presentIds = new Set(todayRecords.map(r => r.employeeId));
    const lateCount = todayRecords.filter(r => r.status === 'late').length;

    const el = (id) => document.getElementById(id);
    const setCount = (id, val) => { const e = el(id); if (e) e.textContent = val; };

    setCount('stat-total-employees', employees.length);
    setCount('stat-present-today', presentIds.size);
    setCount('stat-absent-today', Math.max(0, employees.length - presentIds.size));
    setCount('stat-late-arrivals', lateCount);
  },

  /* ---------- Weekly Chart ---------- */
  renderAttendanceChart() {
    const canvas = document.getElementById('attendance-chart');
    if (!canvas) return;

    if (this.attendanceChart) {
      this.attendanceChart.destroy();
    }

    const employees = StorageManager.getEmployees();
    const totalEmployees = employees.length;

    // Get last 7 days
    const labels = [];
    const presentData = [];
    const absentData = [];
    const lateData = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      labels.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));

      const records = StorageManager.getAttendance({ date: dateStr });
      const presentIds = new Set(records.map(r => r.employeeId));
      const late = records.filter(r => r.status === 'late').length;

      presentData.push(presentIds.size);
      absentData.push(Math.max(0, totalEmployees - presentIds.size));
      lateData.push(late);
    }

    this.attendanceChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Present',
            data: presentData,
            backgroundColor: 'rgba(34, 197, 94, 0.8)',
            borderColor: '#16a34a',
            borderWidth: 1,
            borderRadius: 8,
            borderSkipped: false
          },
          {
            label: 'Late',
            data: lateData,
            backgroundColor: 'rgba(245, 158, 11, 0.8)',
            borderColor: '#d97706',
            borderWidth: 1,
            borderRadius: 8,
            borderSkipped: false
          },
          {
            label: 'Absent',
            data: absentData,
            backgroundColor: 'rgba(239, 68, 68, 0.2)',
            borderColor: '#ef4444',
            borderWidth: 1,
            borderRadius: 8,
            borderSkipped: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: {
              usePointStyle: true,
              padding: 20,
              font: { family: 'Inter', size: 12, weight: 500 }
            }
          },
          tooltip: {
            backgroundColor: '#0f172a',
            titleFont: { family: 'Inter', size: 13 },
            bodyFont: { family: 'Inter', size: 12 },
            padding: 12,
            cornerRadius: 8
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Inter', size: 11 }, color: '#94a3b8' }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(148,163,184,0.1)' },
            ticks: {
              stepSize: 1,
              font: { family: 'Inter', size: 11 },
              color: '#94a3b8'
            }
          }
        }
      }
    });
  },

  /* ---------- Recent Activity ---------- */
  renderRecentActivity() {
    const container = document.getElementById('recent-activity');
    if (!container) return;

    const allRecords = StorageManager.getAttendance({});
    // Flatten to individual events (check-in and check-out)
    const events = [];
    allRecords.forEach(r => {
      if (r.checkIn) {
        events.push({ name: r.name, action: 'Checked in', time: r.checkIn, type: 'checkin' });
      }
      if (r.checkOut) {
        events.push({ name: r.name, action: 'Checked out', time: r.checkOut, type: 'checkout' });
      }
    });

    // Sort by time descending
    events.sort((a, b) => new Date(b.time) - new Date(a.time));
    const recent = events.slice(0, 10);

    if (recent.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <h4>No Activity Yet</h4>
          <p>Attendance events will appear here</p>
        </div>
      `;
      return;
    }

    container.innerHTML = recent.map(e => {
      const initials = e.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      return `
        <div class="activity-item">
          <div class="activity-avatar ${e.type}">${initials}</div>
          <div class="activity-info">
            <div class="activity-name">${e.name}</div>
            <div class="activity-action">${e.action}</div>
          </div>
          <span class="activity-time">${this._timeAgo(new Date(e.time))}</span>
        </div>
      `;
    }).join('');
  },

  /* ---------- Live Clock ---------- */
  startClock() {
    this.stopClock();
    const update = () => {
      const el = document.getElementById('live-clock');
      if (el) {
        const now = new Date();
        el.textContent = now.toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'short', day: 'numeric'
        }) + ' • ' + now.toLocaleTimeString('en-US', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
        });
      }
    };
    update();
    this.clockInterval = setInterval(update, 1000);
  },

  stopClock() {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
  },

  /* ---------- Employee List ---------- */
  renderEmployeeList() {
    const container = document.getElementById('employee-list');
    const countEl = document.getElementById('employee-count');
    if (!container) return;

    const employees = StorageManager.getEmployees();
    if (countEl) countEl.textContent = `${employees.length} employee${employees.length !== 1 ? 's' : ''}`;

    if (employees.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          <h4>No Employees Registered</h4>
          <p>Register your first employee using the form above</p>
        </div>
      `;
      return;
    }

    container.innerHTML = employees.map((emp, i) => {
      const initials = emp.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      const samples = emp.faceDescriptor ? emp.faceDescriptor.length : 0;
      return `
        <div class="employee-card" style="animation-delay:${i * 0.05}s">
          <div class="employee-avatar">${initials}</div>
          <div class="employee-details">
            <div class="employee-name">${emp.name}</div>
            <div class="employee-id">${emp.id} • ${samples} face sample${samples !== 1 ? 's' : ''}</div>
            <div class="employee-dept">${emp.department || 'Unassigned'}</div>
          </div>
          <button class="employee-delete" data-delete-id="${emp.id}" title="Delete employee">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      `;
    }).join('');
  },

  /* ---------- Attendance Log ---------- */
  renderAttendanceLog(filters = {}) {
    const tbody = document.getElementById('log-table-body');
    if (!tbody) return;

    const records = StorageManager.getAttendance(filters);

    if (records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state" style="padding:40px;">No attendance records found</td></tr>';
      return;
    }

    tbody.innerHTML = records.map(r => {
      const checkInTime = r.checkIn ? new Date(r.checkIn).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
      const checkOutTime = r.checkOut ? new Date(r.checkOut).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
      const duration = r.duration || (r.checkIn && r.checkOut ? AttendanceManager.calculateDuration(r.checkIn, r.checkOut) : '—');
      const statusClass = r.status === 'late' ? 'late' : 'on-time';
      const statusText = r.status === 'late' ? 'Late' : 'On Time';

      return `
        <tr>
          <td><strong>${r.name}</strong></td>
          <td>${r.employeeId}</td>
          <td>${r.department || '—'}</td>
          <td>${r.date}</td>
          <td>${checkInTime}</td>
          <td>${checkOutTime}</td>
          <td>${duration}</td>
          <td><span class="badge ${statusClass}">${statusText}</span></td>
        </tr>
      `;
    }).join('');
  },

  /* ---------- Reports ---------- */
  generateReport(dateFrom, dateTo, department) {
    const employees = StorageManager.getEmployees();
    const filters = {};
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;
    const allRecords = StorageManager.getAttendance(filters);

    const filteredRecords = department
      ? allRecords.filter(r => r.department === department)
      : allRecords;

    // Calculate total working days in range
    const start = dateFrom ? new Date(dateFrom) : new Date();
    const end = dateTo ? new Date(dateTo) : new Date();
    let workingDays = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 0 && d.getDay() !== 6) workingDays++;
    }
    workingDays = Math.max(workingDays, 1);

    const filteredEmployees = department
      ? employees.filter(e => e.department === department)
      : employees;
    const totalPossible = filteredEmployees.length * workingDays;

    // Stats
    const uniquePresent = new Set(filteredRecords.map(r => r.employeeId + '_' + r.date)).size;
    const attendanceRate = totalPossible > 0 ? Math.round((uniquePresent / totalPossible) * 100) : 0;
    const lateRecords = filteredRecords.filter(r => r.status === 'late');
    const onTimeRate = filteredRecords.length > 0
      ? Math.round(((filteredRecords.length - lateRecords.length) / filteredRecords.length) * 100) : 0;

    // Avg hours
    const durationsMs = filteredRecords
      .filter(r => r.checkIn && r.checkOut)
      .map(r => new Date(r.checkOut) - new Date(r.checkIn));
    const avgMs = durationsMs.length > 0 ? durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length : 0;
    const avgHours = (avgMs / (1000 * 60 * 60)).toFixed(1);

    // Update summary cards
    const summaryContainer = document.getElementById('report-summary');
    if (summaryContainer) summaryContainer.style.display = 'grid';
    const setVal = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    setVal('report-attendance-rate', attendanceRate + '%');
    setVal('report-avg-hours', avgHours + 'h');
    setVal('report-on-time-rate', onTimeRate + '%');

    // Render chart
    this.renderReportChart(dateFrom, dateTo, filteredRecords);

    // Render breakdown
    this.renderReportBreakdown(filteredEmployees, filteredRecords, workingDays);
  },

  renderReportChart(dateFrom, dateTo, records) {
    const canvas = document.getElementById('report-chart');
    if (!canvas) return;
    if (this.reportChart) this.reportChart.destroy();

    // Group by date
    const dateMap = {};
    records.forEach(r => {
      if (!dateMap[r.date]) dateMap[r.date] = { present: 0, late: 0 };
      dateMap[r.date].present++;
      if (r.status === 'late') dateMap[r.date].late++;
    });

    const dates = Object.keys(dateMap).sort();
    const presentData = dates.map(d => dateMap[d].present);
    const lateData = dates.map(d => dateMap[d].late);
    const labels = dates.map(d => {
      const dt = new Date(d + 'T00:00:00');
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    this.reportChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Present',
            data: presentData,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,0.1)',
            fill: true,
            tension: 0.4,
            pointBackgroundColor: '#22c55e',
            pointRadius: 4
          },
          {
            label: 'Late',
            data: lateData,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245,158,11,0.1)',
            fill: true,
            tension: 0.4,
            pointBackgroundColor: '#f59e0b',
            pointRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { usePointStyle: true, font: { family: 'Inter', size: 12 } }
          },
          tooltip: {
            backgroundColor: '#0f172a',
            cornerRadius: 8,
            padding: 12
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Inter', size: 11 }, color: '#94a3b8' }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(148,163,184,0.1)' },
            ticks: { stepSize: 1, font: { family: 'Inter', size: 11 }, color: '#94a3b8' }
          }
        }
      }
    });
  },

  renderReportBreakdown(employees, records, workingDays) {
    const tbody = document.getElementById('report-breakdown');
    if (!tbody) return;

    if (employees.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state" style="padding:40px;">No employees found</td></tr>';
      return;
    }

    tbody.innerHTML = employees.map(emp => {
      const empRecords = records.filter(r => r.employeeId === emp.id);
      const daysPresent = new Set(empRecords.map(r => r.date)).size;
      const daysLate = empRecords.filter(r => r.status === 'late').length;
      const durations = empRecords
        .filter(r => r.checkIn && r.checkOut)
        .map(r => new Date(r.checkOut) - new Date(r.checkIn));
      const avgMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
      const avgH = (avgMs / (1000 * 60 * 60)).toFixed(1);
      const rate = workingDays > 0 ? Math.round((daysPresent / workingDays) * 100) : 0;

      return `
        <tr>
          <td><strong>${emp.name}</strong></td>
          <td>${emp.department || '—'}</td>
          <td>${daysPresent}</td>
          <td>${daysLate}</td>
          <td>${avgH}h</td>
          <td><span class="badge ${rate >= 80 ? 'on-time' : rate >= 50 ? 'late' : 'absent'}">${rate}%</span></td>
        </tr>
      `;
    }).join('');
  },

  /* ---------- Refresh All ---------- */
  refreshAll() {
    this.updateStats();
    this.renderAttendanceChart();
    this.renderRecentActivity();
  },

  /* ---------- Helpers ---------- */
  _timeAgo(date) {
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
};
