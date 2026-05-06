import type { Config } from 'tailwindcss';
import tailwindForms from '@tailwindcss/forms';

// Traffic group color palette (kept in sync with src/server/utils/colorGenerator.ts).
// These classes are looked up at runtime from DB values, so Tailwind's JIT
// can't see them in source — they must be safelisted.
const trafficGroupColors = [
  'bg-blue-500', 'bg-blue-400',
  'bg-green-600', 'bg-green-400',
  'bg-purple-600', 'bg-purple-400',
  'bg-orange-600', 'bg-orange-400',
  'bg-pink-600', 'bg-pink-400',
  'bg-teal-600', 'bg-teal-400',
  'bg-indigo-600', 'bg-indigo-400',
  'bg-cyan-600', 'bg-cyan-400',
  'bg-lime-600', 'bg-lime-400',
  'bg-amber-600', 'bg-amber-400',
  'bg-rose-600', 'bg-rose-400',
  'bg-emerald-600', 'bg-emerald-400',
];

export default {
  darkMode: 'selector',
  content: [],
  safelist: trafficGroupColors,
  theme: {
    screens: {
      xxs: '450px',
      xs: '576px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
  },
  plugins: [tailwindForms],
} satisfies Config;
