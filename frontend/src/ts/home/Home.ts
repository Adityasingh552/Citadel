/** Citadel — Landing/Home page renderer. */

export function renderHome(container: HTMLElement): void {
  container.innerHTML = `
    <div class="home">
      <!-- Navbar -->
      <nav class="home-nav">
        <div class="home-nav__logo brand-logo">CITADEL</div>
        <ul class="home-nav__links">
          <li><a href="#features" class="home-nav__link">Features</a></li>
          <li><a href="#how-it-works" class="home-nav__link">How It Works</a></li>
          <li><a href="#/dashboard" class="home-nav__cta">Dashboard →</a></li>
        </ul>
      </nav>

      <!-- Hero -->
      <section class="hero">
        <video class="hero__video" autoplay muted loop playsinline preload="metadata" poster="/src/assets/home-video-poster.jpg">
          <source src="" data-src="/src/assets/home-video-compressed.mp4" type="video/mp4">
        </video>
        <div class="hero__overlay"></div>
        <div class="hero__content">
          <div class="hero__badge">AI-Powered Safety System</div>
          <h1 class="hero__title">AI-Powered Traffic<br>Safety Analytics</h1>
          <p class="hero__subtitle">
            Detect accidents and safety threats in real-time
            using the YOLO26 AI model with ONNX runtime.
          </p>
          <a href="#/dashboard" class="hero__cta">Launch Dashboard →</a>
        </div>
      </section>

      <!-- Features -->
      <section class="features" id="features">
        <div class="features__header">
          <h2 class="features__title">What We Detect</h2>
          <p class="features__subtitle">Advanced AI detection capabilities for traffic safety</p>
        </div>
        <div class="features__grid">
          <div class="feature-card">
            <div class="feature-card__icon"></div>
            <h3 class="feature-card__title">Accident Detection</h3>
            <p class="feature-card__desc">
              YOLO26 model identifies collisions and classifies severity in real-time.
            </p>
          </div>
          <div class="feature-card">
            <div class="feature-card__icon"></div>
            <h3 class="feature-card__title">Analytics Dashboard</h3>
            <p class="feature-card__desc">
              Real-time statistics, event timeline, severity breakdown charts, and detailed event logs.
            </p>
          </div>
          <div class="feature-card">
            <div class="feature-card__icon"></div>
            <h3 class="feature-card__title">Digital Tickets</h3>
            <p class="feature-card__desc">
              Automated violation ticket generation with evidence snapshots and status tracking.
            </p>
          </div>
          <div class="feature-card">
            <div class="feature-card__icon"></div>
            <h3 class="feature-card__title">Live Monitoring</h3>
            <p class="feature-card__desc">
              Connect to traffic cameras for continuous real-time accident detection.
            </p>
          </div>
        </div>
      </section>

      <!-- Stats -->
      <section class="stats-section">
        <div class="stat-item">
          <div class="stat-item__value">YOLO26</div>
          <div class="stat-item__label">Detection Model</div>
        </div>
        <div class="stat-item">
          <div class="stat-item__value">24/7</div>
          <div class="stat-item__label">Monitoring Ready</div>
        </div>
        <div class="stat-item">
          <div class="stat-item__value">ONNX</div>
          <div class="stat-item__label">CPU Runtime</div>
        </div>
        <div class="stat-item">
          <div class="stat-item__value">&lt;1s</div>
          <div class="stat-item__label">Processing Time</div>
        </div>
      </section>

      <!-- How It Works -->
      <section class="how-it-works" id="how-it-works">
        <h2 class="how-it-works__title">How It Works</h2>
        <div class="how-it-works__steps">
          <div class="step">
            <div class="step__number">1</div>
            <div class="step__label">Upload Video</div>
            <p class="step__desc">Upload traffic footage in MP4, AVI, or MOV format</p>
          </div>
          <div class="step">
            <div class="step__number">2</div>
            <div class="step__label">AI Processes</div>
            <p class="step__desc">YOLO26 model analyzes frames for accident detection</p>
          </div>
          <div class="step">
            <div class="step__number">3</div>
            <div class="step__label">View Results</div>
            <p class="step__desc">Browse events, tickets, and analytics on the dashboard</p>
          </div>
        </div>
      </section>

      <!-- Footer -->
      <footer class="home-footer">
        Citadel v1.0 — AI Traffic Safety Analytics
      </footer>
    </div>
  `;

  // Lazy load video source after page loads
  const video = container.querySelector('video');
  if (video) {
    const source = video.querySelector('source');
    if (source && source.dataset.src) {
      // Load on page load or user interaction
      const loadVideo = () => {
        source.src = source.dataset.src!;
        video.load();
      };
      
      // Trigger on load or when user scrolls near hero
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadVideo);
      } else {
        loadVideo();
      }
    }
  }
}
