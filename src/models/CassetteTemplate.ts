/** Mirrors CassetteTemplate.java — physical layout of the drug test cassette's result window, in
 *  normalized (0-1) coordinates relative to the on-screen alignment guide. */

/** width / height of the alignment guide rectangle — the cassette's inspection window is
 *  noticeably taller than wide (~2:3), not square. */
export const GUIDE_ASPECT_RATIO = 0.68;

export const LEFT_STRIP_SUBSTANCES = ['MET', 'THC', 'OXY'] as const;
export const RIGHT_STRIP_SUBSTANCES = ['AMP', 'OPI', 'COC'] as const;

export const LEFT_STRIP_LEFT = 0.3;
export const LEFT_STRIP_RIGHT = 0.47;
export const RIGHT_STRIP_LEFT = 0.53;
export const RIGHT_STRIP_RIGHT = 0.7;

/** Vertical center of each of the 4 stacked rows (control, then the 3 substances above), as a
 *  fraction of guide height, top to bottom. Index 0 is the Control line's row. */
export const ROW_CENTERS_Y = [0.14, 0.38, 0.62, 0.86];

export const LINE_BAND_HEIGHT = 0.14;
