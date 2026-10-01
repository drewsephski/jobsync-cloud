"use client"

import { useReducedMotion } from "motion/react"
import {
  forwardRef,
  useEffect,
  useRef,
  type ForwardRefExoticComponent,
  type HTMLAttributes,
  type RefAttributes,
} from "react"

import { cn } from "@/lib/utils"

type AnimationHandle = {
  startAnimation: () => void
  stopAnimation: () => void
}

type SourceProps = HTMLAttributes<HTMLSpanElement> & { size?: number }
type IconProps = SourceProps

// Preserve the upstream animation, but trigger it from the entire containing
// control and card, including keyboard focus. No client boundary on the parent.
export function withParentAnimation(
  Source: ForwardRefExoticComponent<
    SourceProps & RefAttributes<AnimationHandle>
  >,
  name: string
) {
  const Icon = forwardRef<HTMLSpanElement, IconProps>(function AnimatedIcon(
    { className, size, style, ...props },
    ref
  ) {
    const element = useRef<HTMLSpanElement>(null)
    const animation = useRef<AnimationHandle>(null)
    const reducedMotion = useReducedMotion()

    useEffect(() => {
      const icon = element.current
      if (!icon || reducedMotion) return

      const handle = animation.current
      const parents: Element[] = []
      for (
        let parent = icon.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        if (
          parent.matches(
            'button, a, [role="button"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="checkbox"], [role="radio"], [data-slot="card"], [data-slot="item"], [data-icon-trigger]'
          )
        ) {
          parents.push(parent)
        }
      }
      if (!parents.length) parents.push(icon)

      const hovered = new Set(
        parents.filter((parent) => parent.matches(":hover"))
      )
      let active = false
      let disposed = false
      const sync = () => {
        if (disposed) return
        const disabled = icon.closest(
          ':disabled, [aria-disabled="true"], [data-disabled]'
        )
        const focused = parents.some((parent) =>
          parent.contains(document.activeElement)
        )
        const next = !disabled && (hovered.size > 0 || focused)
        if (next === active) return
        active = next
        icon.dataset.animating = String(active)
        if (active) handle?.startAnimation()
        else handle?.stopAnimation()
      }

      const cleanup = parents.map((parent) => {
        const enter = () => {
          hovered.add(parent)
          sync()
        }
        const leave = () => {
          hovered.delete(parent)
          sync()
        }
        const blur = () => {
          // focusout fires before the browser updates activeElement.
          queueMicrotask(sync)
        }
        parent.addEventListener("mouseenter", enter)
        parent.addEventListener("mouseleave", leave)
        parent.addEventListener("focusin", sync)
        parent.addEventListener("focusout", blur)
        return () => {
          parent.removeEventListener("mouseenter", enter)
          parent.removeEventListener("mouseleave", leave)
          parent.removeEventListener("focusin", sync)
          parent.removeEventListener("focusout", blur)
        }
      })
      sync()
      return () => {
        disposed = true
        cleanup.forEach((remove) => remove())
        delete icon.dataset.animating
      }
    }, [reducedMotion])

    return (
      <span
        ref={(node) => {
          element.current = node
          if (typeof ref === "function") return ref(node)
          if (ref) ref.current = node
        }}
        data-slot="animated-icon"
        data-icon={name}
        aria-hidden="true"
        className={cn("inline-flex size-4 shrink-0 align-middle", className)}
        style={
          size === undefined ? style : { width: size, height: size, ...style }
        }
        {...props}
      >
        <Source ref={animation} size={size ?? 24} className="contents" />
      </span>
    )
  })
  Icon.displayName = `${name}AnimatedIcon`
  return Icon
}
