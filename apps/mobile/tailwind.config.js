/** @type {import('tailwindcss').Config} */
module.exports = {
  // Incluye el design system (@preztiaos/ui) para que NativeWind procese sus clases.
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "../../packages/ui/src/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      // Paleta de marca (debe coincidir con packages/ui/src/tokens/index.ts).
      colors: {
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
      },
      fontFamily: {
        sans: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
        rounded: ["var(--font-rounded)"],
        serif: ["var(--font-serif)"],
      },
    },
  },
  plugins: [],
};
