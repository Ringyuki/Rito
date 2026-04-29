# Native Reader UI Plan

This document defines the product UI, interaction, motion, and implementation
plan for the Flutter native reader. It complements
[`native-reader-architecture.md`](./native-reader-architecture.md), which owns
the runtime/session/frame contract.

The reader UI goal is immersion: the EPUB content is the app. Product chrome,
menus, panels, and animation must support reading without shrinking the render
surface into a dashboard.

## Product Principles

1. **Full-viewport reading first.** The rendered `ReaderSpreadFrame` occupies
   the app viewport. App bars, bottom navigation, cards, and fixed toolbars must
   not permanently reduce the reading surface.
2. **Chrome is temporary.** Controls appear on explicit intent, then fade away.
   The default reading state shows content only.
3. **Runtime semantics stay authoritative.** Flutter displays frames, targets,
   locators, search results, and resources from the runtime. It must not rebuild
   spreads, infer links from paint commands, or persist page indexes as durable
   state.
4. **Design is quiet and repeated-use focused.** The UI should feel calm,
   precise, and book-like rather than decorative or marketing-like.
5. **Motion must clarify state.** Animations indicate chrome visibility,
   navigation, reflow, and panel ownership. Motion is subtle, interruptible, and
   reduced when the platform requests reduced motion.
6. **Visual acceptance is a gate, not polish.** Flutter frame fixtures,
   screenshots, and interaction tests are part of correctness.

## Dependency Plan

Dependencies belong in `apps/flutter_reader` first. `packages/rito_flutter`
should remain a reusable reader package with typed runtime primitives, painter,
controller, and low-level widgets. Product styling, animation choreography, and
asset-heavy UI stay in the app until they prove reusable.

Checked on 2026-04-29:

```yaml
dependencies:
  flutter:
    sdk: flutter

  flex_color_scheme: ^8.4.0
  flutter_animate: ^4.5.2
  animations: ^2.2.0
  lottie: ^3.3.3
  rive: ^0.14.5
  lucide_icons_flutter: ^3.1.12
```

Usage rules:

- `flex_color_scheme`: app theme, light/dark/sepia palettes, Material 3
  surface roles, and high-contrast variants.
- `flutter_animate`: small local animations such as chrome fade/slide,
  progress reveal, loading affordances, and tap feedback.
- `animations`: Material motion transitions for sheets, dialogs, search, and
  settings flows.
- `lottie`: non-reading states only, such as opening, import failure, empty
  library, or long-running setup. Do not animate over active reading text.
- `rive`: high-value interactive assets only, such as bookmark state or a
  polished loading mark. Do not use it for routine buttons or panels.
- `lucide_icons_flutter`: the app icon system. Toolbars, panels, menus, and
  buttons use Lucide icons. Material icons are allowed only for platform-native
  widgets where replacing them would be awkward or when Lucide lacks a required
  symbol.

## Package Boundaries

`packages/rito_flutter` owns:

- typed protocol models
- `ReaderRuntimeClient`
- `RitoReaderController`
- `ReaderSpreadPainter`
- `ReaderSpreadView`
- resource transfer readers and caches
- low-level interaction target callbacks
- reusable primitives that do not impose a product visual language

`apps/flutter_reader` owns:

- product theme and design tokens
- immersive reader shell
- chrome visibility state
- animation choreography
- panels, sheets, dialogs, and menus
- platform file opening
- persistence adapters
- app routing and product settings
- demo/development runtime hosts until real platform hosts exist

Do not move product-specific style decisions into `packages/rito_flutter`
without a separate API review.

## Design Language

### Color

Define three primary reading themes:

- **Light:** warm paper background, near-black ink, muted neutral chrome.
- **Sepia:** warmer paper and softer contrast for long evening reading.
- **Dark:** graphite/near-black background, warm off-white ink, low-glare
  surfaces.

Accent color should be restrained. Use teal/green for focus, selection,
progress, and primary controls. Avoid a one-note green UI; chrome surfaces must
remain neutral and content-first.

Reading surface colors come from the EPUB/runtime display list. App-level
backgrounds are only visible around transparent frames, during transitions, or
behind overlays.

### Typography

- EPUB content typography is owned by runtime layout and display-list commands.
- App chrome uses the system UI font.
- UI labels are compact and readable; avoid hero-scale text inside panels.
- Long labels must wrap or elide gracefully. No button text should overflow.

### Shape And Elevation

- Reader content is not placed inside decorative cards.
- Floating controls, sheets, popovers, and repeated list items may use an 8px
  radius unless platform conventions require otherwise.
- Shadows are subtle and only separate floating chrome from content.
- Do not add decorative gradient blobs, bokeh, or unrelated illustrations to the
  reading surface.

### Icons

- Use Lucide icons through `lucide_icons_flutter`.
- Icon-only controls need tooltips or accessible labels.
- Common actions should use familiar symbols:
  - open: folder/open
  - search: search
  - settings: sliders/settings
  - TOC: list/tree/list-collapse
  - bookmark: bookmark
  - close: x
  - previous/next: chevrons
  - theme: sun/moon/palette
  - footnote: message-square/text

### Motion

Default motion uses short, low-distance transitions:

| Interaction                 | Motion                                    | Duration  |
| --------------------------- | ----------------------------------------- | --------- |
| Show chrome                 | fade + 8-12px slide                       | 120-180ms |
| Hide chrome                 | fade                                      | 100-150ms |
| Next/previous spread        | slight horizontal slide + fade            | 180-260ms |
| Reflow apply                | old frame remains, new frame crossfades   | 160-220ms |
| Open panel                  | shared-axis/fade-through via `animations` | 180-260ms |
| Close panel                 | reverse transition                        | 120-200ms |
| Tap feedback                | opacity/scale on icon surface only        | 80-120ms  |
| Loading/opening non-reading | Lottie/Rive in non-content state          | bounded   |

Reduced motion disables slide, scale, and parallax. It keeps opacity changes
only.

## Screen Model

The app has one primary reader screen:

```text
FullViewportReaderScreen
  Stack
    Positioned.fill ReaderSurface
    Positioned.fill GestureLayer
    Positioned.fill OverlayLayer
    Positioned TopChrome
    Positioned BottomChrome
    Panels / Sheets / Dialogs
```

### Reader Surface

`ReaderSpreadView` is rendered into the full app viewport. It preserves the
frame/display-list aspect ratio and centers the frame when a viewport and frame
ratio differ. The app may use theme background outside the frame, but it must
not wrap the spread in a decorative card.

`ReaderLayoutRequest.viewport` should come from the actual reader viewport. Safe
areas affect tappable chrome and gesture exclusion zones, not the core content
layout, unless the user explicitly sets reading margins.

Required behavior:

- no permanent AppBar or BottomNavigationBar in reading mode
- no fixed chrome that changes the layout viewport
- frame remains visible during reflow until replacement frame is ready
- loading/reflow overlays must not replace the active frame with a blank page
- target hit testing uses `ReaderInteractionTarget` from the frame

### Chrome States

Chrome has four states:

- `hidden`: default reading state; only content is visible.
- `peek`: brief transient state after navigation or pointer movement.
- `visible`: user toggled controls on by center tap, keyboard, or menu action.
- `locked`: a panel/sheet/dialog is open; chrome stays available as context.

Chrome auto-hide rules:

- hide after 2-4 seconds of inactivity in reading mode
- never hide while a panel is open
- never hide while keyboard focus is inside search/settings
- show briefly after page navigation
- desktop hover/mouse move may enter `peek`

### Top Chrome

Top chrome is a floating translucent band, not a layout AppBar. It includes:

- close/back to library
- book title or current chapter title
- search
- TOC
- bookmark
- settings

On small screens, keep only high-priority icons visible and move secondary
actions into an overflow menu.

### Bottom Chrome

Bottom chrome includes:

- current progression
- previous/next controls
- compact spread/page indicator
- optional scrubber

The progress control must write and read source locators, not durable page
indexes. Page/spread numbers are revision-local display hints.

## Interaction Model

### Touch

- Center tap toggles chrome.
- Left/right edge tap navigates previous/next.
- Horizontal swipe navigates previous/next.
- Long press on text enters selection mode when selection support lands.
- Tap link/image/footnote target dispatches based on `ReaderInteractionTarget`.
- Tap outside a panel dismisses it.

Edge tap zones should be adaptive:

- phone: 20-28% left/right edge zones
- tablet/desktop touch: narrower zones
- center zone never triggers navigation

### Mouse And Trackpad

- Pointer move near top/bottom shows chrome in `peek`.
- Click targets behave like touch tap.
- Right click or secondary click opens contextual UI without triggering target
  activation.
- Trackpad horizontal swipe may navigate when it is clearly intentional.

### Keyboard

Baseline shortcuts:

- `ArrowRight` / `PageDown` / `Space`: next spread
- `ArrowLeft` / `PageUp`: previous spread
- `Home` / `End`: first/last available position when supported
- `Escape`: close panel, then hide chrome
- `Cmd/Ctrl+F`: search
- `Cmd/Ctrl+B`: bookmark
- `Cmd/Ctrl+,`: settings

Shortcuts must not fire while text input focus is active.

## Panels And Feature Surfaces

### TOC

Purpose: navigate publication structure.

- phone: modal bottom sheet or full-height sheet
- tablet/desktop: side sheet
- clicking an item calls runtime locator resolution
- do not guess page index from TOC data in Flutter

### Search

Purpose: source-index-backed search.

- search field overlays top chrome or opens a focused panel
- results show snippet and chapter context
- selecting a result resolves locator/frame and highlights geometry when
  available
- query lifecycle is revision-scoped and stale-safe

### Settings

Purpose: reading preferences and layout revisions.

Controls:

- theme: light/sepia/dark/system
- font size
- line height
- margin
- spread mode
- line-breaking mode
- animation/reduced-motion preference

Changing layout settings creates a new revision. The old frame remains active
until the target frame in the new revision is ready.

### Footnotes

Footnote targets open:

- phone: bottom sheet
- tablet/desktop: anchored popover near target rect when practical

The content comes from `getFootnote`, not from display-list text extraction.

### Links

- internal EPUB links: resolve locator and navigate
- external links: confirmation sheet/popover with URL
- malformed/unsupported hrefs: non-blocking error surface

### Images

Image targets open a lightbox:

- full viewport dim background
- pinch/zoom/pan later
- resource bytes come through `getResource` and transfer caches
- decoded images are cached and released through the established lifecycle

### Loading, Reflow, And Errors

Opening:

- show a calm loading surface
- Lottie/Rive allowed here
- no full-book JSON payload assumption

Reflow:

- keep old frame visible
- show small status indicator
- crossfade when new revision frame is ready

Errors:

- use structured runtime error codes
- show concise message and recovery action
- do not expose raw stack traces in product UI

## Runtime Flow

### Open

```text
Open publication
  -> runtime.openSession(publicationRef)
  -> createRevision(layout from full viewport)
  -> getSpreadFrame(initial spread/locator)
  -> preload current frame resources
  -> prefetch adjacent spreads/resources
```

### Navigate

```text
User gesture/keyboard/action
  -> controller.next/previous OR resolveLocator
  -> getSpreadFrame(revisionId, spreadIndex)
  -> update active frame only if revision is current
  -> prefetch around current frame
  -> show transient chrome/progress
```

### Reflow

```text
Settings/viewport change
  -> create new revision
  -> resolve active locator in new revision
  -> request target frame
  -> keep old frame interactive until replacement is ready
  -> apply new frame with transition
  -> cancel stale revision if needed
```

### Target Handling

```text
ReaderSpreadView tap
  -> ReaderInteractionTarget
  -> target router
       link -> internal/external handling
       image -> resource/lightbox
       footnote -> getFootnote/panel
       text -> selection/annotation later
```

## Accessibility

Requirements:

- all icon buttons have labels/tooltips
- controls meet 44x44 logical pixel target size
- color themes meet contrast targets
- reduced motion is respected
- keyboard navigation covers all panels and actions
- focus order follows visible UI order
- screen reader labels describe actions, not icon names
- content semantics remain a future runtime/painter concern and should not be
  faked from display-list commands

## Test And Acceptance Plan

### Unit And Widget Tests

- chrome visibility state machine
- tap zones and gesture routing
- keyboard shortcuts
- panel open/close behavior
- settings produce revision requests
- reflow keeps old frame until replacement
- target routing by target kind
- aspect-ratio preservation in `ReaderSpreadView`

### Golden And Screenshot Tests

Use fixed `ReaderSpreadFrame` fixtures:

- reading surface hidden chrome
- visible chrome light/dark/sepia
- TOC side sheet
- search panel
- settings sheet
- footnote popover/sheet
- image lightbox
- error/loading states

Flutter fixture goldens should validate app shell composition. Core Web golden
pixel remains the gate for layout/render correctness.

### Performance Gates

- opening flow does not block input
- navigation transition stays within frame budget
- chrome animations do not trigger expensive re-layout
- resource prefetch does not block frame presentation
- reflow has no page-1 fallback and no stale target activation

## Implementation Roadmap

### PR UI-1: Plan And Dependencies

- Add this UI plan.
- Add app dependencies:
  `flex_color_scheme`, `flutter_animate`, `animations`, `lottie`, `rive`,
  `lucide_icons_flutter`.
- Keep dependencies in `apps/flutter_reader`.
- Add a dependency-boundary note to the architecture docs.

### PR UI-2: Design Tokens And Theme

- Create app theme module.
- Define light/dark/sepia schemes with `FlexColorScheme`.
- Define spacing, radii, elevation, icon size, hit target, and motion tokens.
- Replace Material icons in app shell with Lucide icons.
- Add widget tests for theme availability and contrast-sensitive surfaces.

### PR UI-3: Full-Viewport Reader Shell

- Replace Scaffold-style permanent chrome with a full-viewport `Stack`.
- Put `ReaderSpreadView` in `Positioned.fill`.
- Keep safe area handling limited to overlays/chrome.
- Implement hidden/peek/visible/locked chrome state.
- Add widget tests for no layout shrinkage and aspect-ratio behavior.

### PR UI-4: Gesture And Shortcut Layer

- Add center tap, edge tap, swipe, keyboard shortcuts, and pointer peek.
- Ensure secondary click and drag do not activate targets.
- Add interaction tests for touch, mouse, and keyboard paths.

### PR UI-5: Motion System

- Add `flutter_animate` motion helpers.
- Add `animations` transitions for sheets/dialogs.
- Implement reduced-motion switch.
- Add tests that motion preference changes transition behavior.

### PR UI-6: Reader Panels

- Add TOC, search, settings, footnote, link, and image surfaces.
- Use placeholder/demo data where runtime data is not ready, but keep the final
  command paths visible in code.
- Keep panels off the reading layout viewport.

### PR UI-7: Runtime Wiring

- Wire panels to `resolveLocator`, `search`, `getFootnote`, `getResource`,
  `prefetch`, and revision settings.
- Keep revision-scoped stale gates.
- Add regression tests for stale panel results.

### PR UI-8: Visual Acceptance

- Add Flutter golden/screenshot fixture tests.
- Add app integration smoke tests for open, navigation, search, footnote,
  settings/reflow, and image target.
- Add performance smoke gates for open/navigation/reflow.

### PR UI-9: Platform Host Integration

- Replace the demo host with platform runtime hosting.
- Add file opening.
- Keep the app shell unchanged; only the runtime provider changes.

## Explicit Non-Goals For This UI Plan

- Do not move product UI style into `@ritojs/core`.
- Do not make Flutter infer EPUB semantics from display-list commands.
- Do not make page/spread index the durable persistence model.
- Do not block app progress on final Lottie/Rive assets.
- Do not implement platform-native worker hosting in the UI PRs.
