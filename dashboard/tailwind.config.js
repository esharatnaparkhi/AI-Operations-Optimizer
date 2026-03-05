/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#f0fdf5",
          100: "#dcfce9",
          200: "#bbf7d3",
          400: "#3ECF8E",
          500: "#39B26B",
          600: "#2FAE70",
          700: "#267d52",
        },
        ink: {
          primary: "#111111",
          body:    "#6A6A6A",
          muted:   "#9A9A9A",
          icon:    "#5C5C5C",
        },
        base: {
          bg:      "#F5F5F3",
          surface: "#FBFBFA",
          card:    "#F7F7F4",
          border:  "#E6E6E3",
          border2: "#ECECE8",
          icon:    "#EFEFEA",
        },
      },
      boxShadow: {
        card:       "0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.025)",
        "card-hover":"0 14px 35px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.04)",
      },
      borderRadius: {
        "2.5xl": "20px",
      },
    },
  },
  plugins: [],
};
