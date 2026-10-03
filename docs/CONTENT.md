# Content guide

Rooms, props, emotes, items and activities are data plus small registries. Nothing about a room
layout is hard-coded in TypeScript.

## Rooms

A room is a JSON file validated by `roomDataSchema` (`packages/shared/src/room/schema.ts`):
architecture, lighting, the main screen, spawn points, voice zones, prop instances and permanent
decals. `resolveRoom` expands prop instances through the prop catalog into world-space colliders,
seats and interactables. Seat ids are `<propId>.<index>`, stable on every client and the server.

To add a room:

1. Create `packages/content/src/rooms/<id>.json`.
2. Add a one-line shim `<id>.ts` that re-exports the JSON (keeps lazy loading working in Node and Vite).
3. Register it in `packages/content/src/rooms/index.ts`.
4. `pnpm test` validates every registered room (seats and spawns inside bounds).

## Props

`packages/content/src/props/catalog.json` defines, per prop type, colliders, seat anchors and
interactions in prop-local space (front is +Z, origin on the floor). Sized props (`tier`, `counter`)
use `boxFromParams` with `width`, `depth`, `height` instance params.

How a prop looks is a builder in `packages/render/src/scene/props/` registered in `PROP_BUILDERS`
by type; wall-mounted types are listed in `WALL_MOUNTED` (`room-builder.ts`) so they hide with
their wall in cutaway views.

## Hoops

A prop type with a `goal` scores baskets: `{ "offset": [x, y, z], "radius": r }` is the rim
center and inner radius in prop-local space. Give the rim real colliders too (the `hoop` type
rings it with 12 small boxes) so balls can bounce off it, and a backboard. Every instance becomes
a `ResolvedGoal` named by its prop id; aim assist, scoring and the server's validation pick it up
with no code changes. A `scoreboard` prop anywhere in the room shows the top five scorers.

## Held items and room actions

- Things people hold are `HELD_ITEMS` in `packages/shared/src/protocol/play.ts`, each with the
  action that uses it (`ITEM_USE`). A new item needs a model in `avatar/held-models.ts`, an
  attitude in `avatar/avatar-props.ts` (`ORIENT`), a HUD glyph (`HELD_ICONS` in
  `packages/ui/src/components/icons.tsx`) and `hold.<item>` labels in both locales.
- Interactions name a `kind` and a `promptKey`; the app decides what a kind does
  (`apps/web/src/app/room-actions.ts`) and enables it in `ENABLED_KINDS`. The coffee machine and
  water cooler put a mug or a cup in hand, the pizza box a slice.
- New emotes and item actions are poses in `avatar/emotes.ts` / `avatar/item-actions.ts` with a
  length in `ACTION_LENGTH`. Serious rooms only relay `SERIOUS_ACTIONS`.
