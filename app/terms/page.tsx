import { PolicyDocument } from "@/components/ui/policy-document"
export const metadata = { title: "Terms" }
export default function Terms() {
  return (
    <PolicyDocument
      title="Terms of service"
      intro="Terms for the current JobSync Cloud job-search workspace."
      sections={[
        {
          title: "Using JobSync Cloud",
          paragraphs: [
            "JobSync Cloud helps you review resume information, discover supported public job postings, and organize applications and follow-ups. Use the service lawfully and keep your credentials secure. Do not upload content you have no right to use, abuse the service, or try to access another person’s workspace.",
            "You are responsible for the accuracy of your information, checking AI drafts against your source documents, and confirming that a job is still open. JobSync does not submit applications or contact employers on your behalf, and it does not guarantee employment or a complete search of all job sites.",
          ],
        },
        {
          title: "Your content",
          paragraphs: [
            "You retain your rights to content you provide. You allow JobSync and its disclosed providers to process that content as needed to provide and secure the workspace, including the AI features you use. Shared public job-posting information is not private account content. See Privacy & data use for the actual providers and processing controls.",
          ],
        },
        {
          title: "Trial and subscription",
          paragraphs: [
            "A verified account receives one 14-day trial, without a card or an automatic charge. Trial allowances include two resume AI runs, five job AI analyses, up to three watched company boards, and up to two discovery scans a day. Plus is advertised at $6 USD per month with five resume AI runs, sixty job AI analyses per billing month, thirty watched boards, and up to two scans a day. Job AI analysis is also limited to three starts per UTC day.",
            "AI and discovery are bounded by service availability and spend safeguards. Unused allowances do not roll over. AI use is counted when processing starts, including an unresolved provider result. Plus subscriptions are available only when checkout is offered. If subscriptions are unavailable, you will not be charged.",
            "When enabled, Plus renews monthly until canceled. Stripe displays the final checkout amount and applicable taxes. Manage billing in Settings allows cancellation; scheduled cancellation keeps Plus through the end of the current paid period. The trial never automatically becomes a paid subscription.",
            "Cancellation prevents future renewal; it does not automatically refund previous charges. Contact private support for a billing correction or refund request. This does not limit any applicable consumer rights.",
          ],
        },
        {
          title: "Availability and account closure",
          paragraphs: [
            "Job boards can change, disappear, or become unavailable. AI results may be incomplete or inaccurate. The service is provided as available without a promise of uninterrupted availability or a particular job-search result. We may suspend abusive accounts or parts of the service when needed for security or legal compliance.",
            "Settings lets you export your workspace and request permanent account deletion. Deletion cancels work and subscriptions, removes private records and files, and closes the sign-in identity. External failures are retried. Minimal cleanup and anonymous spend records remain for security and accounting safeguards; provider systems and backups are subject to their own retention.",
            "Material changes to plans or these terms will be communicated through available account or product notices. Use Contact & support below for billing, account, privacy, or security questions. Keep private information out of public issues.",
          ],
        },
      ]}
    />
  )
}
