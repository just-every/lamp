# Visual edit integration

The document root installs compiled source data with DOM mutation paused. A public
router `onBeforeNavigate` event pauses it again before a destination renders.
`withVisualEdits(Page)` resumes the same manager from the actual leaf component's
effect, after that page hydrates. The wrapper adds no DOM and is independent of
editor permissions. Wrap each newly authored leaf route, or its actual lazy content
component; never resume from an intermediate layout containing an unresolved Outlet.

`onRendered` alone is insufficient for nested lazy hydration in the maintained
router version. Do not replace this boundary with a timer or React private fields.

`pnpm verify:visual` validates compiled JSON, source locks, types, build, and focused
real-browser navigation/reload behavior. Full `pnpm verify` remains the default.
