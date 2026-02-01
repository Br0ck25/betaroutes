import forms from '@tailwindcss/forms';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        brand: {
          orange: '#F68A2E',
          blue: '#2C507B',
          'accent-blue': '#1FA8DB',
          'accent-green': '#8BC12D',
          'accent-purple': '#8F3D91'
        },
        neutral: {
          white: '#FFFFFF',
          black: '#000000',
          'gray-light': '#F5F5F5',
          'gray-medium': '#E0E0E0',
          'gray-dark': '#333333'
        },
        semantic: {
          success: '#8BC12D',
          error: '#F68A2E',
          warning: '#F68A2E',
          info: '#1FA8DB'
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
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
        '4xl': '2.5rem'
      },
      spacing: {
        1: '0.25rem',
        2: '0.5rem',
        3: '0.75rem',
        4: '1rem',
        5: '1.5rem',
        6: '2rem',
        8: '3rem',
        10: '4rem'
      },
      screens: {
        tablet: '768px',
        desktop: '1024px',
        wide: '1440px'
      }
    }
  },
  plugins: [forms]
};
