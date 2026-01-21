// src/lib/utils/api.ts

import type { AuthResponse, Subscription, Trip } from '$lib/types';

const API_BASE = 'https://logs.gorouteyourself.com';

class ApiClient {
	// [SECURITY FIX #52] Removed localStorage token usage
	// Sessions are in httpOnly cookies and automatically included in requests
	private getAuthHeader(token?: string): HeadersInit {
		// Token parameter only used for explicit API key auth (not session tokens)
		return token ? { Authorization: token } : {};
	}

	private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
		const url = `${API_BASE}${endpoint}`;

		try {
			const response = await fetch(url, {
				...options,
				headers: {
					'Content-Type': 'application/json',
					...options.headers
				}
			});

			if (!response.ok) {
				const errorBody = await response.json().catch(() => null);
				const errorMsg =
					errorBody &&
					typeof errorBody === 'object' &&
					'error' in (errorBody as Record<string, unknown>)
						? String((errorBody as Record<string, unknown>)['error'])
						: response.statusText;
				throw new Error(errorMsg || 'API request failed');
			}

			return response.json();
		} catch (error) {
			console.error('API Error:', error);
			throw error;
		}
	}

	// Auth endpoints
	async signup(username: string, password: string): Promise<AuthResponse> {
		return this.request<AuthResponse>('/api/signup', {
			method: 'POST',
			body: JSON.stringify({ username, password })
		});
	}

	async login(username: string, password: string): Promise<AuthResponse> {
		return this.request<AuthResponse>('/api/login', {
			method: 'POST',
			body: JSON.stringify({ username, password })
		});
	}

	async changePassword(
		username: string,
		currentPassword: string,
		newPassword: string
	): Promise<{ message: string }> {
		return this.request('/api/change-password', {
			method: 'POST',
			headers: this.getAuthHeader(),
			body: JSON.stringify({ username, currentPassword, newPassword })
		});
	}

	async resetPassword(
		username: string,
		resetKey: string,
		newPassword: string
	): Promise<{ message: string }> {
		return this.request('/api/reset-password', {
			method: 'POST',
			body: JSON.stringify({ username, resetKey, newPassword })
		});
	}

	async deleteAccount(username: string, password: string): Promise<{ message: string }> {
		return this.request('/api/delete-account', {
			method: 'POST',
			headers: this.getAuthHeader(),
			body: JSON.stringify({ username, password })
		});
	}

	// Subscription endpoints
	async getSubscription(token?: string): Promise<Subscription> {
		return this.request<Subscription>('/api/subscription', {
			method: 'GET',
			headers: this.getAuthHeader(token)
		});
	}

	async upgradePlan(
		plan: 'pro' | 'business'
	): Promise<{ success: boolean; plan: string; message: string }> {
		return this.request('/api/subscription/upgrade', {
			method: 'POST',
			headers: this.getAuthHeader(),
			body: JSON.stringify({ plan })
		});
	}

	// Trip endpoints
	async getTrips(token?: string): Promise<Trip[]> {
		return this.request<Trip[]>('/logs', {
			method: 'GET',
			headers: this.getAuthHeader(token)
		});
	}

	async saveTrips(trips: Trip[]): Promise<{ message: string }> {
		return this.request('/logs', {
			method: 'POST',
			headers: this.getAuthHeader(),
			body: JSON.stringify(trips)
		});
	}
}

export const api = new ApiClient();
