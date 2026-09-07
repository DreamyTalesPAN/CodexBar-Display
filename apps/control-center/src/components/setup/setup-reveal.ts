/**
 * How anything in the wizard arrives on screen: a short fade with a small
 * settle from above, the same one the log lines use.
 *
 * One definition rather than a per-screen guess, and no animation library —
 * `tw-animate-css` is already part of the stylesheet, and the global
 * reduced-motion rule flattens these utilities along with everything else.
 */
export const SETUP_REVEAL =
  "animate-in fade-in slide-in-from-top-1 duration-300 ease-out";
