import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// text-body (the theme's 13 px token, see app/globals.css) is a font size.
// Without this, tailwind-merge reads it as a text colour and drops it next to
// text-muted-foreground and similar classes.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["body"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
