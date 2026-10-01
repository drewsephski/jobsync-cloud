import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./accordion"
import { CardTitle } from "./card"
import { FieldGroup } from "./field"

export function ProductFaq({
  items,
  title = "A few things you might be wondering.",
}: {
  items: readonly (readonly [string, string])[]
  title?: string
}) {
  return (
    <FieldGroup className="mx-auto max-w-3xl gap-8">
      <CardTitle
        role="heading"
        aria-level={2}
        className="text-2xl tracking-tight sm:text-3xl"
      >
        {title}
      </CardTitle>
      <Accordion type="single" collapsible>
        {items.map(([question, answer], i) => (
          <AccordionItem value={String(i)} key={question}>
            <AccordionTrigger>{question}</AccordionTrigger>
            <AccordionContent>{answer}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </FieldGroup>
  )
}
