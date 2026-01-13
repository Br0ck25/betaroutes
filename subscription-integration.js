// ============================================
// SUBSCRIPTION MANAGEMENT FUNCTIONS
// This file should be appended to app.js OR included as separate script
// ============================================

// Global variable to track subscription status
let currentSubscription = null;

// Check subscription status on page load
async function checkSubscriptionStatus() {
	const token = localStorage.getItem('token');
	if (!token) return;

	const username = localStorage.getItem('username');
	console.log('Subscription Check: found username =', username);
	if (username === 'James') {
		currentSubscription = {
			plan: 'pro',
			status: 'active',
			tripsThisMonth: 0,
			maxTrips: Infinity,
			resetDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
			features: ['cloud-sync', 'export', 'analytics', 'optimization']
		};
		console.log(
			'!!! DEBUG MODE: User James forced to Pro Plan for testing. Current Username:',
			username
		);
		updateSubscriptionUI();
		updateSubscriptionInfoInMenu();
		return;
	}

	try {
		const response = await fetch('https://logs.gorouteyourself.com/api/subscription', {
			headers: { Authorization: token }
		});

		if (response.ok) {
			currentSubscription = await response.json();
			updateSubscriptionUI();
			updateSubscriptionInfoInMenu();
		}
	} catch (err) {
		console.error('❌ Failed to check subscription:', err);
	}
}

// Update UI based on subscription status
function updateSubscriptionUI() {
	if (!currentSubscription) return;

	const plan = currentSubscription.plan;
	const usernameDisplay = document.getElementById('username-display');

	// Add plan badge to username
	if (usernameDisplay && plan !== 'free') {
		const username = localStorage.getItem('username');
		const badge = plan === 'pro' ? '⭐' : '💼';
		usernameDisplay.textContent = `${username} ${badge}`;
	}

	// Show trip limit warning for free users
	if (plan === 'free') {
		const tripsRemaining = currentSubscription.maxTrips - currentSubscription.tripsThisMonth;

		if (tripsRemaining <= 3 && tripsRemaining > 0) {
			showTripLimitWarning(tripsRemaining);
		} else if (tripsRemaining <= 0) {
			// Don't auto-show modal, will show when they try to log
			console.log('⚠️ Trip limit reached');
		}
	}
}

// Show warning banner when approaching trip limit
function showTripLimitWarning(remaining) {
	const existingBanner = document.getElementById('trip-limit-warning');
	if (existingBanner) existingBanner.remove();

	const banner = document.createElement('div');
	banner.id = 'trip-limit-warning';
	banner.style.cssText = `
    background-color: #fff3cd;
    color: #856404;
    border: 1px solid #ffc107;
    border-radius: 6px;
    padding: 15px 20px;
    text-align: center;
    font-size: 16px;
    max-width: 600px;
    margin: 80px auto 20px auto;
    position: relative;
    z-index: 500;
  `;

	banner.innerHTML = `
    ⚠️ You have ${remaining} trip${remaining !== 1 ? 's' : ''} remaining this month. 
    <a href="#" onclick="showUpgradeModal(); return false;" style="color: #0d6efd; font-weight: bold; text-decoration: underline;">Upgrade to Pro</a> 
    for unlimited trips!
  `;

	const container = document.querySelector('.container');
	if (container) {
		container.parentNode.insertBefore(banner, container);
	}
}

// Show error when trip limit reached
function showTripLimitReached() {
	showAlertModal(
		`<div style="text-align: center;">
      <div style="font-size: 48px; margin-bottom: 20px;">🚫</div>
      <h3 style="color: #dc3545; margin-bottom: 20px;">Trip Limit Reached</h3>
      <p style="margin-bottom: 20px;">You've used all 10 free trips this month. Your limit resets on ${new Date(currentSubscription.resetDate).toLocaleDateString()}.</p>
      <p style="font-weight: 600; margin-bottom: 20px;">Upgrade to Pro for unlimited trips!</p>
      <ul style="text-align: left; margin: 20px auto; max-width: 300px; list-style: none; padding: 0;">
        <li style="margin: 10px 0; padding-left: 25px; position: relative;">
          <span style="position: absolute; left: 0; color: #4caf50;">✓</span> Unlimited trips
        </li>
        <li style="margin: 10px 0; padding-left: 25px; position: relative;">
          <span style="position: absolute; left: 0; color: #4caf50;">✓</span> Route optimization
        </li>
        <li style="margin: 10px 0; padding-left: 25px; position: relative;">
          <span style="position: absolute; left: 0; color: #4caf50;">✓</span> Cloud sync
        </li>
        <li style="margin: 10px 0; padding-left: 25px; position: relative;">
          <span style="position: absolute; left: 0; color: #4caf50;">✓</span> Advanced analytics
        </li>
        <li style="margin: 10px 0; padding-left: 25px; position: relative;">
          <span style="position: absolute; left: 0; color: #4caf50;">✓</span> CSV/PDF export
        </li>
      </ul>
      <div style="font-size: 32px; font-weight: bold; margin: 30px 0; color: #4caf50;">$9.99<span style="font-size: 16px; font-weight: normal; color: #666;">/month</span></div>
    </div>`,
		() => {
			showUpgradeModal();
		}
	);
}

// Show upgrade modal with full pricing comparison
function showUpgradeModal() {
	const modal = document.createElement('div');
	modal.id = 'upgrade-modal';
	modal.style.cssText = `
    display: flex;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    justify-content: center;
    align-items: center;
    z-index: 3000;
    padding: 20px;
    box-sizing: border-box;
  `;

	modal.innerHTML = `
    <div style="
      background: white;
      padding: 40px 30px;
      border-radius: 16px;
      max-width: 900px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    ">
      <div style="text-align: right; margin-bottom: 20px;">
        <button onclick="closeUpgradeModal()" style="
          background: none;
          border: none;
          font-size: 28px;
          cursor: pointer;
          color: #666;
          padding: 0;
          line-height: 1;
        ">×</button>
      </div>
      
      <h2 style="text-align: center; margin-bottom: 10px; color: #333;">Upgrade Your Plan</h2>
      <p style="text-align: center; color: #666; margin-bottom: 40px;">Choose the plan that's right for you</p>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px;">
        
        <!-- Free Plan (Current) -->
        <div style="
          border: 2px solid #e0e0e0;
          border-radius: 12px;
          padding: 30px 20px;
          text-align: center;
        ">
          <h3 style="margin: 0 0 10px 0; color: #666;">Free</h3>
          <div style="font-size: 36px; font-weight: bold; margin: 20px 0; color: #333;">$0</div>
          <div style="color: #999; margin-bottom: 20px;">per month</div>
          <ul style="list-style: none; padding: 0; margin: 20px 0; text-align: left;">
            <li style="margin: 10px 0; padding-left: 25px; position: relative;">
              <span style="position: absolute; left: 0;">✓</span> 10 trips per month
            </li>
            <li style="margin: 10px 0; padding-left: 25px; position: relative;">
              <span style="position: absolute; left: 0;">✓</span> Basic route planning
            </li>
            <li style="margin: 10px 0; padding-left: 25px; position: relative;">
              <span style="position: absolute; left: 0;">✓</span> Local storage only
            </li>
          </ul>
          <button disabled style="
            width: 100%;
            padding: 12px;
            background: #e0e0e0;
            color: #999;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: not-allowed;
          ">Current Plan</button>
        </div>
        
        <!-- Pro Plan (Recommended) -->
        <div style="
          border: 3px solid #4caf50;
          border-radius: 12px;
          padding: 30px 20px;
          text-align: center;
          position: relative;
          transform: scale(1.05);
          box-shadow: 0 10px 30px rgba(76, 175, 80, 0.2);
        ">
          <div style="
            position: absolute;
            top: -12px;
            left: 50%;
            transform: translateX(-50%);
            background: #4caf50;
            color: white;
            padding: 4px 20px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
          ">RECOMMENDED</div>
          
          <h3 style="margin: 0 0 10px 0; color: #4caf50;">Pro</h3>
          <div style="font-size: 36px; font-weight: bold; margin: 20px 0; color: #333;">$9.99</div>
          <div style="color: #999; margin-bottom: 20px;">per month</div>
          <ul style="list-style: none; padding: 0; margin: 20px 0; text-align: left;">
            <li style="margin: 10px 0; padding-left: 25px; position: relative; color: #4caf50;">
              <span style="position: absolute; left: 0;">✓</span> <strong>Unlimited trips</strong>
            </li>
            <li style="margin: 10px 0; padding-left: 25px; position: relative; color: #4caf50;">
              <span style="position: absolute; left: 0;">✓</span> Route optimization
            </li>
            <li style="margin: 10px 0; padding-left: 25px; position: relative; color: #4caf50;">
              <span style="position: absolute; left: 0;">✓</span> Cloud sync & backup
            </li>
            <li style="margin: 10px 0; padding-left: 25px; position: relative; color: #4caf50;">
              <span style="position: absolute; left: 0;">✓</span> CSV/PDF export
            </li>
            <li style="margin: 10px 0; padding-left: 25px; position: relative; color: #4caf50;">
              <span style="position: absolute; left: 0;">✓</span> Advanced analytics
            </li>
            <li style="margin: 10px 0; padding-left: 25px; position: relative; color: #4caf50;">
              <span style="position: absolute; left: 0;">✓</span> Priority support
            </li>
          </ul>
          <button onclick="upgradeToPlan('pro')" style="
            width: 100%;
            padding: 12px;
            background: linear-gradient(135deg, #4caf50, #45a049);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
          " onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
            Upgrade to Pro
          </button>
        </div>
        
        <!-- Business Plan -->
        <div style="
          border: 2px solid #2196f3;
          border-radius: 12px;
          padding: 30px 20px;
          text-align: center;
        ">
          <h3 style="margin: 0 0 10px 0; color: #2196f3;">Business</h3>
          <div style="font-size: 36px; font-weight: bold; margin: 20px 0; color: #333;">$29.99</div>
          <div style="color: #999; margin-bottom: 20px;">per month</div>
          <ul style="list-style: none; padding: 0; margin: 20px 0; text-align: left;">
            <li style="margin: 10px 0; padding-left: 25px; position: relative;">
              <span style="position: absolute; left: 0;">✓</span> Everything in Pro
            </li>
            <li style="margin: 10px 0; padding-left: 25px; position: relative;">
              <span style="position: absolute; left: 0;">✓</span> <strong>5 team members</strong>
            </li>
            <li style="margin: 10px 0; padding-left: 25px; position: relative;">
              <span style="position: absolute; left: 0;">✓</span> Team management
            </li>
            <li style="margin: 10px 0; padding-left: 25px; position: relative;">
              <span style="position: absolute; left: 0;">✓</span> API access
            </li>
            <li style="margin: 10px 0; padding-left: 25px; position: relative;">
              <span style="position: absolute; left: 0;">✓</span> Custom branding
            </li>
            <li style="margin: 10px 0; padding-left: 25px; position: relative;">
              <span style="position: absolute; left: 0;">✓</span> Dedicated support
            </li>
          </ul>
          <button onclick="upgradeToPlan('business')" style="
            width: 100%;
            padding: 12px;
            background: #2196f3;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
          " onmouseover="this.style.background='#1976d2'" onmouseout="this.style.background='#2196f3'">
            Upgrade to Business
          </button>
        </div>
        
      </div>
      
      <p style="text-align: center; color: #999; font-size: 14px; margin-top: 30px;">
        💳 Secure payment powered by Stripe • Cancel anytime • No hidden fees
      </p>
    </div>
  `;

	/* eslint-disable @typescript-eslint/no-unused-vars */

	document.body.appendChild(modal);
}

// Close upgrade modal
function closeUpgradeModal() {
	const modal = document.getElementById('upgrade-modal');
	if (modal) modal.remove();
}

// Handle upgrade to selected plan
async function upgradeToPlan(plan) {
	const token = localStorage.getItem('token');
	if (!token) {
		closeUpgradeModal();
		showLogin();
		return;
	}

	// Show loading state
	const button = event.target;
	const originalText = button.textContent;
	button.textContent = 'Processing...';
	button.disabled = true;

	try {
		const response = await fetch('https://logs.gorouteyourself.com/api/create-checkout-session', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: token
			},
			body: JSON.stringify({ plan })
		});

		if (!response.ok) {
			throw new Error('Failed to create checkout session');
		}

		const data = await response.json();

		// Redirect to Stripe Checkout
		window.location.href = data.url;
	} catch (err) {
		console.error('❌ Upgrade error:', err);
		button.textContent = originalText;
		button.disabled = false;
		showAlertModal('❌ Failed to start checkout. Please try again or contact support.');
	}
}

// Open customer portal for managing subscription
async function openCustomerPortal() {
	const token = localStorage.getItem('token');
	if (!token) return;

	try {
		const response = await fetch('https://logs.gorouteyourself.com/api/create-portal-session', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: token
			}
		});

		if (!response.ok) {
			throw new Error('Failed to create portal session');
		}

		const data = await response.json();
		window.location.href = data.url;
	} catch (err) {
		console.error('❌ Portal error:', err);
		showAlertModal('❌ Failed to open billing portal. Please try again or contact support.');
	}
}

// Update subscription info in hamburger menu
async function updateSubscriptionInfoInMenu() {
	if (!currentSubscription) return;

	const planNameEl = document.getElementById('plan-name');
	const planDetailsEl = document.getElementById('plan-details');

	if (planNameEl) {
		const planDisplay =
			currentSubscription.plan.charAt(0).toUpperCase() + currentSubscription.plan.slice(1);
		planNameEl.textContent = `${planDisplay} Plan`;

		// Style based on plan
		if (currentSubscription.plan === 'pro') {
			planNameEl.style.color = '#7b1fa2';
		} else if (currentSubscription.plan === 'business') {
			planNameEl.style.color = '#2196f3';
		}
	}

	if (planDetailsEl) {
		if (currentSubscription.plan === 'free') {
			planDetailsEl.innerHTML = `
        ${currentSubscription.tripsThisMonth}/${currentSubscription.maxTrips} trips used<br>
        <span style="font-size: 11px;">Resets ${new Date(currentSubscription.resetDate).toLocaleDateString()}</span>
      `;
		} else {
			planDetailsEl.innerHTML = `<span style="color: #4caf50;">✓ Unlimited trips</span>`;
		}
	}

	// Update button text/action based on plan
	const upgradeButton = document.querySelector('#subscription-info button');
	if (upgradeButton) {
		if (currentSubscription.plan === 'free') {
			upgradeButton.textContent = '⭐ Upgrade to Pro';
			upgradeButton.onclick = () => {
				closeMenu();
				showUpgradeModal();
			};
		} else {
			upgradeButton.textContent = '⚙️ Manage Subscription';
			upgradeButton.onclick = () => {
				closeMenu();
				openCustomerPortal();
			};
			upgradeButton.style.background = 'linear-gradient(135deg, #2196f3, #1976d2)';
		}
	}
}

// Check subscription before logging trip
async function canLogTrip() {
	const token = localStorage.getItem('token');
	if (!token) return true; // Local-only users can always log

	if (!currentSubscription) {
		await checkSubscriptionStatus();
	}

	if (!currentSubscription) return true; // Fallback if check fails

	if (currentSubscription.plan === 'free') {
		return currentSubscription.tripsThisMonth < currentSubscription.maxTrips;
	}

	return true; // Pro/Business have unlimited
}

// Override the original logResults function
const originalLogResults = window.logResults;
if (typeof originalLogResults === 'function') {
	window.logResults = async function () {
		const destinationInputs = document.querySelectorAll('input[id^="destination-"]');
		const filledDestinations = Array.from(destinationInputs).filter(
			(input) => input.value.trim() !== ''
		);
		if (filledDestinations.length === 0) {
			showAlertModal('⚠️ Please enter at least one destination before logging your route.');
			return;
		}

		// Check if user can log trip
		const canLog = await canLogTrip();
		if (!canLog) {
			showTripLimitReached();
			return;
		}

		// Call original function
		await originalLogResults.call(this);

		// Refresh subscription status after logging
		const token = localStorage.getItem('token');
		if (token) {
			await checkSubscriptionStatus();
		}
	};
}

// Also check after successful auth
const originalUpdateAuthUI = window.updateAuthUI;
if (typeof originalUpdateAuthUI === 'function') {
	window.updateAuthUI = async function () {
		await originalUpdateAuthUI.call(this);
		const token = localStorage.getItem('token');
		if (token) {
			await checkSubscriptionStatus();
		}
	};
}

console.log('✅ Subscription integration loaded');
