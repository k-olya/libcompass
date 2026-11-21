/** Shared immutable annotation palette, tuned for the app's dark background. */
export const colors = Object.freeze({
  /** Original gold preview color. */
  default: '#d2a568',
  red: '#d97676',
  orange: '#d99568',
  amber: '#e1b665',
  yellow: '#d6c878',
  lime: '#a8bd77',
  green: '#7bb792',
  teal: '#6fb7ad',
  cyan: '#78b8c9',
  blue: '#7aa7d6',
  indigo: '#9099cf',
  violet: '#a58bcd',
  purple: '#b78fb9',
  pink: '#ce94b2',
  rose: '#d7979e',
  gray: '#a5b2c1',
} as const);

/** A theme palette name or a #RGB/#RRGGBB string, checked at runtime. */
export type AnnotationColor = keyof typeof colors | `#${string}`;
