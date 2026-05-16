import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],

  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9ebff",
          200: "#b9d9ff",
          300: "#8cc2ff",
          400: "#5da6ff",
          500: "#3382F6",
          600: "#2563EB",
          700: "#1d4ed8",
          800: "#1e3a8a",
          900: "#0F172A",
        },
      },
    },
  },

  plugins: [],
};

export default config;