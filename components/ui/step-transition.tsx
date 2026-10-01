"use client"
import { useEffect } from "react"
import { motion, useAnimate, useReducedMotion } from "motion/react"
export function StepTransition({
  step,
  children,
}: {
  step: string | number
  children: React.ReactNode
}) {
  const reduced = useReducedMotion()
  const [scope, animate] = useAnimate()
  useEffect(() => {
    if (!reduced) {
      const animation = animate(
        scope.current,
        { opacity: [0, 1], y: [6, 0] },
        { duration: 0.18 }
      )
      return () => animation.stop()
    }
  }, [animate, reduced, scope, step])
  // Keep the form mounted: changing steps must never discard unsaved drafts.
  return <motion.div ref={scope}>{children}</motion.div>
}
