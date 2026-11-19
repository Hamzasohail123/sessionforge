import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "./toast"
import { useToast } from "./use-toast"
import { toastCovers } from "../../lib/overlay"
import { useViewOverlay } from "../../hooks/useViewOverlay"

export function Toaster() {
  const { toasts } = useToast()
  const toastRef = useRef<HTMLLIElement>(null)
  const [covers, setCovers] = useState(false)
  // Dismissed toasts linger in state with open: false, so key on `open`, not on length
  const anyOpen = toasts.some((t) => t.open)

  // Hide page views only while an open toast reaches down over a pane slot (views draw above the DOM)
  useLayoutEffect(() => {
    const measure = () => {
      if (!anyOpen || !toastRef.current) return setCovers(false)
      const slots = Array.from(document.querySelectorAll('[data-testid^="pane-slot-"]')).map((el) =>
        el.getBoundingClientRect()
      )
      setCovers(toastCovers(toastRef.current.getBoundingClientRect(), slots))
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [toasts, anyOpen])

  useViewOverlay(anyOpen && covers)

  useEffect(() => {
    if (!anyOpen) setCovers(false)
  }, [anyOpen])

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} ref={props.open ? toastRef : undefined} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
