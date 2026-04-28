# Ultimate Werewolf — Architecture

> Living document. This captures decisions made during the planning phase
> on 2026-04-28. Anything marked **OPEN** still needs a decision.

## 1. Product modes

| Mode | Where the server runs | Internet needed? | Account? |
|------|----------------------|------------------|----------|
| **Online** | Cloud (we host it) | Yes | Just a name + session token |
| **Local / LAN** | One player's device on the same Wi-Fi | No | Just a name |

Same client, same engine, same protocol. Only the transport endpoint changes.

## 2. Tech stack

Locked in:

- **Server / engine language:** Node.js + TypeScript (strict)
- **Client framework:** **Svelte 5** (with runes) + **SvelteKit 2** for routing, build, and the SSR/SSG pipeline. **No React, anywhere.**
- **Native mobile path:** wrap the SvelteKit static export in **Capacitor** when we ship native binaries. Browser is the primary target; native is opt-in.
- **TTS narrator:** **Piper** (local, open-source). Online-only TTS providers are deferred.
- **Voice chat between players:** out of scope for v1 — players use Discord / Zoom / each other. **WebRTC voice is a planned post-v1 feature.**

Recommended (open to override):

- **Monorepo:** pnpm workspaces (fast, no fluff)
- **WS server:** Fastify + `ws` (lightweight; alternative would be `@fastify/websocket`)
- **Schema validation:** Zod (single source of truth for WS message types, shared client/server)
- **Test runner:** Vitest (works in both Node and browser)
- **Persistence (online mode only):** SQLite via better-sqlite3 — game logs and replays. LAN mode is in-memory only.

## 3. Repo layout

```
ww/
├── apps/
│   ├── server/       # Online-mode WS server (Fastify + ws + engine)
│   ├── client/       # SvelteKit 5 SPA — the player UI
│   └── host/         # Capacitor wrapper for the LAN host (added later)
├── packages/
│   ├── engine/       # Pure deterministic game engine. Zero I/O.
│   ├── protocol/     # Zod schemas for every WS message + TS types
│   ├── roles/        # Role catalog, balance points, scenario presets
│   └── narrator/     # Piper integration + narration script generator
├── docs/             # Rulebook (existing)
└── scripts/
```

## 4. The game engine

A pure function over events:

```ts
type GameState = { /* phase, players, roles, history, ... */ }
type GameEvent = { type: 'vote' | 'wolf-pick' | 'seer-peek' | ... ; ... }

function reduce(state: GameState, event: GameEvent): {
  next: GameState
  effects: NarrationEvent[]   // what the narrator should say / show
  outbox: PlayerMessage[]     // per-player updates the server should send
}
```

**Why pure:** the entire game can be unit-tested against the rulebook with zero infrastructure, and the same engine runs identically on the cloud server and the LAN host.

### Phase machine

```
LOBBY
  │
  ▼
SETUP  ── (deal roles, send each player their card)
  │
  ▼
NIGHT_n  ── (in role-call order: Cupid → Doppelganger → Werewolves → Seer → ...)
  │
  ▼
DAY_n_REVEAL  ── (announce who died overnight)
  │
  ▼
DAY_n_DISCUSSION  ── (free chat; timer)
  │
  ▼
DAY_n_NOMINATION  ── (point at someone + a second)
  │
  ▼
DAY_n_DEFENSE
  │
  ▼
DAY_n_VOTE
  │
  ├── lynched → DAY_n_REVEAL (role flip per chosen reveal-mode)
  └── no-lynch → NIGHT_(n+1)
  │
  ▼  (when win-condition met)
END
```

### Role data model

Every role has:

```ts
type Role = {
  id: string                  // 'seer'
  name: string
  team: 'village' | 'werewolf' | 'switching' | 'solo' | 'lovers'
  balancePoints: number       // from the rulebook (+7 Seer, -8 Wolf Cub, etc.)
  nightOrder: number | null   // when called at night; null = never woken
  wokenWhen: 'every-night' | 'first-night' | 'on-trigger' | 'never'
  action: ActionSpec | null   // what UI to show that role at night
  reveal: RevealSpec
  alternates: AlternateRule[] // the rulebook's "Alternate:" variations
  // ... etc
}
```

The full catalog (~42 roles) ships from day 1 — the user explicitly asked for the full deck.

### Balancer

Given player count + variants + a chosen scenario preset (or "auto"):

- Picks roles whose `balancePoints` sum targets ~0
- Honors hard rules (always 1 Seer + 1 Werewolf min, ratio of wolves to villagers from the rulebook table)
- Returns a deal-pile that the engine then shuffles and distributes

The 17 scenarios from page 11–13 of the rulebook become **named presets**.

## 5. Protocol (client ↔ server, WebSocket)

One persistent WS connection per player. Messages are JSON, validated by Zod on both ends.

### Server → client

```ts
type ServerMsg =
  | { type: 'lobby/state', players: PublicPlayer[], host: PlayerId }
  | { type: 'game/role-assigned', role: Role, secrets: SecretPayload }
  | { type: 'phase/changed', phase: Phase, deadline?: number }
  | { type: 'narration', text: string, audioUrl?: string }
  | { type: 'action/required', spec: ActionSpec }
  | { type: 'action/result', result: ActionResult }
  | { type: 'public/event', event: PublicEvent }   // visible to all alive
  | { type: 'spectator/event', event: SpectatorEvent } // visible to dead+spec
  | { type: 'game/ended', winners: Team[] }
```

### Client → server

```ts
type ClientMsg =
  | { type: 'lobby/join', name: string }
  | { type: 'lobby/ready', ready: boolean }
  | { type: 'host/start-game', config: GameConfig }
  | { type: 'action/submit', payload: ActionPayload }
  | { type: 'vote/cast', target: PlayerId | 'no-lynch' }
  | { type: 'chat/say', text: string }       // day phase only
```

**Per-player filtering** is critical: the server never sends the wolf list to a villager, never reveals the Seer's peek to anyone but the Seer, etc. This is enforced in the server adapter, not the engine.

## 6. The narrator

Two interchangeable surfaces, both consume the engine's `NarrationEvent` stream:

- **AI narrator (default)**: server (or LAN host) pipes the narration script into Piper, gets a WAV/Opus stream, broadcasts the audio URL to all clients. Clients play it.
- **Human narrator (option)**: a separate `/narrator` route in the client renders the same script as a teleprompter, plus buttons that perform engine actions on the players' behalf for groups that prefer fully manual operation.

A game config flag picks which one is active. Switching mid-game is allowed.

## 7. Spectator / dead-player visibility

Default: **dead players see everything** (wolf chat, Seer peeks, role identities).

Overridable via `GameConfig.spectatorVisibility`:
- `'full'` (default)
- `'public-only'` — dead players only see what alive players see
- `'team-only'` — dead players see only their former team's secrets

Implemented purely at the server-filter layer — engine state is the same.

## 8. Open architectural fork — the LAN-mode host

You picked: *"one of the player's phones acts as host of the game and everybody connects to it."* That's a great UX goal but it has a real constraint:

> Mobile browsers (especially iOS Safari) cannot run a TCP server. They can't open a port. So a phone-as-host *requires* a native wrapper, not just a webpage.

Three concrete paths, in order of pragmatism:

**Option A — Native host app via Capacitor + nodejs-mobile (recommended)**
- Build a small native app (`apps/host/`) that bundles the Node server inside the phone using `nodejs-mobile-cordova` / `nodejs-mobile-react-native` equivalents for Capacitor.
- Other players connect via the host's local IP shown in a QR code.
- ✅ Works exactly like the cloud server, same code.
- ⚠️ Android works well; iOS works but is fiddly (App Store review tolerates it). Bundle size grows ~30–50 MB.

**Option B — WebRTC mesh, no central server**
- Skip the "host" idea. All phones form a WebRTC peer mesh after a one-time signaling handshake (the QR code carries the signaling bootstrap).
- One peer is elected "engine owner" but has no special permissions.
- ✅ Pure browser, no native code.
- ⚠️ Peer-to-peer state sync is harder to keep secret-correct (engine owner sees all secrets). Disconnects are messy.

**Option C — Defer LAN to a desktop "host" app (Electron/Tauri)**
- Tell users: in LAN mode, one person runs the host on a laptop on the same Wi-Fi. Phones join via QR.
- ✅ Trivial to build — same Node server, packaged for desktop.
- ⚠️ Doesn't match your stated preference ("phone of one player").

**My recommendation:** start with **Option C** (week 1 — fastest path to a playable LAN game), and add **Option A** as the actual "phone-host" experience in a second iteration. Option B has subtle correctness footguns I'd rather not own at v1.

Need your call on this before I scaffold `apps/host/`.

## 9. MVP definition (what "v1 ships" means)

- Lobby: create a room, share a join link/QR, players name themselves and ready up.
- Configurable game setup: pick a scenario preset OR pick a player count + let the balancer choose.
- All ~42 roles implemented and tested.
- Day/night cycle with role-correct UIs (each player sees what their role lets them see).
- Voting (basic style first; the four variant styles come right after).
- Reveals: support all three modes from the rulebook (full / Werewolf-Villager-only / no-reveal).
- AI narrator (Piper) on the cloud server. Human-narrator mode as a fallback toggle.
- Dead-player view with the spectator visibility setting.
- Online deploy reachable from the public internet.
- LAN-mode host (per the answer to §8).

Out of scope for v1 (already agreed): WebRTC voice, multiple online TTS providers, accounts/persistence beyond a session token, replay viewer.

## 10. Milestone plan

1. **M0 — scaffolding** (this commit): monorepo, packages, tsconfig, lint, CI stub.
2. **M1 — engine + roles**: pure engine, all role data, full unit tests against the rulebook.
3. **M2 — protocol + server**: WS server, room lifecycle, per-player filtering.
4. **M3 — client lobby + day/night UI**: SvelteKit 5 routes for lobby, day, night, dead.
5. **M4 — narrator (Piper)** on the server, audio streaming to clients.
6. **M5 — LAN host** (per §8 decision).
7. **M6 — polish**: design pass, scenario presets in UI, replay export.

---
