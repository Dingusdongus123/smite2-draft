# Crystal Draft — SMITE 2 prototype and research

> **Transport update:** online play now uses the WebSocket room server in `server/` (authoritative draft, turn enforcement, reconnect). PeerJS has been removed. Roster, draft-order presets, and the crystal UI are unchanged. Sections below that describe PeerJS record the original prototype.

Research snapshot: 10 November 2026, Australia/Adelaide (ACDT). No deployment or external messages were made.

## Deliverables

- Standalone HTML: `/workspace/smite2-draft/smite2-draft.html`
- Size: **900,369 bytes** (879.3 KiB). HTML/CSS, application code, PeerJS 1.5.5, all 95 portraits are embedded. No CDN is needed for same-screen use.
- Roster machine data: `gods.json`, `roster.csv`; includes source URL for each original portrait and god page.
- Portrait originals processed to 144 × 144 WebP: `portraits/`, one correctly named file per god. 95 files, 95 distinct hashes, all decode successfully. No placeholders and no missing images.
- Visual asset audit: `portrait-contact-sheet.jpg` (a generated contact sheet, **not an application screenshot**).
- Maintainable source: `engine.js`, `app.js`, `template.html`, `build.py`; run `python3 build.py` to rebuild.
- Tests: `test.js`, `test-results.json`, `test-output.txt`.
- Screenshots: **not produced**. `screens/README.md` records the limitation. This executor had no permitted browser-dispatch tool; its desktop skill explicitly prohibited shell-driven browser automation. Node/jsdom tests are not represented as browser tests. Parent should perform a visual browser review and save lobby, mid-draft and summary images if an approved browser tool is available.

## Using it

1. Open the HTML in a current desktop browser. Same screen works offline.
2. Enter two captain names, choose Standard or Extended, adjust optional timers, and begin.
3. Hover/focus a portrait to inspect its metadata. Click a portrait then lock it in. Every selected/banned god is unavailable to both teams. Search and role/class, pantheon and primary damage filters cover all 95.
4. Online: creator chooses Create room and receives an 8-character code, then waits for a rival. Rival opens their own copy of this HTML, chooses Join room and enters that code. Creator is Order; guest is Chaos; creator starts when connected.
5. In an actual HTTPS deployment, Copy share link creates a `#room=CODE` URL. From a file, it copies only the room code, since a local file URL cannot be opened on the rival's computer. Both need the same HTML file and internet access for online mode.
6. Keep the host tab open. An interrupted guest can reconnect with its session token. Host refresh/end loses the in-memory room. No genuine accounts/passwords were added: this is room-based captain identification, not persistent authenticated login.

## Research findings and provenance

### What SMITE 2 is

A separate third-person action MOBA sequel, rebuilt from scratch in Unreal Engine 5, not a reskin or direct UE3 upgrade. Official Hi-Rez help establishes that technical foundation: https://support.hirezstudios.com/en/articles/9516169-smite-2 . That article is dated August 2024, so its old alpha/access/pricing statements were **not** treated as current.

Conquest is the strategic 5v5, three-lane mode: teams defeat the opposing Titan after advancing through defensive structures and using jungle objectives. Preferred draft roles are Solo, Jungle, Mid, Carry and Support. Roles are flexible; a god's pick position is not a role assignment. Reference: https://smite2.live/wiki/game-modes .

Strength and Intelligence are scaling stats, not damage categories. Building Strength does not automatically make damage physical; Intelligence does not automatically make it magical. Accordingly, the filters use the wiki's **primary attack damage type**, not an inferred build stat. Abilities, Aspects and individual build paths can complicate a god's actual damage profile. Reference: https://wiki.smite2.com/w/Stats . The prototype intentionally does not claim every attack and ability on a god has the same type.

### Roster confirmation

**95 playable gods**, with **Nox** the latest at OB47. Two full independent lists matched all 95 names:

1. SMITE 2 Wiki List of gods: https://wiki.smite2.com/w/List_of_gods — preferred roles, pantheon, primary attack type, releases, linked portrait assets.
2. SMITE 2 Codex: https://smite2randomizer.com/gods — all 95 names, epithets, approximate classes/archetypes.
3. SmiteSource release order: https://smitesource.com/gods/release-order — 95 total; Nox OB47 (3 Nov), Kuzenbo OB46 (20 Oct), Nike OB45 (6 Oct), Hel OB44 (22 Sep), Hachiman OB43 (8 Sep), Ravana OB42 (25 Aug), Ix Chel OB41 (11 Aug), Cu Chulainn OB40 (28 Jul), all 2026.
4. Hi-Rez-authored OB47 notes on a mirror: https://smite2.live/news/open-beta-47-update-notes — publication 2 November 2026; the roster/release source dates Nox's playability to 3 November. This is a publication-versus-release distinction, not a hidden contradiction. The mirror's “Official News” label describes its original author; `smite2.live` is not asserted to be the official publisher domain.

No uncertain roster inclusions. Mentions of cosmetic Travelers in patch notes were not used to infer additional playable gods. The wiki spelling **Hua Mulan** is preserved.

**Class caveat:** SMITE 2 Codex explicitly calls its Warrior/Guardian/Mage/Hunter/Assassin classes approximate. The prototype retains those labels as approximate metadata, not as official immutable SMITE 2 classes or a verbatim SMITE 1 classification. Some familiar gods (e.g. Amaterasu, Cupid, Chiron, Mordred, Nike, Odin, Xing Tian) have surprising approximate class labels there. Actual SMITE 2 preferred roles remain the more useful default filter. Missing Codex epithets for Da Ji, Hercules and Nu Wa were completed from their linked individual wiki pages.

### Draft formats and exact implemented order

**No universal current SMITE 2 pro draft configuration could be established.** Different tournaments and dates use different rules. The UI therefore names presets explicitly rather than promising “official SPL 2026”.

O = Order, C = Chaos. Each symbol is one sequential action (double picks are two individual locks by that captain).

**Default: SMITE 2 Standard / three-ban draft** (16 actions):
- Bans: **O C O C O C** (3 per team).
- Picks: **O C C O O C C O O C** (5 per team).

**Optional: Extended / legacy SPL-style** (20 actions):
- Phase 1 bans: **O C O C O C** (3 each).
- Phase 1 picks: **O C C O O C** (3 each).
- Phase 2 bans: **C O C O** (2 more each).
- Phase 2 picks: **C O O C** (2 more each).

Exact sequences were cross-checked against the public standard/extended sequence constants in SMITE 2 Companion's shipped JavaScript for https://smitecomp.com/draft . Public-source evidence is saved in `comp-bundle.js` (constants `_q` and `Sq`). This is community implementation evidence, **not an official Hi-Rez tournament rulebook**.

SMITE Prime 2026 Kick-Off explicitly specifies **Draft Three Ban**: https://smiteprime.com/tournaments/event/9/35 . Recent community Companion documentation supports Standard “3 bans, then picks” and Extended “3 bans · 3 picks · 2 bans · 2 picks”. Older SPL/recent ranked explanations support the familiar five-ban split-phase pattern, but older formats changed; they were not treated as current SMITE 2 pro authority: https://www.reddit.com/r/smitetraining/comments/liz5f0/understanding_banning_in_ranked/ .

The editable `DRAFT_ORDERS` object is at the top of `engine.js` and embedded unchanged in the HTML. Order is first-pick side in these presets. Creator is assigned Order for this single-game prototype; tournament seed/coin-flip/loser-side-choice procedures are not automated.

### Timers and timeout behavior

Default **40s pick / 18s ban / 90s team bank** follows Companion's explicitly labelled Babylon Smite League community preset, confirmed in its public source. Each side's bank persists through that game, is used only after base time expires, and is debited when that action locks. Pause/reconnect preserves the countdown. Timers and timeout policy are configurable.

These are **not independently verified universal professional tournament timers**. Companion's generic defaults were also different (60/45/120), which reinforces why the UI calls the chosen settings a community practice preset. A real tournament may use a different timer, grace period or staff pause procedure.

On expiry the prototype either picks/bans a random eligible god, or passes the slot, depending on the selected setting. Passing a pick is a **training convenience**, not a claim that official Conquest permits missing team picks. Local undo is another deliberate practice-only feature. No duplicates across either side's picks or bans; this is stricter than duplicate-ban handling in the Open rules.

### God locks, Fearless, series and disconnect rules

SmiteSource Open 2026 rules: https://smitesource.com/open-2026/rules

- Higher-seeded captain hosts a private Conquest Picks & Bans lobby.
- New Gods/Aspects are legal unless staff specifically disables them. A disabled Aspect does not disable its whole God.
- Locked choices are final. A draft disconnect is handled by rebuilding the lobby and repeating the same picks and bans.
- Accidentally repeating an already-banned God loses that ban; no redraft. Simulator prevents such errors instead.
- Game-one side choice depends on bracket/seed or regional coin-flip rules. Previous game's loser chooses sides in later games.
- Fearless: once a God is played, **neither** team can pick it again that BO3/BO5/Regional Set. **Bans reset each game.** This is played-god carry-over, not blanket banning every previously banned God.

SMITE Prime 2026 calls a similar played-god restriction **Vault Bans** for BO3 sets.

**Not implemented:** BO3/BO5 scoring or carry-over, Fearless/Vault series locks, champion pools per individual player, Aspects, tournament staff-disabled content, captain ready checks, role swaps, turn trading, spectators or administrative rulings. The optional-series feature was consciously left out of this single-game review prototype instead of presenting an inaccurate implementation.

### Footage / VOD review

No user footage was provided. Written rules plus fetched/indexed match **transcripts**, not viewed frames, were used:

- Founders Series Las Vegas Grand Finals, Team Risk vs 5M's: https://www.youtube.com/watch?v=gFGf7nKxmng . The fetched transcript explicitly says **two bans per team** for the January 2025 event, Team Risk first pick, and discusses repeat picks between games. That historical event is not the current three-ban preset and was not mislabeled as 2026 evidence. Commentary also illustrates flex picks (e.g. Athena/Sobek/Ymir role ambiguity), range/CC composition, comfort picks, and protecting priority selections.
- SMITE Prime 2026 NA Joust: https://www.youtube.com/watch?v=bOh65tsdzFw . The indexed transcript explicitly explains vault rules: once played, a god cannot be picked by either team again in that BO3; bans do not persist. This is **Joust**, not authoritative evidence for Conquest action order.
- Liquipedia event page was discoverable but fetch returned 403: https://liquipedia.net/smite/SMITE_Founders_Series/2025/Las_Vegas . No exact rules were asserted from that unread page.

**No frame-by-frame footage review was performed.** The user should not be told a video was watched.

## Implementation and online caveats

The simulator has a pure validated state engine, separate DOM view, and separate PeerJS transport. Host accepts only guest Chaos `commit` actions, checks revisions and god availability, and broadcasts authoritative state. Guest cannot submit Order actions, undo, pause, restart or change settings. Names are escaped before HTML insertion. Guests are bound to a random session reconnection token; a second unrelated guest is refused. No real email/password or permanent account is involved.

PeerJS API reference opened this turn: https://peerjs.com/client/api/peer . PeerJS 1.5.5 bundled from https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js ; MIT license retained in HTML and `PEERJS-LICENSE.txt`.

- Online depends on public PeerJS signaling, WebRTC support, STUN, firewalls and browser security policies. No dedicated TURN service is supplied. Restrictive/symmetric-NAT networks may not connect.
- Public room codes are an invitation mechanism, **not strong authentication**. Share privately. This is unsuitable for official tournaments or sensitive data.
- Guest reconnect is supported while the original host tab remains alive. Host refresh or device loss cannot recover a room; state is memory-only.
- A data-channel loss pauses the host and guest countdown; reconnect returns the host's authoritative state. A broken signaling connection attempts broker reconnect without unnecessarily pausing an otherwise-live data channel.
- The host can always inspect/modify its own client code. A production anti-cheat/audit authority requires a server, durable state, authenticated roles and replay/event logs.
- No deployment, real public room or real account was created during tests.

## Testing truthfully reported

- JavaScript syntax checks passed for `app.js` and `engine.js`.
- Node pure engine tests plus jsdom loading the **full compiled inline HTML**, including the embedded vendor library.
- Complete local Standard and Extended drafts; all 95 cards; portrait embedding; 190-image looping band; search, role, approximate class, pantheon, damage filtering; names escaped; lock-in, bank use, pause/resume, undo, no duplicates, summary display and restart.
- Random/pass timeout paths tested using a controlled DOM clock.
- Two independent jsdom windows with a **mock Peer transport**, testing create/join/start, turn ownership, guest-side impersonation rejection, heartbeat selection preservation, disconnect freeze, guest reconnect, a full 16-action draft and exactly equal final host/guest state.
- Final count is recorded in `test-results.json`; no script/DOM runtime errors in the passing run.
- **Not verified:** real Chromium/Firefox rendering, responsive visual layout, actual two-machine PeerJS/WebRTC connectivity, restrictive-NAT behavior, browser downloads/clipboard UX, keyboard/screen-reader accessibility beyond basic code checks. No real screenshots. No browser/WebRTC test claim should be made from these jsdom tests.

## Full roster metadata

Classes below are approximate Codex labels; role and primary attack damage are wiki labels. Artwork links for each exact God are in `gods.json` and `roster.csv`.

| God | Pantheon | Preferred role | Approx. class | Primary attack damage | Epithet |
|---|---|---|---|---|---|
| Achilles | Greek | Solo | Warrior | Physical | Hero of the Trojan War |
| Agni | Hindu | Mid | Mage | Magical | God of Fire |
| Ah Puch | Maya | Mid | Mage | Magical | Horrific God of Decay |
| Aladdin | Tales of Arabia | Jungle | Assassin | Magical | The Sultan |
| Amaterasu | Japanese | Solo | Guardian | Physical | The Shining Light |
| Anhur | Egyptian | Carry | Hunter | Physical | Slayer of Enemies |
| Anubis | Egyptian | Mid | Mage | Magical | God of the Dead |
| Aphrodite | Greek | Mid | Mage | Magical | Goddess of Beauty |
| Apollo | Greek | Carry | Hunter | Physical | God of Music |
| Ares | Greek | Support | Guardian | Magical | God of War |
| Artemis | Greek | Carry | Hunter | Physical | Goddess of the Hunt |
| Artio | Celtic | Solo | Guardian | Magical | The Bear Goddess |
| Athena | Greek | Support | Guardian | Magical | Goddess of Wisdom |
| Atlas | Greek | Support | Guardian | Magical | Titan of the Cosmos |
| Awilix | Maya | Jungle | Assassin | Physical | Goddess of the Moon |
| Bacchus | Roman | Support | Guardian | Magical | God of Wine |
| Baron Samedi | Voodoo | Mid | Mage | Magical | God of Life and Death |
| Bastet | Egyptian | Jungle | Assassin | Physical | Goddess of Cats |
| Bellona | Roman | Solo | Guardian | Physical | Goddess of War |
| Cabrakan | Maya | Solo | Guardian | Magical | Destroyer of Mountains |
| Cerberus | Greek | Solo | Guardian | Magical | Warden of the Underworld |
| Cernunnos | Celtic | Carry | Hunter | Physical | The Horned God |
| Chaac | Maya | Solo | Guardian | Physical | God of Rain |
| Charon | Greek | Support | Guardian | Magical | The Ferryman |
| Chiron | Greek | Carry | Mage | Physical | The Great Teacher |
| Chronos | Greek | Mid | Mage | Magical | Keeper of Time |
| Cu Chulainn | Celtic | Solo | Warrior | Physical | The Hound of Ulster |
| Cupid | Roman | Carry | Mage | Physical | God of Love |
| Da Ji | Chinese | Jungle | Assassin | Physical | The Nine-Tailed Fox |
| Danzaburou | Japanese | Carry | Hunter | Physical | The Legendary Tanuki |
| Discordia | Roman | Mid | Mage | Magical | Goddess of Strife |
| Eset | Egyptian | Mid | Mage | Magical | Goddess of Magic |
| Fenrir | Norse | Jungle | Assassin | Physical | The Unbound |
| Ganesha | Hindu | Support | Guardian | Magical | God of Success |
| Geb | Egyptian | Support | Guardian | Magical | God of Earth |
| Gilgamesh | Babylonian | Solo | Warrior | Physical | King of Uruk |
| Guan Yu | Chinese | Solo | Warrior | Physical | Saint of War |
| Hachiman | Japanese | Carry | Hunter | Physical | Lord of the Eight Banners |
| Hades | Greek | Solo | Mage | Magical | King of the Underworld |
| Hecate | Greek | Mid | Mage | Magical | Goddess of Sorcery |
| Hel | Norse | Mid | Mage | Magical | Goddess of the Underworld |
| Hercules | Roman | Solo | Warrior | Physical | Champion of Rome |
| Horus | Egyptian | Support | Guardian | Physical | The Rightful Heir |
| Hou Yi | Chinese | Carry | Hunter | Physical | Defender of the Earth |
| Hua Mulan | Chinese | Solo | Warrior | Physical | The Ascendant Warrior |
| Hun Batz | Maya | Jungle | Assassin | Physical | The Howler Monkey God |
| Ishtar | Babylonian | Carry | Hunter | Physical | Goddess of Love and War |
| Ix Chel | Maya | Mid | Mage | Magical | The Light Weaver |
| Izanami | Japanese | Carry | Hunter | Physical | Matron of the Dead |
| Janus | Roman | Mid | Mage | Magical | God of Portals and Transitions |
| Jing Wei | Chinese | Carry | Hunter | Physical | The Oathkeeper |
| Jormungandr | Norse | Solo | Guardian | Magical | The World Serpent |
| Kali | Hindu | Jungle | Assassin | Physical | Goddess of Destruction |
| Khepri | Egyptian | Support | Guardian | Magical | The Dawn Bringer |
| Kukulkan | Maya | Mid | Mage | Magical | Serpent of the Nine Winds |
| Kuzenbo | Japanese | Support | Guardian | Magical | King Kappa |
| Loki | Norse | Jungle | Assassin | Physical | The Trickster God |
| Medusa | Greek | Carry | Hunter | Physical | The Gorgon |
| Mercury | Roman | Jungle | Assassin | Physical | Messenger of the Gods |
| Merlin | Arthurian | Mid | Mage | Magical | The Master Wizard |
| Mordred | Arthurian | Solo | Guardian | Physical | Breaker of the Round Table |
| Morgan Le Fay | Arthurian | Mid | Mage | Magical | The Dark Enchantress |
| Ne Zha | Chinese | Jungle | Assassin | Physical | The Third Lotus Prince |
| Neith | Egyptian | Carry | Hunter | Physical | Weaver of Fate |
| Nemesis | Greek | Jungle | Assassin | Physical | Goddess of Vengeance |
| Nike | Greek | Solo | Guardian | Physical | Goddess of Victory |
| Nox | Roman | Mid | Mage | Magical | Goddess of Night |
| Nu Wa | Chinese | Mid | Mage | Magical | Guardian of Heaven |
| Nut | Egyptian | Carry | Hunter | Magical | Goddess of the Sky |
| Odin | Norse | Solo | Guardian | Physical | The Allfather |
| Osiris | Egyptian | Solo | Warrior | Physical | Broken God of the Afterlife |
| Pele | Polynesian | Jungle | Assassin | Physical | Goddess of Volcanoes |
| Poseidon | Greek | Mid | Mage | Magical | God of the Oceans |
| Princess Bari | Korean | Carry | Hunter | Magical | The Divine Mudang |
| Ra | Egyptian | Mid | Mage | Magical | Sun God |
| Rama | Hindu | Carry | Hunter | Physical | Seventh Avatar of Vishnu |
| Ratatoskr | Norse | Jungle | Assassin | Physical | The Sly Messenger |
| Ravana | Hindu | Jungle | Assassin | Physical | Demon King of Lanka |
| Scylla | Greek | Mid | Mage | Magical | Horror of the Sea |
| Sobek | Egyptian | Support | Guardian | Magical | God of the Nile |
| Sol | Norse | Mid | Mage | Magical | Goddess of the Sun |
| Sun Wukong | Chinese | Solo | Warrior | Physical | The Monkey King |
| Susano | Japanese | Jungle | Assassin | Physical | God of the Summer Storm |
| Sylvanus | Roman | Support | Guardian | Magical | Keeper of the Wild |
| Thanatos | Greek | Jungle | Assassin | Physical | Hand of Death |
| The Morrigan | Celtic | Mid | Mage | Magical | Phantom Queen |
| Thor | Norse | Jungle | Assassin | Physical | God of Thunder |
| Tsukuyomi | Japanese | Jungle | Assassin | Physical | God of the Moon |
| Ullr | Norse | Carry | Hunter | Physical | The Glorious One |
| Vulcan | Roman | Mid | Mage | Magical | Smith of the Gods |
| Xbalanque | Maya | Carry | Hunter | Physical | Hidden Jaguar Sun |
| Xing Tian | Chinese | Support | Warrior | Magical | The Relentless |
| Yemoja | Yoruba | Support | Guardian | Magical | Goddess of Rivers |
| Ymir | Norse | Support | Guardian | Magical | Father of the Frost Giants |
| Zeus | Greek | Mid | Mage | Magical | God of the Sky |
