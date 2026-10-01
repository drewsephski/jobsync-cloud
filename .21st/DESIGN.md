# JobSync Cloud design context

The application tracker keeps the existing calm onboarding and Discover language.
This slice does not change the global shell.

The scoped `onboarding-surface` defines a white workspace over the light slate
page background, teal primary actions, slate text, subtle borders, rounded cards
and restrained shadows. Reuse the installed `components/ui` primitives for all
controls and composition. Density is comfortable, with clear headings, concise
helper copy and generous spacing between sections.

The Jobs list surfaces company/title, current hiring status, stage and next action.
Focused scrollable dialogs separate detail reading, core editing and movement
recording. Mobile uses wrapping actions and single-column fields. Base UI controls
supply keyboard interaction and dialog focus management; visible labels and focus
rings remain essential. Respect reduced motion.

Counts and activity come from real private data. Avoid decorative charts, invented
statistics, CRM density and automatic-application claims. Discover save/dismiss
state remains separate from tracking. Status labels and date warnings help users
choose a next step without internal implementation language.
