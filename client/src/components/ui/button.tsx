import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
  " hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border border-primary-border shadow-[0_12px_30px_-18px_rgba(34,197,94,0.75)] hover:brightness-110",
        destructive:
          "bg-destructive text-destructive-foreground border border-destructive-border hover:brightness-110",
        outline:
          "border border-white/20 bg-white/[0.03] text-foreground hover:bg-white/[0.06]",
        secondary: "border border-secondary-border bg-secondary/90 text-secondary-foreground hover:bg-secondary",
        ghost: "border border-transparent text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
      },
      size: {
        default: "min-h-10 px-5 py-2.5",
        sm: "min-h-9 rounded-md px-3.5 text-xs",
        lg: "min-h-11 rounded-lg px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
