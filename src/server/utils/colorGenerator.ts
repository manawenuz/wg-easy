import type { TrafficGroupType } from '../database/repositories/trafficGroup/types';

// Pre-defined palette of 12 colors with good contrast in both light and dark modes
const COLOR_PALETTE = [
  { light: 'bg-blue-500', dark: 'bg-blue-400' },
  { light: 'bg-green-600', dark: 'bg-green-400' },
  { light: 'bg-purple-600', dark: 'bg-purple-400' },
  { light: 'bg-orange-600', dark: 'bg-orange-400' },
  { light: 'bg-pink-600', dark: 'bg-pink-400' },
  { light: 'bg-teal-600', dark: 'bg-teal-400' },
  { light: 'bg-indigo-600', dark: 'bg-indigo-400' },
  { light: 'bg-cyan-600', dark: 'bg-cyan-400' },
  { light: 'bg-lime-600', dark: 'bg-lime-400' },
  { light: 'bg-amber-600', dark: 'bg-amber-400' },
  { light: 'bg-rose-600', dark: 'bg-rose-400' },
  { light: 'bg-emerald-600', dark: 'bg-emerald-400' },
];

export function getNextColor(existingGroups: TrafficGroupType[]) {
  const usedColors = new Set(existingGroups.map((g) => g.colorLight));
  const available = COLOR_PALETTE.filter((c) => !usedColors.has(c.light));

  // Return first available color, or cycle back to first color if all used
  return available[0] || COLOR_PALETTE[0];
}
