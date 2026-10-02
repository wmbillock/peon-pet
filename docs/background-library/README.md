# Background library: 60 environments

Open [the local gallery](preview.html) to compare the backgrounds at 200px or 400px. Category filters, search, and optional character/overlay placement guides are available. The PNG bundle must be present for previews.

This package supplies ten images in each of six categories. “Cell phone idle workers” means unoccupied everyday places for a character using a phone: cafés, lounges, transit stops, and similar spaces.

## Integration

1. Read [the manifest](../../scripts/background-library.json), then copy the local bundle's `renderer/assets/env-*.png` files to the same paths in the app.
2. Register the manifest's `environments` entries with `createEnvironStore` in `lib/pets-service.js`, resolving each relative `path` against the application root. The required fields are `id`, `display`, `description`, and `path`; `category` is catalog metadata.
3. Preserve existing environments, user overrides, and current pet selections. These backgrounds are for transparent cutout characters; baked scene sheets ignore environment selection.
4. Inspect desired character/background pairings in the app before changing defaults. The supplied gallery contains environments alone.

The public PR contains definitions, prompts, the gallery, and validation receipts. Artwork remains in the local bundle. Runtime registration is left to the development agent.

## Format

Each background is a single 1024×1024 opaque PNG generated with the built-in image tool and normalized with nearest-neighbor sampling. The prompts request warm right-side light, a clear lower-centre area about 55% wide by 45% tall, a calm top 10%, and no characters, text, or UI. Placement guides exist only in the gallery, never in the image files.

See [exact generation prompts](prompts.json) and [validation results](validation.json). Pixel checks establish dimensions, opacity, and resizing fidelity; composition is assessed visually rather than inferred from those checks. Browser visual QA of the gallery is not included.

All 60 PNGs passed square/opacity checks and the app environment importer with no crops. The environment store accepted all 60 unique IDs. The existing species/environment suite passed all 12 tests.

## Collections

### Starship bridges

| Background | Local PNG |
|---|---|
| Survey bridge | [survey-bridge](../../renderer/assets/env-survey-bridge.png) |
| Carrier bridge | [carrier-bridge](../../renderer/assets/env-carrier-bridge.png) |
| Botanical bridge | [botanical-bridge](../../renderer/assets/env-botanical-bridge.png) |
| Freighter bridge | [freighter-bridge](../../renderer/assets/env-freighter-bridge.png) |
| Crystal bridge | [crystal-bridge](../../renderer/assets/env-crystal-bridge.png) |
| Solar sail bridge | [solar-sail-bridge](../../renderer/assets/env-solar-sail-bridge.png) |
| Deep space bridge | [deep-space-bridge](../../renderer/assets/env-deep-space-bridge.png) |
| Red dwarf bridge | [red-dwarf-bridge](../../renderer/assets/env-red-dwarf-bridge.png) |
| Luxury liner bridge | [luxury-liner-bridge](../../renderer/assets/env-luxury-liner-bridge.png) |
| Ice survey bridge | [ice-survey-bridge](../../renderer/assets/env-ice-survey-bridge.png) |

### Video game rooms

| Background | Local PNG |
|---|---|
| Retro console den | [retro-console-den](../../renderer/assets/env-retro-console-den.png) |
| Arcade lounge | [arcade-lounge](../../renderer/assets/env-arcade-lounge.png) |
| Woodland game nook | [woodland-game-nook](../../renderer/assets/env-woodland-game-nook.png) |
| Cyberpunk game cafe | [cyberpunk-game-cafe](../../renderer/assets/env-cyberpunk-game-cafe.png) |
| Handheld attic | [handheld-attic](../../renderer/assets/env-handheld-attic.png) |
| Space game room | [space-game-room](../../renderer/assets/env-space-game-room.png) |
| Pastel co-op room | [pastel-coop-room](../../renderer/assets/env-pastel-coop-room.png) |
| Dungeon game den | [dungeon-game-den](../../renderer/assets/env-dungeon-game-den.png) |
| Tropical console cabana | [tropical-console-cabana](../../renderer/assets/env-tropical-console-cabana.png) |
| Minimal game studio | [minimal-game-studio](../../renderer/assets/env-minimal-game-studio.png) |

### Computer workstations

| Background | Local PNG |
|---|---|
| Sunlit home office | [sunlit-home-office](../../renderer/assets/env-sunlit-home-office.png) |
| Retro terminal office | [retro-terminal-office](../../renderer/assets/env-retro-terminal-office.png) |
| Loft workstation | [loft-workstation](../../renderer/assets/env-loft-workstation.png) |
| Midnight coder room | [midnight-coder-room](../../renderer/assets/env-midnight-coder-room.png) |
| Garden studio desk | [garden-studio-desk](../../renderer/assets/env-garden-studio-desk.png) |
| Library workstation | [library-workstation](../../renderer/assets/env-library-workstation.png) |
| Spaceport workstation | [spaceport-workstation](../../renderer/assets/env-spaceport-workstation.png) |
| Creative studio desk | [creative-studio-desk](../../renderer/assets/env-creative-studio-desk.png) |
| Mountain cabin office | [mountain-cabin-office](../../renderer/assets/env-mountain-cabin-office.png) |
| Compact apartment office | [compact-apartment-office](../../renderer/assets/env-compact-apartment-office.png) |

### Everyday phone spaces

| Background | Local PNG |
|---|---|
| Café window seat | [cafe-window-seat](../../renderer/assets/env-cafe-window-seat.png) |
| Station waiting room | [station-waiting-room](../../renderer/assets/env-station-waiting-room.png) |
| Rooftop lounge | [rooftop-lounge](../../renderer/assets/env-rooftop-lounge.png) |
| Bookstore corner | [bookstore-corner](../../renderer/assets/env-bookstore-corner.png) |
| Airport lounge | [airport-lounge](../../renderer/assets/env-airport-lounge.png) |
| Covered bus stop | [covered-bus-stop](../../renderer/assets/env-covered-bus-stop.png) |
| Laundromat lounge | [laundromat-lounge](../../renderer/assets/env-laundromat-lounge.png) |
| Hotel lobby nook | [hotel-lobby-nook](../../renderer/assets/env-hotel-lobby-nook.png) |
| Campus courtyard | [campus-courtyard](../../renderer/assets/env-campus-courtyard.png) |
| Ferry terminal lounge | [ferry-terminal-lounge](../../renderer/assets/env-ferry-terminal-lounge.png) |

### Forest retreats

| Background | Local PNG |
|---|---|
| Pine cabin clearing | [pine-cabin-clearing](../../renderer/assets/env-pine-cabin-clearing.png) |
| Mossy forest gazebo | [mossy-forest-gazebo](../../renderer/assets/env-mossy-forest-gazebo.png) |
| Birch reading grove | [birch-reading-grove](../../renderer/assets/env-birch-reading-grove.png) |
| Forest stream camp | [forest-stream-camp](../../renderer/assets/env-forest-stream-camp.png) |
| Redwood hideaway | [redwood-hideaway](../../renderer/assets/env-redwood-hideaway.png) |
| Bamboo sanctuary | [bamboo-sanctuary](../../renderer/assets/env-bamboo-sanctuary.png) |
| Autumn forest deck | [autumn-forest-deck](../../renderer/assets/env-autumn-forest-deck.png) |
| Snowy forest shelter | [snowy-forest-shelter](../../renderer/assets/env-snowy-forest-shelter.png) |
| Fern hollow | [fern-hollow](../../renderer/assets/env-fern-hollow.png) |
| Treehouse landing | [treehouse-landing](../../renderer/assets/env-treehouse-landing.png) |

### Nature views

| Background | Local PNG |
|---|---|
| Sunset beach | [sunset-beach](../../renderer/assets/env-sunset-beach.png) |
| Alpine meadow | [alpine-meadow](../../renderer/assets/env-alpine-meadow.png) |
| Lakeshore view | [lakeshore-view](../../renderer/assets/env-lakeshore-view.png) |
| Desert mesa view | [desert-mesa-view](../../renderer/assets/env-desert-mesa-view.png) |
| Coastal cliff view | [coastal-cliff-view](../../renderer/assets/env-coastal-cliff-view.png) |
| Waterfall glade | [waterfall-glade](../../renderer/assets/env-waterfall-glade.png) |
| Prairie horizon | [prairie-horizon](../../renderer/assets/env-prairie-horizon.png) |
| Volcanic shore | [volcanic-shore](../../renderer/assets/env-volcanic-shore.png) |
| Rainy valley | [rainy-valley](../../renderer/assets/env-rainy-valley.png) |
| Tropical lagoon | [tropical-lagoon](../../renderer/assets/env-tropical-lagoon.png) |
