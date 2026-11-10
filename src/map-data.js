/* SMITE 2 Conquest board data. Radii are wiki figures. The map scale is estimated. */
(function (root) {
  'use strict';

  const ORDER_TITAN = { x: 500, y: 900 };
  const CHAOS_TITAN = { x: 500, y: 100 };
  const TITAN_SPAN_SVG = ORDER_TITAN.y - CHAOS_TITAN.y;
  // No published Conquest width was found. 160m titan-to-titan is an estimate.
  const ESTIMATED_TITAN_SPAN_METERS = 160;
  const SVG_PER_METER = TITAN_SPAN_SVG / ESTIMATED_TITAN_SPAN_METERS;

  const wards = [
    {
      id: 'vision',
      name: 'Vision Ward',
      kind: 'ward',
      radiusM: 7.2,
      durationS: 120,
      revealsWards: false,
      cost: '50 gold',
      carry: 'Up to 2',
      limit: 'Max 2 placed per god',
      source: 'https://wiki.smite2.com/w/Vision_Ward',
      estimated: false,
      blurb: 'Placed consumable. Reveals enemies within 7.2m for 120s or until destroyed.'
    },
    {
      id: 'sentry',
      name: 'Sentry Ward',
      kind: 'ward',
      radiusM: 7.2,
      durationS: 120,
      revealsWards: true,
      cost: '120 gold',
      carry: 'Up to 1',
      limit: 'Max 2 placed per god',
      source: 'https://wiki.smite2.com/w/Sentry_Ward',
      estimated: false,
      blurb: 'Placed consumable. Same 7.2m radius as a Vision Ward, and it also reveals enemy wards.'
    },
    {
      id: 'chalice',
      name: 'Warding Chalice',
      kind: 'ward',
      radiusM: 7.2,
      durationS: 120,
      revealsWards: false,
      cost: '400 gold',
      carry: '2 charges, refilled in the fountain',
      limit: 'Max 2 placed per god',
      source: 'https://wiki.smite2.com/w/Warding_Chalice',
      estimated: false,
      blurb: 'Places the same 7.2m / 120s ward as a Vision Ward. The chalice is the refill rule, not a different radius.'
    },
    {
      id: 'bifrost',
      name: 'Bifrost Shard',
      kind: 'ward',
      radiusM: 7.2,
      durationS: 90,
      revealsWards: false,
      cost: 'Conquest curio',
      carry: 'Cooldown 90s',
      limit: 'Max 2 placed per god',
      source: 'https://wiki.smite2.com/w/Bifrost_Shard',
      estimated: false,
      blurb: 'Conquest curio. Places a 7.2m ward that lasts 90s.'
    },
    {
      id: 'heimdallr',
      name: "Heimdallr's Sight",
      kind: 'pulse',
      radiusM: 8.8,
      durationS: 4,
      revealsWards: true,
      cost: 'Curio',
      carry: 'Cooldown 90s',
      limit: 'Pulse, not a deployed ward',
      source: 'https://wiki.smite2.com/w/Heimdallr%27s_Sight',
      estimated: false,
      blurb: 'Not a ward you leave on the ground. Pulses four times over 4s, revealing enemies, stealth, and wards within 8.8m.'
    },
    {
      id: 'gjallar',
      name: 'Gjallarflare burst',
      kind: 'burst',
      radiusM: 13.2,
      durationS: 6,
      revealsWards: false,
      travelM: 44,
      corridorM: 8.8,
      cost: 'Curio',
      carry: 'Cooldown 120s',
      limit: 'Burst after a traveling flare',
      source: 'https://wiki.smite2.com/w/Gjallarflare',
      estimated: false,
      blurb: 'The circle is the detonation reveal: 13.2m for 6s. While the flare is flying it reveals 8.8m along a path of up to 44m. This token marks the burst only.'
    }
  ];

  function structure(side, lane, tier, x, y) {
    const labels = { t1: 'Tier 1 tower', t2: 'Tier 2 tower', phoenix: 'Phoenix' };
    return {
      id: side + '-' + lane + '-' + tier,
      name: (side === 'order' ? 'Order' : 'Chaos') + ' ' + lane + ' ' + labels[tier],
      kind: tier === 'phoenix' ? 'phoenix' : 'tower',
      lane: lane,
      side: side,
      x: x,
      y: y
    };
  }

  const structures = [
    structure('order', 'mid', 't1', 500, 640),
    structure('order', 'mid', 't2', 500, 760),
    structure('order', 'mid', 'phoenix', 500, 830),
    structure('chaos', 'mid', 't1', 500, 360),
    structure('chaos', 'mid', 't2', 500, 240),
    structure('chaos', 'mid', 'phoenix', 500, 170),
    structure('order', 'duo', 't1', 168, 690),
    structure('order', 'duo', 't2', 248, 800),
    structure('order', 'duo', 'phoenix', 340, 860),
    structure('chaos', 'duo', 't1', 168, 310),
    structure('chaos', 'duo', 't2', 248, 200),
    structure('chaos', 'duo', 'phoenix', 340, 140),
    structure('order', 'solo', 't1', 832, 650),
    structure('order', 'solo', 't2', 760, 770),
    structure('order', 'solo', 'phoenix', 660, 845),
    structure('chaos', 'solo', 't1', 832, 350),
    structure('chaos', 'solo', 't2', 760, 230),
    structure('chaos', 'solo', 'phoenix', 660, 155)
  ];

  function camp(id, name, kind, x, y, side) {
    return { id: id, name: name, kind: kind, x: x, y: y, side: side || 'neutral', lane: null };
  }

  const orderCamps = [
    camp('order-purple', 'Order Inspiration (purple / Chimera)', 'purple', 250, 655, 'order'),
    camp('order-red', 'Order Caustic (red / Manticore)', 'red', 400, 600, 'order'),
    camp('order-yellow', 'Order Pathfinder (yellow)', 'yellow', 355, 730, 'order'),
    camp('order-blue', 'Order Primal (blue / Satyr)', 'blue', 735, 640, 'order'),
    camp('order-cyclops-duo', 'Order Cyclops (duo side)', 'cyclops', 300, 560, 'order'),
    camp('order-cyclops-solo', 'Order Cyclops (solo side)', 'cyclops', 640, 590, 'order'),
    camp('order-harpy', 'Order Harpies', 'harpy', 455, 575, 'order'),
    camp('order-oracle', 'Order Oracle', 'oracle', 270, 500, 'order'),
    camp('order-scorpion', 'Order Scorpion', 'scorpion', 145, 600, 'order')
  ];
  const chaosCamps = orderCamps.map(function (c) {
    return camp(c.id.replace('order', 'chaos'), c.name.replace('Order', 'Chaos'), c.kind, c.x, 1000 - c.y, 'chaos');
  });

  const neutrals = [
    camp('gold-fury', 'Gold Fury', 'gold', 300, 500),
    camp('ancient-fury', 'Ancient Fury (same pit, after Gold Fury)', 'ancient', 300, 455),
    camp('fire-giant', 'Fire Giant', 'fire', 710, 500),
    camp('pyromancer', 'Pyromancer', 'pyro', 650, 430),
    camp('fire-imps', 'Fire Imps', 'imp', 760, 545),
    camp('totem', 'Totem of Ku', 'totem', 860, 500),
    camp('ritual', 'Ritual Site', 'ritual', 500, 500),
    camp('order-titan', 'Order Titan', 'titan', ORDER_TITAN.x, ORDER_TITAN.y, 'order'),
    camp('chaos-titan', 'Chaos Titan', 'titan', CHAOS_TITAN.x, CHAOS_TITAN.y, 'chaos'),
    camp('order-teleporter', 'Order base teleporters', 'teleporter', 500, 865, 'order'),
    camp('chaos-teleporter', 'Chaos base teleporters', 'teleporter', 500, 135, 'chaos')
  ];

  const landmarks = structures.concat(orderCamps, chaosCamps, neutrals);

  const notes = [
    'Research date: 10 November 2026. Ward numbers are copied from wiki.smite2.com item pages, not measured in a match.',
    'Open Beta 3 (10 February 2025) set the shared reveal radius to 7.2m, down from 10.4m, and said that was the intended SMITE radius. https://wiki.smite2.com/w/SMITE_2_Open_Beta_3',
    'Open Beta 19 (23 September 2025) removed Cyclops Ward and replaced that camp drop with Cyclops Eye, which is a curio cooldown refund, not a ward. https://wiki.smite2.com/w/SMITE_2_Open_Beta_19',
    'Eyes of the Jungle pings enemy gods on the minimap. It has no vision radius, so it is not a token on this board. https://wiki.smite2.com/w/Eyes_of_the_Jungle',
    'Eye of Providence grants a Sentry Ward on a timer. The ward it gives uses the Sentry radius; it is not a separate circle. https://wiki.smite2.com/w/Eye_of_Providence',
    'The “max 2 wards placed” line is per god. This board does not enforce it, so a team plan can show more than two.',
    'Map layout follows the SMITE 2 wiki Conquest page and its overview diagram (Conquest_Map_Overview_S2.png): Order base at the bottom, Chaos at the top, Gold Fury on the duo (left) side, Fire Giant and Pyromancer on the solo (right) side, two towers and a Phoenix per lane, Titans, buff camps, and a center Ritual Site. Side teleporters have been gone since the December 2025 Holiday Megapatch. Open Beta 47 (2 November 2026) listed no map change. https://wiki.smite2.com/w/Conquest',
    'This drawing is an original schematic in the crystal style. It is not the wiki image, not an official texture, and not a traced SMITE 1 map.',
    'Scale is estimated. No Conquest map width or tower attack range in meters was found in the wiki, OB42–OB47 notes, or the SenseOS OB47 check (4 November 2026). The straight line from Order Titan to Chaos Titan is drawn as 160m. Every circle uses that scale. If the real span is different, the circles are proportionally wrong. The meter labels on wards are the wiki numbers; only the drawn size is estimated. Tower ranges are not drawn.'
  ];

  function wardById(id) {
    return wards.find(function (w) { return w.id === id; }) || null;
  }
  function radiusSvg(id) {
    const ward = wardById(id);
    if (!ward) return 0;
    return ward.radiusM * SVG_PER_METER;
  }

  const api = {
    ORDER_TITAN: ORDER_TITAN,
    CHAOS_TITAN: CHAOS_TITAN,
    TITAN_SPAN_SVG: TITAN_SPAN_SVG,
    ESTIMATED_TITAN_SPAN_METERS: ESTIMATED_TITAN_SPAN_METERS,
    SVG_PER_METER: SVG_PER_METER,
    scaleEstimated: true,
    wards: wards,
    landmarks: landmarks,
    notes: notes,
    colors: ['#8ceeff', '#c9a6ff', '#ff5d7a', '#ffe08a', '#9dffce', '#ffffff', '#ffb15a'],
    wardById: wardById,
    radiusSvg: radiusSvg
  };
  if (typeof module !== 'undefined') module.exports = api;
  root.CrystalMapData = api;
})(typeof window === 'undefined' ? globalThis : window);
