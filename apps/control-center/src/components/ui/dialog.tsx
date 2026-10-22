"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DialogSlot, type DialogRank } from "@/components/dialog-stack"

/**
 * True when the focused element, the one that opens the dialog, shows keyboard
 * focus. A mouse click, or the app opening the dialog by itself, does not.
 */
function openedWithKeyboard(opener: Element | null): boolean {
  if (!(opener instanceof HTMLElement) || opener === document.body) return false
  try {
    return opener.matches(":focus-visible")
  } catch {
    return false
  }
}

const TEXT_ENTRY = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea"

/**
 * A dialog that opens shows no focus ring until the user uses the keyboard.
 * Radix would focus the first control, and its ring then shows after a mouse
 * click too. So focus goes to the dialog itself (no outline), and one Tab
 * lands on the first control with its ring. Screen readers still announce the
 * dialog by its title. Kept: keyboard opens, where the first control (or the
 * dialog's own choice) takes focus, and a text field, which takes typing at
 * once.
 */
export function focusDialogOnOpen(event: Event, opener: Element | null) {
  if (event.defaultPrevented || openedWithKeyboard(opener)) return
  const content = event.currentTarget
  if (!(content instanceof HTMLElement)) return
  const first = content.querySelector<HTMLElement>(
    'button:not(:disabled), [href], input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [role="radio"], [role="option"], [tabindex]:not([tabindex="-1"])'
  )
  if (first?.matches(TEXT_ENTRY)) return
  event.preventDefault()
  content.focus({ preventScroll: true })
}

export { openedWithKeyboard }

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  rank = "question",
  className,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** Which dialogs this one waits for (see dialog-stack). */
  rank?: DialogRank
}) {
  // Radix hands focus back only to a Dialog.Trigger, and the dialogs here open
  // from state. Without this, closing one drops focus to the top of the window.
  // Only then: focus that is already in the next dialog or in a field the
  // customer clicked meanwhile stays where it is.
  const opener = React.useRef<Element | null>(null)
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-[14px] bg-popover p-8 text-[13px] text-popover-foreground shadow-[0_8px_24px_-4px_rgba(0,0,0,0.14)] ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-[440px] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        onOpenAutoFocus={(event) => {
          opener.current = document.activeElement
          onOpenAutoFocus?.(event)
          focusDialogOnOpen(event, opener.current)
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          if (
            !event.defaultPrevented &&
            document.activeElement === document.body &&
            opener.current instanceof HTMLElement &&
            opener.current.isConnected
          ) {
            event.preventDefault()
            opener.current.focus()
          }
        }}
        {...props}
      >
        <DialogSlot rank={rank} />
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-3", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end *:text-[13px]",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="ghost">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-[28px] leading-[1.15] font-semibold tracking-[-0.01em] text-balance",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-[13px] text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
