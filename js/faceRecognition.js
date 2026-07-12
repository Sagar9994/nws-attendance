/* ============================================================
   faceRecognition.js — Face detection & recognition
   Uses @vladmandic/face-api loaded via CDN
   NWS Soft Attendance System
   ============================================================ */

window.FaceRecognition = {
  modelsLoaded: false,
  faceMatcher: null,
  MODEL_URL: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1/model/',

  async loadModels(onProgress) {
    try {
      if (onProgress) onProgress('Loading SSD MobileNet model...');
      await faceapi.nets.ssdMobilenetv1.loadFromUri(this.MODEL_URL);

      if (onProgress) onProgress('Loading face landmark model...');
      await faceapi.nets.faceLandmark68Net.loadFromUri(this.MODEL_URL);

      if (onProgress) onProgress('Loading face recognition model...');
      await faceapi.nets.faceRecognitionNet.loadFromUri(this.MODEL_URL);

      this.modelsLoaded = true;
      this.buildFaceMatcher();

      if (onProgress) onProgress('Models loaded successfully!');
      return { success: true };
    } catch (err) {
      console.error('Model loading error:', err);
      return { success: false, message: 'Failed to load face recognition models: ' + err.message };
    }
  },

  async detectFace(input) {
    if (!this.modelsLoaded) return null;
    try {
      const result = await faceapi
        .detectSingleFace(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      return result || null;
    } catch (err) {
      console.error('Face detection error:', err);
      return null;
    }
  },

  async detectAllFaces(input) {
    if (!this.modelsLoaded) return [];
    try {
      const results = await faceapi
        .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptors();
      return results || [];
    } catch (err) {
      console.error('Face detection error:', err);
      return [];
    }
  },

  async registerFace(videoElement, employeeData) {
    if (!this.modelsLoaded) {
      return { success: false, message: 'Face recognition models not loaded yet' };
    }

    const detection = await this.detectFace(videoElement);
    if (!detection) {
      return { success: false, message: 'No face detected. Please look directly at the camera.' };
    }

    // Get existing employee or create new
    const existing = StorageManager.getEmployee(employeeData.id);
    const descriptors = existing ? [...existing.faceDescriptor] : [];
    descriptors.push(detection.descriptor);

    const employee = {
      ...employeeData,
      faceDescriptor: descriptors,
      registeredAt: existing ? existing.registeredAt : new Date().toISOString()
    };

    StorageManager.saveEmployee(employee);
    this.buildFaceMatcher();

    return {
      success: true,
      message: `Face captured for ${employeeData.name} (${descriptors.length} sample${descriptors.length > 1 ? 's' : ''})`,
      employee
    };
  },

  buildFaceMatcher() {
    const employees = StorageManager.getEmployees();
    const settings = StorageManager.getSettings();
    const labeled = [];

    employees.forEach(emp => {
      if (emp.faceDescriptor && emp.faceDescriptor.length > 0) {
        try {
          const descriptors = emp.faceDescriptor.map(d =>
            d instanceof Float32Array ? d : new Float32Array(d)
          );
          labeled.push(new faceapi.LabeledFaceDescriptors(emp.id, descriptors));
        } catch (e) {
          console.warn(`Skipping invalid descriptor for ${emp.name}:`, e);
        }
      }
    });

    if (labeled.length > 0) {
      this.faceMatcher = new faceapi.FaceMatcher(labeled, settings.matchThreshold || 0.6);
    } else {
      this.faceMatcher = null;
    }
  },

  async recognizeFace(videoElement) {
    if (!this.modelsLoaded) {
      return { matched: false, reason: 'models_not_loaded' };
    }

    const detection = await this.detectFace(videoElement);
    if (!detection) {
      return { matched: false, reason: 'no_face', detection: null };
    }

    if (!this.faceMatcher) {
      return { matched: false, reason: 'no_registered_faces', detection: detection.detection };
    }

    const match = this.faceMatcher.findBestMatch(detection.descriptor);
    if (match.label === 'unknown') {
      return {
        matched: false,
        reason: 'unknown_face',
        distance: match.distance,
        detection: detection.detection
      };
    }

    const employee = StorageManager.getEmployee(match.label);
    return {
      matched: true,
      employee,
      distance: match.distance,
      detection: detection.detection
    };
  },

  drawDetection(canvas, detection, label, isMatch) {
    const ctx = canvas.getContext('2d');
    this.clearCanvas(canvas);

    if (!detection) return;

    const box = detection.box || detection._box;
    if (!box) return;

    // Scale detection box to canvas size
    const scaleX = canvas.width / (canvas.getAttribute('data-source-width') || canvas.width);
    const scaleY = canvas.height / (canvas.getAttribute('data-source-height') || canvas.height);

    const x = box.x * scaleX;
    const y = box.y * scaleY;
    const w = box.width * scaleX;
    const h = box.height * scaleY;

    // Draw bounding box
    ctx.strokeStyle = isMatch ? '#22c55e' : '#ef4444';
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, w, h);

    // Corner accents
    const cornerLen = 20;
    ctx.lineWidth = 4;
    // Top-left
    ctx.beginPath(); ctx.moveTo(x, y + cornerLen); ctx.lineTo(x, y); ctx.lineTo(x + cornerLen, y); ctx.stroke();
    // Top-right
    ctx.beginPath(); ctx.moveTo(x + w - cornerLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerLen); ctx.stroke();
    // Bottom-left
    ctx.beginPath(); ctx.moveTo(x, y + h - cornerLen); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerLen, y + h); ctx.stroke();
    // Bottom-right
    ctx.beginPath(); ctx.moveTo(x + w - cornerLen, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cornerLen); ctx.stroke();

    // Label background
    if (label) {
      ctx.font = '600 14px Inter, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const padding = 8;
      const labelHeight = 28;

      ctx.fillStyle = isMatch ? '#22c55e' : '#ef4444';
      const ry = y - labelHeight - 4;
      const rx = x;
      const rw = textWidth + padding * 2;

      // Rounded rect for label
      const r = 6;
      ctx.beginPath();
      ctx.moveTo(rx + r, ry);
      ctx.lineTo(rx + rw - r, ry);
      ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + r);
      ctx.lineTo(rx + rw, ry + labelHeight - r);
      ctx.quadraticCurveTo(rx + rw, ry + labelHeight, rx + rw - r, ry + labelHeight);
      ctx.lineTo(rx + r, ry + labelHeight);
      ctx.quadraticCurveTo(rx, ry + labelHeight, rx, ry + labelHeight - r);
      ctx.lineTo(rx, ry + r);
      ctx.quadraticCurveTo(rx, ry, rx + r, ry);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, rx + padding, ry + labelHeight / 2);
    }
  },

  clearCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
};
