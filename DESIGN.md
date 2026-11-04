# Interface Design Guidelines

## Visual direction

Geo Relief Network uses a calm, operational interface for people coordinating emergency supplies. Favor clear hierarchy, readable status, compact but generous spacing, and familiar map and messaging patterns. Keep the visual language consistent across the public map, assistant, and collection-point manager.

## Color and surfaces

- Use `#0064E0` as the single primary brand blue for key actions, selected navigation, links, and visible focus indicators.
- Use slate neutrals for page backgrounds, cards, borders, and secondary text (`bg-slate-50`, white surfaces, `border-slate-200`, `text-slate-600`).
- Reserve semantic colors for operational status: emerald for confirmed availability, amber for expected inbound supply or attention, and rose for unmet demand or errors.
- Do not use a Meta logo. The attribution is plain text: “Powered by Meta Muse Spark”.

## Components and behavior

- `AppNav` is the single shared navigation and account shell, mounted from the server root layout. It owns the public map, assistant, and manager links and must remain usable on narrow screens.
- Preserve English and Spanish labels through the existing i18n dictionaries. Do not infer language from a person's country or location.
- Keep page-specific headings inside each view, with shared account and language controls in the global navigation.
- Present assistant previews as a Dispatch Ticket with only the opaque action ID, collection hub, and declared items. Never display an aid seeker's precise coordinates.
- Public map changes may style its existing container and client data only. Do not alter Google Maps initialization or API-key loading as part of visual work.
- Show metrics only when their source values are already available to the client. Do not add endpoints or queries solely for display.

## Responsive and accessible UI

- Design for both a 390px phone viewport and a 1440px desktop viewport; avoid horizontal page overflow and preserve touch-sized actions.
- Keep focus indicators visible, maintain existing labels and roles, and retain semantic status messaging.
- The map container must keep an explicit height: `min-h-[420px] lg:h-[calc(100vh-8rem)]`.
- Use rounded cards and restrained shadows to group related tasks; use color alongside text so status is never conveyed by color alone.
