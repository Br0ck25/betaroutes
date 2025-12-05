/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        primary: {
          green: "#4caf50",
          "green-dark": "#45a049",
          purple: "#667eea",
          "purple-dark": "#764ba2"
        },
        semantic: {
          success: "#4caf50",
          error: "#f44336",
          warning: "#ff9800",
          info: "#2196f3"
        },
        neutral: {
          primary: "#333333",
          secondary: "#666666",
          tertiary: "#999999",
          border: "#e0e0e0",
          "bg-primary": "#ffffff",
          "bg-secondary": "#f5f7fa",
          "bg-tertiary": "#f8f9fa"
        }
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "20px",
        full: "9999px"
      },
      boxShadow: {
        sm: "0 2px 4px rgba(0,0,0,0.05)",
        md: "0 4px 12px rgba(0,0,0,0.08)",
        lg: "0 10px 30px rgba(0,0,0,0.12)",
        xl: "0 20px 60px rgba(0,0,0,0.15)"
      },
      fontSize: {
        xs: "0.75rem",
        sm: "0.875rem",
        base: "1rem",
        lg: "1.125rem",
        xl: "1.25rem",
        "2xl": "1.5rem",
        "3xl": "2rem",
        "4xl": "2.5rem"
      },
      spacing: {
        1: "0.25rem",
        2: "0.5rem",
        3: "0.75rem",
        4: "1rem",
        5: "1.5rem",
        6: "2rem",
        8: "3rem",
        10: "4rem"
      },
      screens: {
        mobile: "0px",
        tablet: "768px",
        desktop: "1024px",
        wide: "1440px"
      }
    }
  },
  plugins: [require('@tailwindcss/forms')]
};
