import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "./cn";

export const buttonVariants = cva("button inline-flex items-center justify-center", {
  variants: {
    variant: {
      primary: "button-primary",
      secondary: "button-secondary",
    },
  },
  defaultVariants: {
    variant: "primary",
  },
});

type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants> & {
  asChild?: boolean;
};

export function Button({ asChild = false, className, variant, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component data-slot="button" className={cn(buttonVariants({ variant, className }))} {...props} />;
}
