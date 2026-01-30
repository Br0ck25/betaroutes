/* eslint-disable @typescript-eslint/no-require-imports */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        // DESIGN_SYSTEM.md approved colors ONLY
        // No deviations allowed - see DESIGN_SYSTEM.md for rationale
        brand: {
          orange: '#F68A2E', // primary orange (CTAs, brand elements)
          blue: '#2C507B', // primary blue (headers, key UI)
          'accent-blue': '#1FA8DB', // accent blue (links, interactive)
          'accent-green': '#8BC12D', // accent green (success, positive)
          'accent-purple': '#8F3D91' // accent purple (highlights, secondary)
        },
        neutral: {
          white: '#FFFFFF', // backgrounds, light surfaces
          black: '#000000', // primary text (use sparingly, prefer gray-dark)
          'gray-light': '#F5F5F5', // subtle backgrounds
          'gray-medium': '#E0E0E0', // borders, dividers
          'gray-dark': '#333333' // body text, secondary content
        },
        // Semantic colors mapped to approved palette
        // These provide meaning while respecting the design system
        semantic: {
          success: '#8BC12D', // Maps to brand.accent-green
          error: '#F68A2E', // Maps to brand.orange (can adjust if needed)
          warning: '#F68A2E', // Maps to brand.orange
          info: '#1FA8DB' // Maps to brand.accent-blue
        }
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '20px',
        full: '9999px'
      },
      boxShadow: {
        sm: '0 2px 4px rgba(0,0,0,0.05)',
        md: '0 4px 12px rgba(0,0,0,0.08)',
        lg: '0 10px 30px rgba(0,0,0,0.12)',
        xl: '0 20px 60px rgba(0,0,0,0.15)'
      },
      fontSize: {
        xs: '0.75rem', // 12px
        sm: '0.875rem', // 14px
        base: '1rem', // 16px
        lg: '1.125rem', // 18px
        xl: '1.25rem', // 20px
        '2xl': '1.5rem', // 24px
        '3xl': '2rem', // 32px
        '4xl': '2.5rem' // 40px
      },
      spacing: {
        1: '0.25rem', // 4px
        2: '0.5rem', // 8px
        3: '0.75rem', // 12px
        4: '1rem', // 16px
        5: '1.5rem', // 24px
        6: '2rem', // 32px
        8: '3rem', // 48px
        10: '4rem' // 64px
      },
      screens: {
        tablet: '768px',
        desktop: '1024px',
        wide: '1440px'
      }
    }
  },
  plugins: [require('@tailwindcss/forms')]
};
