"use client"

import { useEffect, useRef, useState } from "react"
import { Check, FileText, ShieldCheck, ArrowRight } from "lucide-react"
import type { OnboardingState } from "@/lib/domain/onboarding/service"
import { ResumeUpload } from "./resume-upload"
import { ResumeEditor } from "./resume-editor"
import { TargetPreferences } from "./target-preferences"
import { StepTransition } from "@/components/ui/step-transition"
import { FieldGroup } from "@/components/ui/field"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export function OnboardingFlow({
  initialState,
  resumeOnly = false,
}: {
  initialState: OnboardingState
  resumeOnly?: boolean
}) {
  const [state, setState] = useState(initialState)
  const [reviewAgain, setReviewAgain] = useState(false)
  const heading = useRef<HTMLDivElement>(null)
  const preferenceStep =
    state.step === "preferences" && !reviewAgain && !resumeOnly
  const reviewing = !!state.version && !preferenceStep
  const active = preferenceStep ? 2 : reviewing ? 1 : 0
  useEffect(() => {
    heading.current?.focus()
  }, [active])
  return (
    <FieldGroup className="onboarding-surface gap-8 py-4 sm:py-8">
      <FieldGroup className="flex-row items-center justify-between gap-3">
        <CardTitle className="text-lg tracking-tight">
          JobSync
          <Badge variant="neutral" className="ml-2 font-mono text-[10px]">
            CLOUD
          </Badge>
        </CardTitle>
        <CardDescription className="flex items-center gap-2 text-xs">
          <ShieldCheck className="size-4" /> Private to your account
        </CardDescription>
      </FieldGroup>
      {!resumeOnly && (
        <FieldGroup className="gap-3">
          <FieldGroup
            role="list"
            aria-label="Onboarding progress"
            className="grid grid-cols-3 gap-3"
          >
            {["Upload resume", "Review & confirm", "Target roles"].map(
              (label, index) => (
                <FieldGroup
                  key={label}
                  role="listitem"
                  aria-current={active === index ? "step" : undefined}
                  className={`flex-row items-center gap-2 text-xs sm:text-sm ${index <= active ? "text-foreground" : "text-foreground/60"}`}
                >
                  <Badge
                    variant="neutral"
                    className={`step-number ${index <= active ? "step-active" : ""}`}
                  >
                    {index < active ? <Check className="size-3" /> : index + 1}
                  </Badge>
                  {label}
                </FieldGroup>
              )
            )}
          </FieldGroup>
          <Progress
            value={active === 0 ? 12 : active === 1 ? 50 : 85}
            aria-label="Onboarding progress"
          />
        </FieldGroup>
      )}
      <FieldGroup className="gap-3">
        <CardDescription className="text-xs font-semibold tracking-[0.16em] text-foreground uppercase">
          {resumeOnly
            ? "Your resume"
            : `Account setup · Step ${active + 1} of 3`}
        </CardDescription>
        <CardTitle
          ref={heading}
          tabIndex={-1}
          role="heading"
          aria-level={1}
          className="text-3xl leading-tight font-semibold tracking-tight outline-none sm:text-4xl"
        >
          {preferenceStep
            ? "What’s your next role?"
            : reviewing
              ? "Your experience, in your words."
              : state.upload
                ? "Your resume is taking shape."
                : "Start with your experience."}
        </CardTitle>
        <CardDescription className="max-w-2xl text-base leading-relaxed text-foreground">
          {preferenceStep
            ? "A few preferences will give your job search a clear starting point."
            : reviewing
              ? "Review the extracted draft, make it accurate, then explicitly confirm the version you want to use."
              : "Upload your resume once. We’ll turn it into an editable draft, and you’ll have the final say on every detail."}
        </CardDescription>
      </FieldGroup>
      <StepTransition step={active}>
        <Card className="workspace-card">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              {preferenceStep
                ? "Search preferences"
                : reviewing
                  ? "Review your resume"
                  : "Resume document"}
            </CardTitle>
            {!reviewing && !preferenceStep && (
              <CardDescription>
                Your progress is saved to your account. You can leave and pick
                up here later.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {state.step === "preferences" && !resumeOnly && (
              <FieldGroup
                hidden={!preferenceStep}
                className={preferenceStep ? "" : "hidden"}
              >
                <TargetPreferences
                  initialState={state}
                  onSaved={setState}
                  onReview={() => setReviewAgain(true)}
                />
              </FieldGroup>
            )}
            {!preferenceStep &&
              (reviewing ? (
                <ResumeEditor
                  key={state.version!.id}
                  initialState={state}
                  onConfirmed={
                    resumeOnly
                      ? undefined
                      : (next) => {
                          setState(next)
                          setReviewAgain(false)
                          window.scrollTo({ top: 0, behavior: "instant" })
                        }
                  }
                />
              ) : (
                <FieldGroup className="gap-6">
                  <FieldGroup className="upload-intro flex-row items-center gap-4">
                    <FileText className="size-10 shrink-0 text-foreground" />
                    <FieldGroup className="gap-1">
                      <CardTitle>
                        {state.upload?.fileName ??
                          "A PDF or Word resume is all you need"}
                      </CardTitle>
                      <CardDescription>
                        Text-based PDF or DOCX · up to 5 MiB · private storage
                      </CardDescription>
                    </FieldGroup>
                  </FieldGroup>
                  <ResumeUpload initialUploadId={state.upload?.id} />
                </FieldGroup>
              ))}
          </CardContent>
        </Card>
      </StepTransition>
      <CardDescription className="text-center text-xs leading-relaxed text-foreground">
        Your original file and AI draft stay intact. Only a version you
        explicitly confirm is accepted as your resume.
      </CardDescription>
      {resumeOnly && (
        <Button
          variant="neutral"
          className="self-start"
          nativeButton={false}
          render={<Link href="/dashboard" />}
        >
          Back to dashboard <ArrowRight />
        </Button>
      )}
    </FieldGroup>
  )
}
