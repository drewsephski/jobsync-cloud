"use client"

import { useEffect, useRef, useState } from "react"
import {
  Check,
  FileText,
  ShieldCheck,
  ArrowRight,
} from "@/components/ui/animated-icons"
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
    <FieldGroup className="onboarding-surface mx-auto max-w-3xl gap-8 py-4 sm:py-8">
      {!resumeOnly && (
        <FieldGroup className="gap-3">
          <FieldGroup
            role="list"
            aria-label="Onboarding progress"
            className="grid grid-cols-2 gap-3"
          >
            {["Upload resume", "Review & confirm"].map((label, index) => (
              <FieldGroup
                key={label}
                role="listitem"
                aria-current={
                  Math.min(active, 1) === index ? "step" : undefined
                }
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
            ))}
          </FieldGroup>
          <Progress
            value={active === 0 ? 15 : active === 1 ? 60 : 100}
            aria-label="Onboarding progress"
          />
        </FieldGroup>
      )}
      <FieldGroup className="gap-3">
        <CardTitle
          ref={heading}
          tabIndex={-1}
          role="heading"
          aria-level={1}
          className="text-3xl leading-tight font-semibold tracking-tight outline-none sm:text-4xl"
        >
          {preferenceStep
            ? "Your resume is ready. Let’s find a role."
            : reviewing
              ? resumeOnly && state.version?.confirmed
                ? "Your resume."
                : "Does this look like you?"
              : state.upload
                ? "Your resume is taking shape."
                : "Upload your resume."}
        </CardTitle>
        <CardDescription className="max-w-2xl text-base leading-relaxed text-foreground">
          {preferenceStep
            ? "One starting role is enough. Everything else can wait."
            : reviewing
              ? resumeOnly && state.version?.confirmed
                ? "Your confirmed experience guides matching. Edits stay drafts until you confirm them."
                : "Check your name, skills, and experience. Correct anything missing, then confirm when it’s accurate."
              : "Upload your resume once. We’ll turn it into an editable draft, and you’ll have the final say on every detail."}
        </CardDescription>
      </FieldGroup>
      <StepTransition step={active}>
        <Card className="workspace-card border-0 shadow-none">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              {preferenceStep
                ? "Where would you like to start?"
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
        <ShieldCheck className="mx-auto mb-2 size-4" aria-hidden="true" /> Your
        original file and AI draft stay intact. Only a version you explicitly
        confirm is accepted as your resume.
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
