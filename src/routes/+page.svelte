<script lang="ts">
  import { goto } from '$app/navigation';
  
  let isMobileMenuOpen = false;

  function scrollToSection(id: string) {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
      isMobileMenuOpen = false;
    }
  }

  function toggleMenu() {
    isMobileMenuOpen = !isMobileMenuOpen;
  }
</script>

<svelte:head>
  <title>Go Route Yourself - Route Planning & Profit Tracking for Drivers</title>
  <meta name="description" content="The easiest way to plan routes, track costs, and maximize profits for delivery drivers and field workers. Free route optimizer and expense tracker." />
  <meta name="keywords" content="route planner, delivery driver app, profit tracker, mileage tracker, route optimization, field service software" />
  
  <link rel="canonical" href="https://gorouteyourself.com/" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://gorouteyourself.com/" />
  <meta property="og:title" content="Go Route Yourself - Maximize Your Driving Profits" />
  <meta property="og:description" content="Plan optimal routes, track fuel and expenses, and see your true profit per hour. The all-in-one tool for drivers." />
  <meta property="og:image" content="https://gorouteyourself.com/og-image.png" />

  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:url" content="https://gorouteyourself.com/" />
  <meta property="twitter:title" content="Go Route Yourself - Route Planning & Profit Tracking" />
  <meta property="twitter:description" content="Stop guessing your profits. Track every mile, expense, and earning with Go Route Yourself." />
  <meta property="twitter:image" content="https://gorouteyourself.com/og-image.png" />

  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "Go Route Yourself",
      "headline": "Route Planning & Profit Tracking for Drivers",
      "image": "https://gorouteyourself.com/logo.png",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web, Android, iOS",
      "offers": {
        "@type": "AggregateOffer",
        "priceCurrency": "USD",
        "lowPrice": "0",
        "offerCount": "2"
      },
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": "4.8",
        "ratingCount": "500"
      },
      "featureList": "Route Optimization, Profit Tracking, Expense Management, Mileage Log"
    }
  </script>
</svelte:head>

<div class="landing">
  <header class="header">
    <div class="container">
      <div class="header-content">
        <img src="/logo.png" alt="Go Route Yourself" class="logo" />
        
        <nav class="nav desktop-nav">
          <button on:click={() => scrollToSection('features')}>Features</button>
          <button on:click={() => scrollToSection('how-it-works')}>How It Works</button>
          <button on:click={() => scrollToSection('pricing')}>Pricing</button>
          
          <a href="/login" class="btn-login">Sign In</a>
          <a href="/register" class="btn-primary">Get Started Free</a>
        </nav>

        <div class="mobile-nav-controls">
          <a href="/login" class="mobile-signin">Sign In</a>
          
          <button class="hamburger-btn" on:click={toggleMenu} aria-label="Toggle menu">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              {#if isMobileMenuOpen}
                <path d="M18 6L6 18M6 6L18 18"></path>
              {:else}
                <path d="M3 12h18M3 6h18M3 18h18"></path>
              {/if}
            </svg>
          </button>
        </div>
      </div>
    </div>

    {#if isMobileMenuOpen}
      <div class="mobile-menu">
        <button on:click={() => scrollToSection('features')}>Features</button>
        <button on:click={() => scrollToSection('pricing')}>Pricing</button>
        <button on:click={() => scrollToSection('how-it-works')}>How It Works</button>
        <div class="divider"></div>
        <a href="/register" class="btn-primary mobile-btn">Get Started Free</a>
      </div>
    {/if}
  </header>
  
  <section class="hero">
    <div class="container">
      <div class="hero-content">
        <h1>Plan Routes. Track Costs. <span class="highlight">Maximize Profits.</span></h1>
        <p class="hero-subtitle">
          The complete route planning and profit tracking solution for delivery drivers, 
          field workers, and anyone who gets paid by the route.
        </p>
        
        <div class="hero-buttons">
          <a href="/register" class="btn-hero-primary">Start Free Trial</a>
          <button on:click={() => scrollToSection('how-it-works')} class="btn-hero-secondary">
            Learn More
          </button>
        </div>
        
        <div class="hero-stats">
          <div class="stat">
            <div class="stat-number">10K+</div>
            <div class="stat-label">Routes Planned</div>
          </div>
          <div class="stat">
            <div class="stat-number">$2M+</div>
            <div class="stat-label">Profit Tracked</div>
          </div>
          <div class="stat">
            <div class="stat-number">500+</div>
            <div class="stat-label">Active Drivers</div>
          </div>
        </div>
      </div>
    </div>
  </section>
  
  <section id="features" class="features">
    <div class="container">
      <h2 class="section-title">Everything You Need to Succeed</h2>
      <p class="section-subtitle">Powerful features designed specifically for drivers</p>
      
      <div class="features-grid">
        <div class="feature-card orange">
          <div class="feature-icon">🗺️</div>
          <h3>Google Maps Integration</h3>
          <p>Plan optimal routes with real-time traffic data, turn-by-turn directions, and automatic mileage calculation.</p>
        </div>
        
        <div class="feature-card blue">
          <div class="feature-icon">💰</div>
          <h3>Profit Tracking</h3>
          <p>Track earnings, fuel costs, maintenance, and supplies. See your actual profit per trip and per hour worked.</p>
        </div>
        
        <div class="feature-card green">
          <div class="feature-icon">📊</div>
          <h3>Analytics Dashboard</h3>
          <p>Beautiful charts and stats showing trends, costs breakdown, and performance over time.</p>
        </div>
        
        <div class="feature-card navy">
          <div class="feature-icon">📱</div>
          <h3>Mobile Friendly</h3>
          <p>Works perfectly on your phone, tablet, or computer. Access your routes anywhere, anytime.</p>
        </div>
        
        <div class="feature-card purple">
          <div class="feature-icon">📤</div>
          <h3>Export Reports</h3>
          <p>Generate CSV and PDF reports for taxes, record-keeping, or sharing with your accountant.</p>
        </div>
        
        <div class="feature-card orange">
          <div class="feature-icon">💾</div>
          <h3>Cloud Sync</h3>
          <p>Your data syncs automatically across all devices. Never lose a trip log again.</p>
        </div>
      </div>
    </div>
  </section>
  
  <section id="how-it-works" class="how-it-works">
    <div class="container">
      <h2 class="section-title">How It Works</h2>
      <p class="section-subtitle">Start tracking profits in 3 simple steps</p>
      
      <div class="steps">
        <div class="step">
          <div class="step-number orange">1</div>
          <div class="step-content">
            <h3>Plan Your Route</h3>
            <p>Enter your starting point and destinations. We'll calculate the optimal route and estimate drive time using Google Maps.</p>
          </div>
        </div>
        
        <div class="step">
          <div class="step-number blue">2</div>
          <div class="step-content">
            <h3>Track Your Costs</h3>
            <p>Add earnings per stop, fuel costs, maintenance, and supplies. We automatically calculate your profit.</p>
          </div>
        </div>
        
        <div class="step">
          <div class="step-number green">3</div>
          <div class="step-content">
            <h3>View Your Analytics</h3>
            <p>See your profit trends, cost breakdowns, and performance metrics. Export reports for taxes.</p>
          </div>
        </div>
      </div>
    </div>
  </section>
  
  <section id="pricing" class="pricing">
    <div class="container">
      <h2 class="section-title">Simple, Transparent Pricing</h2>
      <p class="section-subtitle">Choose the plan that works for you</p>
      
      <div class="pricing-grid">
        <div class="pricing-card">
          <div class="plan-header">
            <h3>Free</h3>
            <div class="price">
              <span class="currency">$</span>
              <span class="amount">0</span>
              <span class="period">/month</span>
            </div>
          </div>
          
          <ul class="features-list">
            <li>✓ 10 trips per month</li>
            <li>✓ Google Maps routing</li>
            <li>✓ Basic profit tracking</li>
            <li>✓ Mobile app access</li>
          </ul>
          
          <a href="/register" class="btn-plan">Get Started</a>
        </div>
        
        <div class="pricing-card featured">
          <div class="badge">Most Popular</div>
          <div class="plan-header">
            <h3>Pro</h3>
            <div class="price">
              <span class="currency">$</span>
              <span class="amount">2.99</span>
              <span class="period">/month</span>
            </div>
          </div>
          
          <ul class="features-list">
            <li>✓ Unlimited trips</li>
            <li>✓ Advanced analytics</li>
            <li>✓ PDF reports</li>
            <li>✓ Cloud backup</li>
            <li>✓ Priority support</li>
            <li>✓ Custom reports</li>
          </ul>
          
          <a href="/register" class="btn-plan featured">Start Free Trial</a>
        </div>
        
        <div class="pricing-card">
          <div class="plan-header">
            <h3>Business</h3>
            <div class="price">
              <span class="currency">$</span>
              <span class="amount">29.99</span>
              <span class="period">/month</span>
            </div>
          </div>
          
          <ul class="features-list">
            <li>✓ Everything in Pro</li>
            <li>✓ Team management</li>
            <li>✓ Multi-user access</li>
            <li>✓ API access</li>
            <li>✓ White-label reports</li>
            <li>✓ Dedicated support</li>
          </ul>
          
          <a href="/contact" class="btn-plan">Contact Sales</a>
        </div>
      </div>
    </div>
  </section>
  
  <section class="cta">
    <div class="container">
      <div class="cta-content">
        <h2>Ready to Maximize Your Profits?</h2>
        <p>Join hundreds of drivers who are already tracking their routes and increasing their earnings.</p>
        <div class="cta-buttons">
          <a href="/register" class="btn-cta-primary">Start Free Trial</a>
          <span class="cta-note">No credit card required</span>
        </div>
      </div>
    </div>
  </section>
  
  <footer class="footer">
    <div class="container">
      <div class="footer-content">
        <div class="footer-section">
          <img src="/logo.png" alt="Go Route Yourself" class="footer-logo" />
          <p>Route planning and profit tracking for drivers.</p>
        </div>
        
        <div class="footer-section">
          <h4>Product</h4>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#how-it-works">How It Works</a>
        </div>
        
        <div class="footer-section">
          <h4>Company</h4>
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
          <a href="/blog">Blog</a>
        </div>
        
        <div class="footer-section">
          <h4>Legal</h4>
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
        </div>
      </div>
      
      <div class="footer-bottom">
        <p>&copy; {new Date().getFullYear()} Go Route Yourself. All rights reserved.</p>
      </div>
    </div>
  </footer>
</div>

<style>
  /* Brand Colors */
  :root {
    --orange: #FF7F50;
    --blue: #29ABE2;
    --navy: #2C4A6E;
    --green: #8DC63F;
    --purple: #8B5A9E;
    --gray-50: #F9FAFB;
    --gray-100: #F3F4F6;
    --gray-200: #E5E7EB;
    --gray-500: #6B7280;
    --gray-600: #4B5563;
    --gray-900: #111827;
  }
  
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  
  .landing {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    line-height: 1.6;
    color: var(--gray-900);
  }
  
  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 20px;
  }
  
  /* Header & Navigation */
  .header {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: white;
    border-bottom: 1px solid var(--gray-100);
    z-index: 1000;
    padding: 16px 0;
  }
  
  .header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .logo {
    height: 50px;
    width: auto;
  }
  
  /* Desktop Navigation */
  .desktop-nav {
    display: none; /* Changed from flex to none */
    align-items: center;
    gap: 24px;
  }
  
  .desktop-nav button {
    background: none;
    border: none;
    color: var(--gray-600);
    font-size: 16px;
    cursor: pointer;
    transition: color 0.2s;
  }
  
  .desktop-nav button:hover {
    color: var(--orange);
  }
  
  .btn-login {
    color: var(--gray-600);
    text-decoration: none;
    font-weight: 500;
  }
  
  .btn-primary {
    background: var(--orange);
    color: white;
    padding: 10px 24px;
    border-radius: 8px;
    text-decoration: none;
    font-weight: 600;
    transition: transform 0.2s;
  }
  
  .btn-primary:hover {
    transform: translateY(-2px);
  }

  /* Mobile Controls Container (Hidden on Desktop) */
  .mobile-nav-controls {
    display: flex; /* Changed from none to flex */
    align-items: center;
    gap: 16px;
  }

  .mobile-signin {
    text-decoration: none;
    color: var(--navy);
    font-weight: 600;
    font-size: 15px;
  }

  .hamburger-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--gray-600);
    display: flex;
    align-items: center;
    padding: 4px;
  }

  /* Mobile Dropdown Menu */
  .mobile-menu {
    position: absolute;
    top: 100%;
    left: 0;
    width: 100%;
    background: white;
    border-bottom: 1px solid var(--gray-100);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  }

  .mobile-menu button, .mobile-link {
    background: none;
    border: none;
    text-align: left;
    font-size: 16px;
    color: var(--gray-600);
    padding: 8px 0;
    cursor: pointer;
    text-decoration: none;
  }
  
  .divider { height: 1px; background: var(--gray-100); margin: 4px 0; }
  .mobile-btn { text-align: center;
    display: block; }
  
  /* Hero Section */
  .hero {
    /* Mobile-first padding (reduced top) */
    padding: 100px 0 60px;
    background: linear-gradient(135deg, var(--navy) 0%, var(--blue) 100%);
    color: white;
    text-align: center;
  }
  
  .hero h1 {
    /* Mobile-first font size */
    font-size: 36px;
    font-weight: 800;
    margin-bottom: 24px;
    line-height: 1.2;
  }
  
  .highlight {
    color: var(--orange);
  }
  
  .hero-subtitle {
    font-size: 18px;
    /* Slightly smaller for mobile */
    max-width: 700px;
    margin: 0 auto 40px;
    opacity: 0.95;
  }
  
  .hero-buttons {
    display: flex;
    flex-direction: column;
    /* Stack buttons on mobile */
    gap: 16px;
    justify-content: center;
    margin-bottom: 60px;
  }
  
  .btn-hero-primary {
    background: var(--orange);
    color: white;
    padding: 16px 40px;
    border-radius: 12px;
    font-size: 18px;
    font-weight: 700;
    text-decoration: none;
    transition: all 0.2s;
  }
  
  .btn-hero-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(255, 127, 80, 0.4);
  }
  
  .btn-hero-secondary {
    background: transparent;
    color: white;
    border: 2px solid white;
    padding: 14px 38px;
    border-radius: 12px;
    font-size: 18px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .btn-hero-secondary:hover {
    background: white;
    color: var(--navy);
  }
  
  .hero-stats {
    display: flex;
    flex-direction: column;
    /* Stack stats on mobile */
    justify-content: center;
    gap: 32px;
  }
  
  .stat {
    text-align: center;
  }
  
  .stat-number {
    font-size: 36px;
    font-weight: 800;
    margin-bottom: 8px;
  }
  
  .stat-label {
    font-size: 14px;
    opacity: 0.9;
  }
  
  /* Features Section */
  .features {
    padding: 60px 0;
    background: white;
  }
  
  .section-title {
    font-size: 32px;
    /* Smaller mobile title */
    font-weight: 800;
    text-align: center;
    margin-bottom: 16px;
    color: var(--navy);
  }
  
  .section-subtitle {
    font-size: 18px;
    color: var(--gray-600);
    text-align: center;
    margin-bottom: 40px;
  }
  
  .features-grid {
    display: grid;
    grid-template-columns: 1fr;
    /* 1 column on mobile */
    gap: 32px;
  }
  
  .feature-card {
    padding: 32px;
    background: white;
    border-radius: 16px;
    border: 2px solid var(--gray-100);
    transition: all 0.3s;
  }
  
  .feature-card:hover {
    transform: translateY(-8px);
    box-shadow: 0 12px 40px rgba(0,0,0,0.1);
  }
  
  .feature-card.orange:hover { border-color: var(--orange); }
  .feature-card.blue:hover { border-color: var(--blue); }
  .feature-card.green:hover { border-color: var(--green); }
  .feature-card.navy:hover { border-color: var(--navy); }
  .feature-card.purple:hover { border-color: var(--purple); }
  
  .feature-icon {
    font-size: 48px;
    margin-bottom: 20px;
  }
  
  .feature-card h3 {
    font-size: 24px;
    margin-bottom: 12px;
    color: var(--navy);
  }
  
  .feature-card p {
    color: var(--gray-600);
    line-height: 1.7;
  }
  
  /* How It Works */
  .how-it-works {
    padding: 60px 0;
    background: var(--gray-50);
  }
  
  .steps {
    max-width: 800px;
    margin: 0 auto;
  }
  
  .step {
    display: flex;
    flex-direction: column;
    /* Stack vertical on mobile */
    gap: 24px;
    margin-bottom: 60px;
    align-items: center;
    /* Center align items */
    text-align: center;
  }
  
  .step-number {
    width: 60px;
    height: 60px;
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    font-weight: 800;
    flex-shrink: 0;
  }
  
  .step-number.orange { background: var(--orange); }
  .step-number.blue { background: var(--blue); }
  .step-number.green { background: var(--green); }
  
  .step-content h3 {
    font-size: 24px;
    margin-bottom: 12px;
    color: var(--navy);
  }
  
  .step-content p {
    color: var(--gray-600);
    font-size: 16px;
    line-height: 1.7;
  }
  
  /* Pricing Section */
  .pricing {
    padding: 60px 0;
    background: white;
  }
  
  .pricing-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 32px;
    max-width: 1000px;
    margin: 0 auto;
  }
  
  .pricing-card {
    background: white;
    border: 2px solid var(--gray-100);
    border-radius: 16px;
    padding: 40px;
    position: relative;
    transition: all 0.3s;
  }
  
  .pricing-card:hover {
    transform: translateY(-8px);
    box-shadow: 0 12px 40px rgba(0,0,0,0.1);
  }
  
  .pricing-card.featured {
    border-color: var(--orange);
    box-shadow: 0 8px 32px rgba(255, 127, 80, 0.2);
  }
  
  .badge {
    position: absolute;
    top: -12px;
    right: 20px;
    background: var(--orange);
    color: white;
    padding: 6px 16px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 700;
  }
  
  .plan-header {
    text-align: center;
    margin-bottom: 32px;
  }
  
  .plan-header h3 {
    font-size: 24px;
    margin-bottom: 16px;
    color: var(--navy);
  }
  
  .price {
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }
  
  .currency {
    font-size: 24px;
    font-weight: 700;
    color: var(--navy);
  }
  
  .amount {
    font-size: 56px;
    font-weight: 800;
    line-height: 1;
    color: var(--navy);
  }
  
  .period {
    font-size: 18px;
    color: var(--gray-600);
    margin-left: 4px;
    align-self: flex-end;
    margin-bottom: 8px;
  }
  
  .features-list {
    list-style: none;
    margin-bottom: 32px;
  }
  
  .features-list li {
    padding: 12px 0;
    border-bottom: 1px solid var(--gray-100);
    color: var(--gray-900);
  }
  
  .btn-plan {
    display: block;
    width: 100%;
    text-align: center;
    padding: 14px;
    background: var(--gray-100);
    color: var(--navy);
    border-radius: 8px;
    text-decoration: none;
    font-weight: 600;
    transition: all 0.2s;
  }
  
  .btn-plan:hover {
    background: var(--gray-100);
  }
  
  .btn-plan.featured {
    background: var(--orange);
    color: white;
  }
  
  .btn-plan.featured:hover {
    transform: translateY(-2px);
  }
  
  /* CTA Section */
  .cta {
    padding: 80px 0;
    background: linear-gradient(135deg, var(--orange) 0%, var(--green) 100%);
    color: white;
    text-align: center;
  }
  
  .cta h2 {
    font-size: 32px;
    font-weight: 800;
    margin-bottom: 16px;
  }
  
  .cta p {
    font-size: 18px;
    margin-bottom: 40px;
    opacity: 0.95;
  }
  
  .cta-buttons {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  
  .btn-cta-primary {
    background: white;
    color: var(--orange);
    padding: 16px 48px;
    border-radius: 12px;
    font-size: 18px;
    font-weight: 700;
    text-decoration: none;
    transition: all 0.2s;
  }
  
  .btn-cta-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  }
  
  .cta-note {
    font-size: 14px;
    opacity: 0.9;
  }
  
  /* Footer */
  .footer {
    background: var(--gray-50);
    color: var(--gray-900);
    padding: 60px 0 20px;
    border-top: 1px solid var(--gray-200);
  }
  
  .footer-content {
    display: grid;
    grid-template-columns: 1fr;
    gap: 40px;
    margin-bottom: 40px;
  }
  
  .footer-logo {
    height: 40px;
    margin-bottom: 16px;
  }
  
  .footer-section h4 {
    margin-bottom: 16px;
    font-size: 16px;
    color: var(--navy);
    font-weight: 700;
  }
  
  .footer-section a {
    display: block;
    color: var(--gray-600);
    text-decoration: none;
    margin-bottom: 12px;
    transition: color 0.2s;
  }
  
  .footer-section a:hover {
    color: var(--orange);
  }
  
  .footer-section p {
    color: var(--gray-600);
  }
  
  .footer-bottom {
    text-align: center;
    padding-top: 20px;
    border-top: 1px solid var(--gray-200);
    color: var(--gray-500);
  }
  
  /* --- Desktop Responsive --- */
  @media (min-width: 768px) {
    .desktop-nav {
      display: flex;
    }
    
    .mobile-nav-controls {
      display: none;
    }
    
    .hero {
      padding: 140px 0 80px;
    }
    
    .hero h1 {
      font-size: 56px;
    }
    
    .hero-subtitle {
      font-size: 20px;
    }
    
    .hero-buttons {
      flex-direction: row;
    }
    
    .hero-stats {
      flex-direction: row;
      gap: 80px;
    }
    
    .features {
      padding: 100px 0;
    }
    
    .features-grid {
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    }
    
    .section-title {
      font-size: 42px;
    }
    
    .section-subtitle {
      font-size: 20px;
    }
    
    .how-it-works {
      padding: 100px 0;
    }
    
    .step {
      flex-direction: row;
      text-align: left;
      align-items: flex-start;
    }
    
    .step-content h3 {
      font-size: 28px;
    }
    
    .step-content p {
      font-size: 18px;
    }
    
    .pricing {
      padding: 100px 0;
    }
    
    .pricing-grid {
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    }
    
    .footer-content {
      grid-template-columns: 2fr 1fr 1fr 1fr;
    }
  }
</style>