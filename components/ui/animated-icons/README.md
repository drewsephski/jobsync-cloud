# Animated icons

Source components are vendored from https://lucide-animated.com/r/{name}.json
under the accompanying MIT license. Their animation variants are preserved.
The local adaptations use inline spans and SVG sizing to fit the existing UI.

Import icons from this directory's index. `withParentAnimation` connects the
upstream imperative handles to containing buttons, links, cards, items, and
ARIA controls. It cleans up listeners and supports focus, disabled controls,
and reduced motion. Add `data-icon-trigger` for an additional custom parent.

The registry does not provide every static Lucide glyph. Compatibility exports
use these available alternatives: FileUp → Upload, Trash2 → Delete,
Pencil → SquarePen, Building2 → MapPinHouse, LogOut → ArrowRight,
Briefcase → BriefcaseBusiness, PanelLeft → PanelLeftOpen,
MoreHorizontal → GripHorizontal, Circle/Dot → CircleDashed,
Info → CircleHelp, and warning/error icons → BadgeAlert.
