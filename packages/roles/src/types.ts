/**
 * Static role definitions. Independent of any specific game instance.
 * The engine consumes this catalog to build a deck for a given player count.
 */

export type Team =
  | 'village'
  | 'werewolf'
  | 'switching'  // Cursed, Doppelgänger, Drunk
  | 'solo'       // Tanner, Lone Wolf, Hoodlum, Cult Leader, Vampire
  | 'lovers'     // assigned by Cupid; not dealt directly
  | 'system';    // Moderator, Amulet of Protection, Blank

export type RoleId =
  // Village team
  | 'apprentice-seer'
  | 'aura-seer'
  | 'bodyguard'
  | 'cupid'
  | 'diseased'
  | 'ghost'
  | 'hunter'
  | 'idiot'
  | 'lycan'
  | 'magician'
  | 'martyr'
  | 'mason'
  | 'mayor'
  | 'old-hag'
  | 'old-man'
  | 'pi'
  | 'pacifist'
  | 'priest'
  | 'prince'
  | 'seer'
  | 'spellcaster'
  | 'tough-guy'
  | 'troublemaker'
  | 'vampire-hunter'
  | 'villager'
  | 'witch'
  // Werewolf team
  | 'werewolf'
  | 'wolf-cub'
  | 'minion'
  | 'sorcerer'
  // Switching teams
  | 'cursed'
  | 'doppelganger'
  | 'drunk'
  // Other teams
  | 'cult-leader'
  | 'hoodlum'
  | 'tanner'
  | 'lone-wolf'
  | 'vampire'
  // Other cards
  | 'amulet-of-protection'
  | 'moderator'
  | 'blank';

/** When a role is woken at night, in canonical roll-call order (page 22). */
export type NightWakeRule =
  | { kind: 'never' }
  | { kind: 'first-night-only' }
  | { kind: 'every-night' }
  | { kind: 'on-trigger'; trigger: string };

/** What kind of action the role takes when called. Drives client UI. */
export type ActionSpec =
  | { kind: 'none' }
  | { kind: 'pick-one'; from: 'all-alive' | 'others-alive' | 'all'; optional?: boolean }
  | { kind: 'pick-two'; from: 'all-alive' | 'others-alive' }
  | { kind: 'pick-three'; from: 'all-alive' | 'others-alive' }
  | { kind: 'binary'; question: string }
  | { kind: 'free-text'; maxLength: number }; // e.g. Ghost's one-letter message

export type RoleDefinition = {
  id: RoleId;
  name: string;
  team: Team;
  /** "Village impact" from the rulebook. Sum across deal should target ~0. */
  balancePoints: number;
  /** When the moderator should wake this role. */
  wake: NightWakeRule;
  /** Sort key for the night roll-call. Lower = called earlier. null = never called. */
  nightOrder: number | null;
  /** Action shown to the player when their role is woken. */
  action: ActionSpec;
  /** Short rulebook flavor / one-line ability. */
  oneLiner: string;
  /** Long-form rulebook description, kept verbatim. */
  description: string;
  /** Optional rulebook "Alternate" rules. */
  alternates: string[];
  /** Whether the role is a Werewolf for the Seer's purposes. */
  appearsAsWerewolfToSeer: boolean;
  /** Whether the role counts toward the Werewolf parity win-condition. */
  countsAsWerewolfForParity: boolean;
};
