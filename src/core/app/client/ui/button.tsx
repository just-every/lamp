import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { useSyncExternalStore, type ComponentProps } from "react";

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

const subscribe = () => () => {};
const interactive = () => true;
const serverInteractive = () => false;

export function Button({ asChild = false, className, variant, ...props }: ButtonProps) {
  const hydrated = useSyncExternalStore(subscribe, interactive, serverInteractive);
  const Component = asChild ? Slot : "button";
  return <Component data-slot="button" className={cn(buttonVariants({ variant, className }))} {...props} disabled={props.disabled || (!asChild && !hydrated)} />;
}
