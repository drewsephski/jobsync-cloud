"use client"
import { Plus, Trash2 } from "@/components/ui/animated-icons"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
export function ResumeTextField({
  id,
  label,
  value,
  onChange,
  multiline = false,
  placeholder = "Not found — add if applicable",
}: {
  id: string
  label: string
  value: string | null
  onChange: (value: string) => void
  multiline?: boolean
  placeholder?: string
}) {
  const props = {
    id,
    value: value ?? "",
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => onChange(event.target.value),
    placeholder,
  }
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? <Textarea {...props} rows={4} /> : <Input {...props} />}
    </Field>
  )
}

type Entry = Record<string, string | null | string[]>
export function ResumeEntries({
  kind,
  title,
  values,
  fields,
  onChange,
}: {
  kind: string
  title: string
  values: Entry[]
  fields: Array<[string, string]>
  onChange: (entries: Entry[]) => void
}) {
  function change(index: number, key: string, value: string) {
    onChange(
      values.map((entry, i) =>
        i === index
          ? {
              ...entry,
              [key]: key === "highlights" ? value.split("\n") : value || null,
            }
          : entry
      )
    )
  }
  return (
    <FieldGroup className="gap-6">
      {!values.length && (
        <Alert>
          <AlertTitle>No {title.toLowerCase()} extracted</AlertTitle>
          <AlertDescription>
            If this belongs on your resume, add it here. Otherwise leave this
            section empty.
          </AlertDescription>
        </Alert>
      )}
      {values.map((entry, index) => (
        <Card key={index} size="sm" className="review-entry">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle role="heading" aria-level={3}>
              {title} {index + 1}
            </CardTitle>
            <Button
              variant="neutral"
              size="sm"
              aria-label={`Remove ${kind} ${index + 1}`}
              onClick={() => onChange(values.filter((_, i) => i !== index))}
            >
              <Trash2 /> Remove
            </Button>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              {fields.map(([key, label]) => (
                <FieldGroup
                  key={key}
                  className={key === "highlights" ? "sm:col-span-2" : ""}
                >
                  <ResumeTextField
                    id={`${kind}-${index}-${key}`}
                    label={label}
                    value={
                      Array.isArray(entry[key])
                        ? entry[key].join("\n")
                        : (entry[key] as string | null)
                    }
                    multiline={key === "highlights"}
                    onChange={(value) => change(index, key, value)}
                  />
                </FieldGroup>
              ))}
            </FieldGroup>
          </CardContent>
        </Card>
      ))}
      <Button
        variant="neutral"
        className="self-start"
        disabled={values.length >= (kind === "education" ? 20 : 30)}
        onClick={() =>
          onChange([
            ...values,
            Object.fromEntries(
              fields.map(([key]) => [key, key === "highlights" ? [] : null])
            ),
          ])
        }
      >
        <Plus /> Add{" "}
        {kind === "employment"
          ? "employment"
          : kind === "education"
            ? "education"
            : "credential"}
      </Button>
    </FieldGroup>
  )
}
