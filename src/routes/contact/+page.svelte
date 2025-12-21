<script lang="ts">
  let isMobileMenuOpen = false;

  function toggleMenu() {
    isMobileMenuOpen = !isMobileMenuOpen;
  }
</script>

<svelte:head>
  <title>Contact Sales - Go Route Yourself</title>
  <meta name="description" content="Contact our sales team for custom route planning solutions. Get a tailored plan for your delivery fleet." />
  
  <meta property="og:title" content="Contact Sales - Go Route Yourself" />
  <meta property="og:description" content="Need a custom solution for your drivers? Contact our sales team today." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://gorouteyourself.com/contact" />

  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "ContactPage",
      "name": "Contact Sales",
      "description": "Get in touch with our sales team for Go Route Yourself business plans.",
      "url": "https://gorouteyourself.com/contact"
    }
  </script>
</svelte:head>

<div class="contact-page">
  <header class="header">
    <div class="container">
      <div class="header-content">
        <a href="/" class="logo-link">
            <img src="/logo.png" alt="Go Route Yourself" class="logo" />
        </a>
        
        <nav class="nav desktop-nav">
          <a href="/#features">Features</a>
          <a href="/#pricing">Pricing</a>
          <a href="/#how-it-works">How It Works</a>
          
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
        <a href="/#features">Features</a>
        <a href="/#pricing">Pricing</a>
        <a href="/#how-it-works">How It Works</a>
        <div class="divider"></div>
        <a href="/register" class="btn-primary mobile-btn">Get Started Free</a>
      </div>
    {/if}
  </header>

  <main class="main-content">
    <div class="container">
      <div class="content-wrapper">
        <div class="text-column">
            <h1>Contact Sales</h1>
            <p class="subtitle">
                Ready to scale your delivery operations? Let's talk about how Go Route Yourself can help your team save time and maximize profits.
            </p>
            
            <div class="contact-info">
                <div class="info-item">
                    <span class="icon">📧</span>
                    <a href="mailto:sales@gorouteyourself.com">sales@gorouteyourself.com</a>
                </div>
                 <div class="info-item">
                    <span class="icon">🏢</span>
                    <p>Business Plan Inquiries</p>
                </div>
            </div>
        </div>

        <div class="form-column">
            <form class="contact-form" method="POST">
                <div class="form-group">
                    <label for="name">Name</label>
                    <input type="text" id="name" name="name" required placeholder="Your name" />
                </div>
                
                <div class="form-group">
                    <label for="email">Work Email</label>
                    <input type="email" id="email" name="email" required placeholder="you@company.com" />
                </div>

                <div class="form-group">
                    <label for="company">Company Name</label>
                    <input type="text" id="company" name="company" placeholder="Your company" />
                </div>
                
                <div class="form-group">
                    <label for="message">How can we help?</label>
                    <textarea id="message" name="message" rows="4" required placeholder="Tell us about your team size and needs..."></textarea>
                </div>

                <button type="submit" class="btn-submit">Send Message</button>
            </form>
        </div>
      </div>
    </div>
  </main>
</div>

<style>
    /* Brand Colors & Variables */
    :root {
        --orange: #FF7F50;
        --blue: #29ABE2;
        --navy: #2C4A6E;
        --gray-100: #F3F4F6;
        --gray-600: #4B5563;
        --gray-900: #111827;
    }

    * { box-sizing: border-box; }

    /* Page Wrapper */
    .contact-page {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        color: var(--gray-900);
        background: white;
        /* Ensure it covers the full height and sits above the layout background */
        min-height: 100vh;
        padding-top: 80px; /* Space for fixed header */
    }

    .container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 0 20px;
    }

    /* Header Styles (Consistent with Landing) */
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

    .logo { height: 50px; width: auto; }
    
    .desktop-nav { display: none; align-items: center; gap: 24px; }
    .desktop-nav a { text-decoration: none; color: var(--gray-600); font-size: 16px; font-weight: 500; transition: color 0.2s; background: none; border: none; cursor: pointer;}
    .desktop-nav a:hover { color: var(--orange); }
    
    .btn-login { color: var(--gray-600); font-weight: 500; }
    .btn-primary { background: var(--orange); color: white !important; padding: 10px 24px; border-radius: 8px; font-weight: 600; }
    .btn-primary:hover { transform: translateY(-2px); }

    .mobile-nav-controls { display: flex; align-items: center; gap: 16px; }
    .mobile-signin { text-decoration: none; color: var(--navy); font-weight: 600; font-size: 15px; }
    .hamburger-btn { background: none; border: none; cursor: pointer; color: var(--gray-600); padding: 4px; display: flex; align-items: center;}

    .mobile-menu {
        position: absolute; top: 100%; left: 0; width: 100%; background: white;
        border-bottom: 1px solid var(--gray-100); padding: 16px; display: flex; flex-direction: column; gap: 16px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .mobile-menu a { text-decoration: none; color: var(--gray-600); font-size: 16px; }
    .divider { height: 1px; background: var(--gray-100); margin: 4px 0; }
    .mobile-btn { text-align: center; display: block; }

    /* Content Area */
    .main-content {
        padding: 60px 0;
    }

    .content-wrapper {
        display: grid;
        grid-template-columns: 1fr;
        gap: 40px;
    }

    h1 { font-size: 36px; font-weight: 800; color: var(--navy); margin-bottom: 16px; line-height: 1.2; }
    .subtitle { font-size: 18px; color: var(--gray-600); margin-bottom: 32px; line-height: 1.6; }

    .contact-info { margin-bottom: 32px; }
    .info-item { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; font-size: 18px; color: var(--gray-600); }
    .info-item a { color: var(--blue); text-decoration: none; font-weight: 500; }
    .info-item .icon { font-size: 24px; }

    /* Form Styles */
    .contact-form {
        background: var(--gray-100);
        padding: 32px;
        border-radius: 16px;
    }

    .form-group { margin-bottom: 20px; }
    label { display: block; margin-bottom: 8px; font-weight: 600; color: var(--navy); }
    
    input, textarea {
        width: 100%; 
        padding: 12px; 
        border: 1px solid #e5e7eb; 
        border-radius: 8px; 
        font-size: 16px;
        font-family: inherit;
    }
    
    input:focus, textarea:focus { 
        outline: 2px solid var(--blue); 
        border-color: transparent; 
    }

    .btn-submit {
        width: 100%; 
        background: var(--navy); 
        color: white; 
        padding: 14px; 
        border: none; 
        border-radius: 8px;
        font-size: 16px; 
        font-weight: 700; 
        cursor: pointer; 
        transition: background 0.2s;
    }
    .btn-submit:hover { background: var(--blue); }

    @media (min-width: 768px) {
        .desktop-nav { display: flex; }
        .mobile-nav-controls { display: none; }
        
        .main-content { padding: 100px 0; }
        .content-wrapper { grid-template-columns: 1fr 1fr; gap: 80px; align-items: start; }
        h1 { font-size: 48px; }
    }
</style>