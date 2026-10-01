"use client"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import type {
  ApplicationDetails,
  ApplicationStatus,
} from "@/lib/domain/applications/schema"
import { statuses, statusLabels } from "@/lib/domain/applications/schema"
export function StatusSelect({
  value,
  onChange,
  id = "application-status",
  label = "Status",
}: {
  value: ApplicationStatus
  onChange: (value: ApplicationStatus) => void
  id?: string
  label?: string
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={value}
        onValueChange={(v) => {
          if (v) onChange(v)
        }}
        items={statuses.map((value) => ({ value, label: statusLabels[value] }))}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="onboarding-surface">
          {statuses.map((s) => (
            <SelectItem key={s} value={s}>
              {statusLabels[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
export function ApplicationFields({
  details,
  onChange,
  resumes,
  today,
}: {
  details: ApplicationDetails
  onChange: (value: ApplicationDetails) => void
  resumes: { id: string; label: string }[]
  today: string
}) {
  const text = (
    key: keyof ApplicationDetails,
    label: string,
    maxLength: number,
    required = false,
    type = "text"
  ) => (
    <Field key={key}>
      <FieldLabel htmlFor={`application-${key}`}>{label}</FieldLabel>
      <Input
        id={`application-${key}`}
        type={type}
        max={key === "appliedOn" ? today : undefined}
        required={required}
        maxLength={maxLength}
        value={details[key] ?? ""}
        onChange={(e) =>
          onChange({
            ...details,
            [key]:
              e.target.value ||
              (key === "company" || key === "title" || key === "location"
                ? ""
                : null),
          })
        }
      />
    </Field>
  )
  return (
    <FieldGroup className="gap-4">
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        {text("company", "Company", 200, true)}
        {text("title", "Job title", 200, true)}
      </FieldGroup>
      {text("location", "Location", 300)}
      {text("postingUrl", "Posting URL · optional", 2000, false, "url")}
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        {text("appliedOn", "Application date", 10, false, "date")}
        {text("salary", "Salary · optional", 200)}
      </FieldGroup>
      <Field>
        <FieldLabel htmlFor="application-resume">
          Resume used · optional
        </FieldLabel>
        <Select
          value={details.resumeVersionId ?? "none"}
          onValueChange={(v) =>
            onChange({ ...details, resumeVersionId: v === "none" ? null : v })
          }
          items={[
            { value: "none", label: "No resume recorded" },
            ...resumes.map((r) => ({ value: r.id, label: r.label })),
          ]}
        >
          <SelectTrigger id="application-resume">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="onboarding-surface">
            <SelectItem value="none">No resume recorded</SelectItem>
            {resumes.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        {text("nextAction", "Next action · optional", 300)}
        {text("followUpOn", "Follow-up date · optional", 10, false, "date")}
      </FieldGroup>
      <Field>
        <FieldLabel htmlFor="application-notes">Notes · optional</FieldLabel>
        <Textarea
          id="application-notes"
          maxLength={10000}
          rows={3}
          value={details.notes ?? ""}
          onChange={(e) =>
            onChange({ ...details, notes: e.target.value || null })
          }
        />
      </Field>
    </FieldGroup>
  )
}
