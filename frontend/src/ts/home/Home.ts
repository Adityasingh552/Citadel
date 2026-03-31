/** Citadel — Landing/Home page renderer. */

export function renderHome(container: HTMLElement): void {
  container.innerHTML = `
    <style>
      #home-root {
        background-color: #000000;
        background-image: radial-gradient(circle at 50% 0%, #0a0a0a 0%, #000000 70%);
        background-attachment: fixed;
        font-family: 'General Sans', sans-serif;
        color: #ffffff;
      }
      #home-root .material-symbols-outlined {
        font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24;
        font-size: 20px;
      }
      #home-root .hero-gradient-text {
        background: linear-gradient(144deg, #FFFFFF 0%, rgba(255, 255, 255, 0.1) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      #home-root .glow-streak {
        position: relative;
        overflow: hidden;
      }
      #home-root .glow-streak::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 140%;
        height: 140%;
        background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 70%);
        transform: translate(-50%, -50%);
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.4s ease;
      }
      #home-root .glow-streak:hover::after {
        opacity: 1;
      }
      #home-root .glass-card {
        background: rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(20px);
      }
    </style>
    
    <div id="home-root" class="text-white antialiased selection:bg-white selection:text-black">
      <!-- TopNavBar -->
      <nav class="bg-black/80 backdrop-blur-2xl text-white font-['General_Sans'] tracking-tight fixed top-0 w-full z-50 border-b border-white/10 flex justify-between items-center px-12 py-6">
        <div class="text-2xl font-medium tracking-[0.2em] text-white">CITADEL</div>
        <a href="#/dashboard" class="bg-white text-black px-6 py-2.5 rounded-full font-medium text-sm transition-transform active:scale-95 duration-200 glow-streak inline-block text-center">
            Get Started
        </a>
      </nav>

      <main class="relative bg-black w-full" style="padding-top: 0;">
        <!-- HERO RECAP (Fullscreen Background Video) -->
        <section class="relative min-h-screen flex flex-col justify-center items-center text-center overflow-hidden bg-black w-full" style="padding-top: 5rem;">
          <!-- Video Background (Autoplay, Muted, Loop, PlaysInline) -->
          <video autoplay loop muted playsinline class="absolute inset-0 w-full h-full object-cover z-0">
              <source src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260217_030345_246c0224-10a4-422c-b324-070b7c0eceda.mp4" type="video/mp4" />
          </video>
          <!-- 50% Black Overlay for Readability -->
          <div class="absolute inset-0 bg-black/50 z-0"></div>

          <!-- Hero Content (Must sit on top) -->
          <div class="relative z-10 px-12 max-w-7xl mx-auto flex flex-col items-center">
            <span class="text-[0.75rem] uppercase tracking-[0.3em] text-white/40 mb-6">Transitioning to Scale</span>
            <h1 class="hero-gradient-text text-5xl md:text-7xl font-medium tracking-tight leading-tight max-w-4xl mx-auto">
                The Infrastructure for <br/> Intelligent Safety.
            </h1>
          </div>
        </section>

        <!-- SECTION 1: CORE CAPABILITIES -->
        <section class="px-12 py-24 max-w-7xl mx-auto bg-transparent relative z-10">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
            <!-- Card 1 -->
            <div class="p-8 border border-white/10 glass-card rounded-sm flex flex-col gap-6">
              <span class="text-[12px] text-white/40 uppercase tracking-widest">Detection</span>
              <h3 class="text-xl font-medium">AI Detection</h3>
              <p class="text-[15px] text-white/70 leading-relaxed">Detect accidents and anomalies using advanced computer vision models trained on millions of traffic patterns.</p>
            </div>
            <!-- Card 2 -->
            <div class="p-8 border border-white/10 glass-card rounded-sm flex flex-col gap-6">
              <span class="text-[12px] text-white/40 uppercase tracking-widest">Analysis</span>
              <h3 class="text-xl font-medium">Live Monitoring</h3>
              <p class="text-[15px] text-white/70 leading-relaxed">Analyze traffic feeds across multiple nodes in real-time with zero-latency visual processing pipelines.</p>
            </div>
            <!-- Card 3 -->
            <div class="p-8 border border-white/10 glass-card rounded-sm flex flex-col gap-6">
              <span class="text-[12px] text-white/40 uppercase tracking-widest">Automation</span>
              <h3 class="text-xl font-medium">Automated Workflows</h3>
              <p class="text-[15px] text-white/70 leading-relaxed">Generate alerts and trigger emergency protocols without manual intervention using deterministic logic.</p>
            </div>
          </div>
        </section>

        <!-- SECTION 2: SYSTEM OVERVIEW -->
        <section class="px-12 py-32 max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-24 items-center bg-transparent relative z-10">
          <div class="flex flex-col gap-8">
            <span class="text-[0.75rem] uppercase tracking-[0.3em] text-white/40">System Overview</span>
            <h2 class="text-4xl md:text-5xl font-medium tracking-tight">Operate Traffic Systems in Real Time</h2>
            <p class="text-lg text-white/70 leading-relaxed">Citadel provides a unified command center for municipal safety operations, centralizing disparate data streams into a single high-signal interface.</p>
            <ul class="space-y-6 mt-4">
              <li class="flex items-center gap-4">
                <span class="material-symbols-outlined text-white" data-icon="check_circle" data-weight="fill" style="font-variation-settings: 'FILL' 1;">check_circle</span>
                <span class="text-white/80">Real-time event feed</span>
              </li>
              <li class="flex items-center gap-4">
                <span class="material-symbols-outlined text-white" data-icon="check_circle" data-weight="fill" style="font-variation-settings: 'FILL' 1;">check_circle</span>
                <span class="text-white/80">Evidence capture and archiving</span>
              </li>
              <li class="flex items-center gap-4">
                <span class="material-symbols-outlined text-white" data-icon="check_circle" data-weight="fill" style="font-variation-settings: 'FILL' 1;">check_circle</span>
                <span class="text-white/80">Ticket lifecycle management</span>
              </li>
            </ul>
          </div>
          <div class="relative aspect-video rounded-lg overflow-hidden border border-white/10 bg-surface-container-lowest">
            <img alt="UI Dashboard Preview" class="w-full h-full object-cover opacity-60" data-alt="Dark, minimal user interface dashboard showing traffic data charts and camera grids with futuristic neon accents" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDX3PnbFFxPz0kmBRtFnCr0swvg82LCglC7QmWZHIt5RSSWh81GrFqC5O_HY9h_c_RWHVpzkeHFHTue6pzIbMIIXd5RZzWECP11sdg01EamjDWQ3uTqNHxXjCGw4DoD8Jww4fshaA7Jz8wSuH_cMnyd-87bGD2zHLzLhD5DGG0gnTGQNlzomYC4GoV6xHxDpqeXtqDoU1PBcA69M-QNjnlIbJnNJabzaE0j58PKW2vHWgAzBLMNdAvA5vmu9TlwCEHQ0ySJlkXZYQ6y"/>
            <div class="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent"></div>
          </div>
        </section>

        <!-- SECTION 3: LIVE MONITORING MAP -->
        <section class="py-32 bg-surface-container-lowest/30 relative z-10">
          <div class="px-12 max-w-7xl mx-auto mb-16">
            <h2 class="text-4xl font-medium tracking-tight mb-4">Monitor Across Regions</h2>
            <p class="text-white/60 text-lg">Global visibility from a centralized node architecture.</p>
          </div>
          <div class="w-full h-[600px] bg-black/50 relative overflow-hidden">
            <!-- Map Placeholder with data-location -->
            <div class="absolute inset-0 opacity-40 grayscale" data-location="New York City" style="">
              <img alt="Dark Map" class="w-full h-full object-cover" data-alt="Minimalist dark themed architectural map of a major metropolitan city with thin silver lines representing streets" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDvKhGrgP-mgwZUafRhfigpxRaDJceKnWONGkjKZMI7v5juZKzIKpgJmmtHWTev5-eO6_SvEjocrHIIuW40RBsj5hUmuYxBtgEQdKOhZtpkrb7Pyqh4Svh0sZ1Q-Gu4k6dxRwprmqSpdDAxCp4zNwHDBqveSLZoJ-JBcHQQS-_gUH8PvLagVIdBrlF84ASFGuBpERzpCdBIK11iavLx-4N308ycSDkZH8-aTpnwPL0dDGqNSM2gjkh-jh0hgXFuHj7f7N_Tf72juoK7"/>
            </div>
            <!-- Glowing Camera Markers -->
            <div class="absolute top-1/4 left-1/3 w-3 h-3 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.8)] animate-pulse"></div>
            <div class="absolute top-1/2 left-2/3 w-3 h-3 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.8)] animate-pulse"></div>
            <div class="absolute bottom-1/3 left-1/2 w-3 h-3 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.8)] animate-pulse"></div>
            <!-- UI Overlay -->
            <div class="absolute bottom-12 right-12 glass-card p-6 border border-white/10 rounded-sm">
              <div class="flex items-center gap-3 mb-4">
                <div class="w-2 h-2 rounded-full bg-white"></div>
                <span class="text-[12px] uppercase tracking-widest text-white/70">System Status: Nominal</span>
              </div>
              <div class="text-3xl font-medium tracking-tighter">84,209 <span class="text-sm text-white/40 tracking-normal">Active Nodes</span></div>
            </div>
          </div>
        </section>

        <!-- SECTION 4: WORKFLOW BREAKDOWN -->
        <section class="px-12 py-32 max-w-5xl mx-auto relative z-10">
          <div class="text-center mb-24">
            <span class="text-[0.75rem] uppercase tracking-[0.3em] text-white/40 block mb-4">The Pipeline</span>
            <h2 class="text-4xl font-medium tracking-tight">Streamlined Incident Response</h2>
          </div>
          <div class="relative">
            <!-- Vertical Line -->
            <div class="absolute left-1/2 top-0 bottom-0 w-[1px] bg-white/10 -translate-x-1/2"></div>
            <div class="space-y-32">
              <!-- Step 1 -->
              <div class="relative flex items-center justify-between">
                <div class="w-[45%] text-right pr-12">
                  <h4 class="text-xl font-medium mb-2">Capture</h4>
                  <p class="text-white/60 text-sm">Direct ingestion of RTSP/ONVIF camera feeds with end-to-end encryption.</p>
                </div>
                <div class="absolute left-1/2 -translate-x-1/2 w-10 h-10 bg-black border border-white/20 rounded-full flex items-center justify-center z-10">
                  <span class="material-symbols-outlined text-[18px]" data-icon="videocam">videocam</span>
                </div>
                <div class="w-[45%]"></div>
              </div>
              <!-- Step 2 -->
              <div class="relative flex items-center justify-between">
                <div class="w-[45%]"></div>
                <div class="absolute left-1/2 -translate-x-1/2 w-10 h-10 bg-black border border-white/20 rounded-full flex items-center justify-center z-10">
                  <span class="material-symbols-outlined text-[18px]" data-icon="psychology">psychology</span>
                </div>
                <div class="w-[45%] text-left pl-12">
                  <h4 class="text-xl font-medium mb-2">Analyze</h4>
                  <p class="text-white/60 text-sm">Frame-by-frame processing using localized edge-compute nodes for speed.</p>
                </div>
              </div>
              <!-- Step 3 -->
              <div class="relative flex items-center justify-between">
                <div class="w-[45%] text-right pr-12">
                  <h4 class="text-xl font-medium mb-2">Classify</h4>
                  <p class="text-white/60 text-sm">Object detection and event classification using high-confidence AI models.</p>
                </div>
                <div class="absolute left-1/2 -translate-x-1/2 w-10 h-10 bg-black border border-white/20 rounded-full flex items-center justify-center z-10">
                  <span class="material-symbols-outlined text-[18px]" data-icon="label">label</span>
                </div>
                <div class="w-[45%]"></div>
              </div>
              <!-- Step 4 -->
              <div class="relative flex items-center justify-between">
                <div class="w-[45%]"></div>
                <div class="absolute left-1/2 -translate-x-1/2 w-10 h-10 bg-black border border-white/20 rounded-full flex items-center justify-center z-10">
                  <span class="material-symbols-outlined text-[18px]" data-icon="notifications_active">notifications_active</span>
                </div>
                <div class="w-[45%] text-left pl-12">
                  <h4 class="text-xl font-medium mb-2">Act</h4>
                  <p class="text-white/60 text-sm">Automated alert generation for emergency services and traffic management.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- SECTION 5: RELIABILITY & INFRASTRUCTURE -->
        <section class="px-12 py-32 max-w-7xl mx-auto border-y border-white/5 relative z-10">
          <div class="max-w-3xl mx-auto text-center mb-20">
            <h2 class="text-4xl font-medium tracking-tight mb-8">Built for Continuous Operation</h2>
            <div class="h-1 w-24 bg-white/10 mx-auto"></div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-16">
            <div class="flex flex-col gap-4 text-center">
              <h5 class="text-lg font-medium">Fault-tolerant streaming</h5>
              <p class="text-white/60 text-sm leading-relaxed">Multi-homed data paths ensure zero signal loss even during primary link failure.</p>
            </div>
            <div class="flex flex-col gap-4 text-center">
              <h5 class="text-lg font-medium">Configurable thresholds</h5>
              <p class="text-white/60 text-sm leading-relaxed">Define sensitivity parameters per node to reduce false positive incident triggers.</p>
            </div>
            <div class="flex flex-col gap-4 text-center">
              <h5 class="text-lg font-medium">Persistent monitoring</h5>
              <p class="text-white/60 text-sm leading-relaxed">24/7 autonomous sessions with automated self-healing and error reporting.</p>
            </div>
          </div>
        </section>

        <!-- SECTION 6: DEVELOPER / API -->
        <section class="px-12 py-32 max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-24 items-center relative z-10">
          <div>
            <h2 class="text-4xl font-medium tracking-tight mb-6">Integrate with Your Systems</h2>
            <p class="text-lg text-white/70 leading-relaxed mb-8">Our RESTful API is designed for engineers. Connect Citadel's analytical engine to your existing dispatcher, reporting tools, or mobile apps with ease.</p>
            <div class="flex gap-4">
              <a class="flex items-center gap-2 text-white text-sm uppercase tracking-widest font-medium hover:translate-x-1 transition-transform" href="#">
                Documentation <span class="material-symbols-outlined text-[16px]" data-icon="chevron_right">chevron_right</span>
              </a>
            </div>
          </div>
          <div class="bg-surface-container-lowest p-8 rounded-lg border border-white/10 font-mono text-[13px] leading-relaxed relative overflow-hidden group">
            <div class="flex gap-2 mb-6">
              <div class="w-3 h-3 rounded-full bg-white/20"></div>
              <div class="w-3 h-3 rounded-full bg-white/20"></div>
              <div class="w-3 h-3 rounded-full bg-white/20"></div>
            </div>
            <pre class="text-white/80"><code><span class="text-white/40"># Initialize Monitoring Session</span>
<span class="text-white">curl</span> -X POST "https://api.citadel.io/v1/sessions" \\
  -H "Authorization: Bearer <span class="text-white/40">$API_KEY</span>" \\
  -d '{
    <span class="text-white/60">"node_id"</span>: <span class="text-white">"NYC_CAM_882"</span>,
    <span class="text-white/60">"analysis_mode"</span>: <span class="text-white">"ACCIDENT_DETECTION"</span>,
    <span class="text-white/60">"webhook_url"</span>: <span class="text-white">"https://ops.city.gov/alerts"</span>
  }'</code></pre>
            <div class="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <span class="material-symbols-outlined text-white/40 cursor-pointer" data-icon="content_copy">content_copy</span>
            </div>
          </div>
        </section>

        <!-- SECTION 7: FINAL CTA -->
        <section class="py-[120px] px-12 text-center flex flex-col items-center relative z-10">
          <h2 class="text-5xl font-medium tracking-tight mb-12">Start Monitoring with Citadel</h2>
          <a href="#/dashboard" class="bg-white text-black px-10 py-4 rounded-full font-medium text-[14px] hover:scale-105 transition-transform duration-300 glow-streak shadow-[0_0_40px_rgba(255,255,255,0.1)] inline-block">
            Request Access
          </a>
        </section>
      </main>

      <!-- Footer -->
      <footer class="w-full py-24 border-t border-white/5 relative z-10">
        <div class="max-w-7xl mx-auto px-12 grid grid-cols-1 md:grid-cols-4 gap-12 mb-24">
          <div class="flex flex-col gap-6">
            <div class="text-lg font-medium tracking-widest text-white">CITADEL</div>
            <p class="text-white/40 font-['General_Sans'] text-[0.875rem] max-w-[200px]">High-signal minimalism for global infrastructure.</p>
          </div>
          <div class="flex flex-col gap-4">
            <span class="text-xs uppercase tracking-widest text-white/60 mb-2">Product</span>
            <a class="text-white/40 font-['General_Sans'] text-[0.875rem] hover:text-white transition-colors" href="#">Capabilities</a>
            <a class="text-white/40 font-['General_Sans'] text-[0.875rem] hover:text-white transition-colors" href="#">Safety Logic</a>
            <a class="text-white/40 font-['General_Sans'] text-[0.875rem] hover:text-white transition-colors" href="#">Hardware</a>
          </div>
          <div class="flex flex-col gap-4">
            <span class="text-xs uppercase tracking-widest text-white/60 mb-2">Resources</span>
            <a class="text-white/40 font-['General_Sans'] text-[0.875rem] hover:text-white transition-colors" href="#">Documentation</a>
            <a class="text-white/40 font-['General_Sans'] text-[0.875rem] hover:text-white transition-colors" href="#">API Reference</a>
            <a class="text-white/40 font-['General_Sans'] text-[0.875rem] hover:text-white transition-colors" href="#">Case Studies</a>
          </div>
          <div class="flex flex-col gap-4">
            <span class="text-xs uppercase tracking-widest text-white/60 mb-2">Company</span>
            <a class="text-white/40 font-['General_Sans'] text-[0.875rem] hover:text-white transition-colors" href="#">Privacy Policy</a>
            <a class="text-white/40 font-['General_Sans'] text-[0.875rem] hover:text-white transition-colors" href="#">Terms of Service</a>
            <a class="text-white/40 font-['General_Sans'] text-[0.875rem] hover:text-white transition-colors" href="#">Security</a>
          </div>
        </div>
        <div class="max-w-7xl mx-auto px-12 flex flex-col md:flex-row justify-between items-end gap-8">
          <div class="text-white/40 font-['General_Sans'] text-[0.875rem] uppercase tracking-widest">
            © 2024 CITADEL. HIGH-SIGNAL MINIMALISM.
          </div>
          <div class="flex gap-8">
            <a class="text-white/40 hover:text-white transition-colors" href="#">
              <span class="material-symbols-outlined" data-icon="language">language</span>
            </a>
            <a class="text-white/40 hover:text-white transition-colors" href="#">
              <span class="material-symbols-outlined" data-icon="terminal">terminal</span>
            </a>
            <a class="text-white/40 hover:text-white transition-colors" href="#">
              <span class="material-symbols-outlined" data-icon="hub">hub</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  `;
}

