"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

const POSITION = {
  center:
    "top-1/2 left-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl data-open:zoom-in-95 data-closed:zoom-out-95 data-open:fade-in-0 data-closed:fade-out-0",
  // a sheet rising from the bottom edge: the way to hold a form on a phone, with the thumb near it
  sheet:
    "bottom-0 left-0 w-full max-w-none rounded-t-2xl max-h-[85svh] data-open:slide-in-from-bottom data-closed:slide-out-to-bottom",
}

function DialogContent({
  className,
  children,
  variant = "center",
  ...props
}: DialogPrimitive.Popup.Props & { variant?: keyof typeof POSITION }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="dialog-backdrop"
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed z-50 flex max-h-[calc(100svh-2rem)] flex-col gap-4 overflow-y-auto bg-popover p-6 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 outline-none duration-150 data-open:animate-in data-closed:animate-out",
          POSITION[variant],
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

const DialogClose = DialogPrimitive.Close

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle }
