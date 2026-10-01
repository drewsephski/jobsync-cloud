import { PolicyDocument } from "@/components/ui/policy-document"
export const metadata = { title: "Privacy" }
export default function Privacy() {
  return (
    <PolicyDocument
      title="Privacy & data use"
      intro="What JobSync Cloud handles, why it handles it, and how you can control your workspace."
      sections={[
        {
          title: "Your workspace information",
          paragraphs: [
            "JobSync stores account identifiers from Neon Managed Auth, your profile and time zone, target preferences, watched companies, match records, saved or dismissed job actions, application details and history, resume versions, and usage records. Private records belong to your signed-in account.",
            "Original resume files are stored in a private Neon Object Storage bucket. The service validates the file and extracts text to prepare an editable draft. Structured resume facts and short source evidence are kept with the draft. Current AI processing uses the full extracted text transiently; it does not intentionally retain it as a separate record.",
            "Supported public Greenhouse, Lever, and Ashby job postings are shared product data. Your choices, preferences, and applications are private workspace data.",
          ],
        },
        {
          title: "AI processing",
          paragraphs: [
            "Resume structuring sends extracted resume text through the Vercel AI SDK and official OpenRouter provider. Matching sends confirmed resume facts, target preferences, and public job details. Unconfirmed drafts do not inform job matching.",
            "The configured model is openai/gpt-6-luna, restricted to OpenRouter’s Azure route with no fallback. Requests require zero-data-retention routing and disallow data collection. These are request and routing controls, not a guarantee that every service provider retains no operational information.",
            "AI output can be incomplete or incorrect. You review, edit, and explicitly confirm your resume. JobSync does not send applications or contact employers for you.",
          ],
        },
        {
          title: "Providers and operational data",
          paragraphs: [
            "Vercel hosts the web application. Neon provides Postgres, managed Better Auth, private object storage, scheduled triggers, and worker functions. OpenRouter and the selected model provider process AI requests. Stripe handles checkout, billing management, and subscription information when enabled. Live charging is currently disabled in Stripe test mode.",
            "Application error events use route templates and fixed status or error codes. They exclude request bodies, resume content, prompts, AI responses, signed URLs, credentials, and email addresses. Worker events can include internal run or invocation identifiers. Provider infrastructure logs and retention are governed by the configured provider accounts.",
            "Email verification and recovery delivery depend on Neon Managed Auth’s email configuration. Production SMTP and Google OAuth activation are separate launch checks. No reliable delivery or Google sign-in claim is made until those flows are verified.",
          ],
        },
        {
          title: "Retention and account control",
          paragraphs: [
            "Private workspace records and resume files remain until you remove them or delete the account. Settings provides a JSON export of your private workspace and separate original-file downloads. Store exported files securely.",
            "Account deletion locks the workspace, cancels outstanding work, cancels subscriptions and deletes the Stripe customer, removes private database records and stored resume files, and removes the managed sign-in identity and sessions. Cleanup waits for active worker leases and existing upload links to expire, then retries external failures through a durable scheduled queue.",
            "A minimal account identifier and cleanup completion record are retained to prevent stale sessions or canceled work from recreating the account. Anonymous cost envelopes without account identifiers or resume content remain for global AI spend safeguards; unresolved costs retain their conservative reservation. Shared public job postings and global billing webhook deduplication records are preserved.",
            "Deletion removes active application data. Provider backups, billing records, operational logs, and provider systems can retain information under their own policies and legal requirements. Backup expiration and provider retention settings require operational verification; JobSync does not promise immediate removal from every backup or external system.",
          ],
        },
        {
          title: "Questions",
          paragraphs: [
            "JobSync Cloud is maintained through the drewsephski/jobsync-cloud project. Use Contact the maintainer below for product or privacy questions. GitHub issues are public: include only a general description, never passwords, resume content, billing details, or private account information.",
          ],
        },
      ]}
    />
  )
}
