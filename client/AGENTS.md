<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## BMap architecture
- The map is public: GET /api/graph is called anonymously; sign-in (user icon, top right) only unlocks editing, and auth failures drop edit rights without hiding the map.
- This app is a thin client for an external Okapi backend (spec: market map editor); never add app data logic to Lovable Cloud — all graph/auth calls go through `src/lib/bmap/api.ts`.
- `api.ts` switches between the real REST API and an in-browser mock (`mock-backend.ts`) by server setting (`VITE_API_URL` or the login dialog); keep the mock's validation in sync with the spec so demo mode behaves like the backend.
- Editor state lives in one zustand store (`src/lib/bmap/store.ts`); React Flow nodes are the source of truth and are converted to spec-shaped snapshots for Undo/Redo and diff-based server sync.
- Pure rules (history limit, cycle check, snapshot diff, debounced saver) live in framework-free modules with tests in `bmap-rules.test.ts`; keep them free of React/React Flow imports.
- The editor is rendered client-only (`ClientOnly` + lazy import) because it reads the JWT from localStorage.
- sendBeacon can't send headers, so batch-patch passes the JWT as `?token=` and a text/plain body; the backend must accept both.
