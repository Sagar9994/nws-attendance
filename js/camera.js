/* ============================================================
   camera.js — Webcam management
   NWS Soft Attendance System
   ============================================================ */

window.CameraManager = {
  activeStream: null,
  activeVideoElement: null,

  getVideoConstraints() {
    return {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user'
      },
      audio: false
    };
  },

  async startCamera(videoElement) {
    try {
      // Stop existing stream if any
      this.stopCamera();

      const stream = await navigator.mediaDevices.getUserMedia(this.getVideoConstraints());
      videoElement.srcObject = stream;
      this.activeStream = stream;
      this.activeVideoElement = videoElement;

      // Wait for video to be ready
      await new Promise((resolve) => {
        videoElement.onloadedmetadata = () => {
          videoElement.play();
          resolve();
        };
      });

      // Show video, hide placeholder
      videoElement.style.display = 'block';
      const wrapper = videoElement.closest('.video-wrapper');
      if (wrapper) {
        const placeholder = wrapper.querySelector('.video-placeholder');
        if (placeholder) placeholder.style.display = 'none';
        wrapper.classList.add('active');
      }

      return { success: true, stream };
    } catch (err) {
      console.error('Camera error:', err);
      let message = 'Could not access camera';
      if (err.name === 'NotAllowedError') {
        message = 'Camera permission denied. Please allow camera access in browser settings.';
      } else if (err.name === 'NotFoundError') {
        message = 'No camera found. Please connect a webcam.';
      } else if (err.name === 'NotReadableError') {
        message = 'Camera is in use by another application.';
      }
      return { success: false, message };
    }
  },

  stopCamera(videoElement) {
    const ve = videoElement || this.activeVideoElement;

    if (this.activeStream) {
      this.activeStream.getTracks().forEach(track => track.stop());
      this.activeStream = null;
    }

    if (ve) {
      ve.srcObject = null;
      ve.style.display = 'none';
      const wrapper = ve.closest('.video-wrapper');
      if (wrapper) {
        const placeholder = wrapper.querySelector('.video-placeholder');
        if (placeholder) placeholder.style.display = 'flex';
        wrapper.classList.remove('active');
      }
    }

    this.activeVideoElement = null;
  },

  isActive() {
    return !!(this.activeStream && this.activeStream.active);
  },

  captureFrame(videoElement) {
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth || 640;
    canvas.height = videoElement.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
};
