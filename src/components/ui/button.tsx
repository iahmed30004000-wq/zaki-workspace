"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

/**
 * THE BUTTON SET (D1 §4). One accent per theme: the `primary` button is the ONE main action of a screen or a dialog; `tonal` stands beside it; `ghost` is for
 * toolbars and list actions; `danger` only confirms a destruction; `link` is inline text; `icon` is a round 44 px (32 px on a wide screen) ghost for app bars and the composer;
 * `fab` is the 56 px round accent button (a phone's «new message» / «new task»). The API of the component is the old one: `variant` and `size`.
 */
const button = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-[10px] text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:bg-accent/90",
        tonal: "bg-accent/[0.08] text-accent hover:bg-accent/10",
        secondary: "bg-surface text-fg hover:bg-surface-2 border border-border",
        ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg",
        danger: "bg-danger text-danger-fg hover:bg-danger/90",
        link: "h-auto rounded-none p-0 text-accent hover:underline",
        fab: "size-14 rounded-full bg-accent text-accent-fg shadow-card hover:bg-accent/90",
      },
      size: {
        sm: "h-10 md:h-8 px-3",
        md: "h-11 md:h-9 px-4",
        icon: "size-11 md:size-8 rounded-full",
      },
    },
    compoundVariants: [
      // a link and a fab have their own geometry: the size does not apply to them
      // (the `md:` size classes are cancelled too, or a wide screen would still size them)
      { variant: "link", size: ["sm", "md", "icon"], className: "h-auto w-auto px-0 md:h-auto md:w-auto" },
      { variant: "fab", size: ["sm", "md", "icon"], className: "size-14 px-0 md:size-14" },
    ],
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(button({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";

/** The variants, for the gallery and the guard test. */
export const BUTTON_VARIANTS = ["primary", "tonal", "secondary", "ghost", "danger", "link", "fab"] as const;
