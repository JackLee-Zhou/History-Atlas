"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva("btn", {
  variants: {
    variant: {
      primary: "btn-primary",
      outline: "",
      ghost: "btn-ghost",
      danger:
        "border-cinnabar/40 bg-cinnabar/10 text-cinnabar hover:border-cinnabar/60 hover:bg-cinnabar/15",
    },
    size: {
      sm: "min-h-9! px-3! py-1! text-xs",
      md: "",
      lg: "min-h-12! px-5! text-base!",
      icon: "icon-btn min-h-0! p-0!",
    },
  },
  defaultVariants: {
    variant: "outline",
    size: "md",
  },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);

Button.displayName = "Button";
