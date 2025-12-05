// src/routes/login/+page.server.ts

import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  // If already logged in, redirect to dashboard
  if (locals.user) {
    throw redirect(303, '/dashboard');
  }
  
  return {};
};

export const actions: Actions = {
  login: async ({ request, cookies, fetch }) => {
    const data = await request.formData();
    const username = data.get('username')?.toString();
    const password = data.get('password')?.toString();
    
    if (!username || !password) {
      return fail(400, { error: 'Username and password are required' });
    }
    
    try {
      // Call your API
      const response = await fetch('https://logs.gorouteyourself.com/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      if (!response.ok) {
        let errorMessage = 'Invalid username or password';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (e) {
          // If JSON parsing fails, use default message
        }
        return fail(response.status, { error: errorMessage });
      }
      
      const result = await response.json();
      const token = result.token;
      
      if (!token) {
        return fail(500, { error: 'No token received from server' });
      }
      
      // Set cookie
      cookies.set('token', token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30 // 30 days
      });
      
      // Redirect to dashboard
      throw redirect(303, '/dashboard');
      
    } catch (error: any) {
      console.error('Login error:', error);
      
      // If it's a redirect, re-throw it
      if (error?.status === 303) {
        throw error;
      }
      
      // Otherwise return error
      return fail(500, { 
        error: error.message || 'Login failed. Please check your connection and try again.' 
      });
    }
  },
  
  signup: async ({ request, cookies, fetch }) => {
    const data = await request.formData();
    const username = data.get('username')?.toString();
    const password = data.get('password')?.toString();
    const confirmPassword = data.get('confirmPassword')?.toString();
    
    if (!username || !password || !confirmPassword) {
      return fail(400, { error: 'All fields are required' });
    }
    
    if (password !== confirmPassword) {
      return fail(400, { error: 'Passwords do not match' });
    }
    
    if (password.length < 8) {
      return fail(400, { error: 'Password must be at least 8 characters' });
    }
    
    try {
      // Call your API
      const response = await fetch('https://logs.gorouteyourself.com/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      if (!response.ok) {
        let errorMessage = 'Signup failed';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (e) {
          // If JSON parsing fails, use status text
          errorMessage = response.statusText || errorMessage;
        }
        return fail(response.status, { error: errorMessage });
      }
      
      const result = await response.json();
      const token = result.token;
      
      if (!token) {
        return fail(500, { error: 'No token received from server' });
      }
      
      // Set cookie
      cookies.set('token', token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30 // 30 days
      });
      
      // Redirect to dashboard
      throw redirect(303, '/dashboard');
      
    } catch (error: any) {
      console.error('Signup error:', error);
      
      // If it's a redirect, re-throw it
      if (error?.status === 303) {
        throw error;
      }
      
      // Otherwise return error
      return fail(500, { 
        error: error.message || 'Signup failed. Please check your connection and try again.' 
      });
    }
  }
};
