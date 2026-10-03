import type { PropBuilder } from '../build-context.ts';
import {
  buildCeilingDetail,
  buildCeilingPanel,
  buildCeilingRing,
  buildDownlight,
  buildPendantCluster,
} from './ceiling.ts';
import { buildFloorLamp, buildMediumPlant, buildRug, buildTallPlant } from './plants.ts';
import { buildBarStool, buildLoungeChair, buildLoungeSofa, buildOfficeChair } from './seating.ts';
import { buildCoffeeBar, buildTrashBin } from './kitchen.ts';
import { buildHoop, buildPizzaBox, buildScoreboard } from './play.ts';
import { buildBookshelf, buildShelfDecor } from './storage.ts';
import { buildBarTable, buildCoffeeTable, buildConferenceTable, buildCredenza } from './tables.ts';
import { buildDeskSetup, buildTableCenter } from './tabletop.ts';
import {
  buildArtFrame,
  buildFeltPanels,
  buildLectern,
  buildLightSwitch,
  buildSlatWall,
  buildWallClock,
  buildWhiteboard,
} from './wall.ts';

/** Visual builders keyed by prop type. Colliders/seats for the same types live in content. */
export const PROP_BUILDERS: ReadonlyMap<string, PropBuilder> = new Map<string, PropBuilder>([
  ['conference-table', buildConferenceTable],
  ['office-chair', buildOfficeChair],
  ['lounge-sofa', buildLoungeSofa],
  ['lounge-chair', buildLoungeChair],
  ['coffee-table', buildCoffeeTable],
  ['bar-table', buildBarTable],
  ['bar-stool', buildBarStool],
  ['credenza', buildCredenza],
  ['bookshelf', buildBookshelf],
  ['coffee-bar', buildCoffeeBar],
  ['whiteboard', buildWhiteboard],
  ['lectern', buildLectern],
  ['light-switch', buildLightSwitch],
  ['plant-tall', buildTallPlant],
  ['plant-medium', buildMediumPlant],
  ['floor-lamp', buildFloorLamp],
  ['trash-bin', buildTrashBin],
  ['rug', buildRug],
  ['slat-wall', buildSlatWall],
  ['felt-panels', buildFeltPanels],
  ['art-frame', buildArtFrame],
  ['wall-clock', buildWallClock],
  ['desk-setup', buildDeskSetup],
  ['table-center', buildTableCenter],
  ['shelf-decor', buildShelfDecor],
  ['ceiling-ring', buildCeilingRing],
  ['ceiling-panel', buildCeilingPanel],
  ['downlight', buildDownlight],
  ['pendant-cluster', buildPendantCluster],
  ['ceiling-detail', buildCeilingDetail],
  ['hoop', buildHoop],
  ['scoreboard', buildScoreboard],
  ['pizza-box', buildPizzaBox],
]);
