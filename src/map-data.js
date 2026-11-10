/* Ward radii and the pixel scale for the SmiteSource Conquest image. */
(function (root) {
  'use strict';

  const MAP_SIZE = 1024;
  // Centroids measured on src/assets/conquest.png, 10 Nov 2026.
  // Chaos base glow (513, 22), Order base glow (515, 957).
  const CHAOS_BASE = { x: 513, y: 22 };
  const ORDER_BASE = { x: 515, y: 957 };
  const TITAN_SPAN_PX = ORDER_BASE.y - CHAOS_BASE.y;
  // No published titan-to-titan length in meters was found. 160m is an estimate.
  const ESTIMATED_TITAN_SPAN_METERS = 160;
  const PX_PER_METER = TITAN_SPAN_PX / ESTIMATED_TITAN_SPAN_METERS;
  const WARD_LIMIT = 10;
  // Icon edge in map pixels. At the fitted 1024 view this is about 15 CSS px.
  const WARD_ICON_PX = 16;
  // About 22 CSS px when the fitted 1024 map fills a typical window.
  const GOD_ICON_PX = 23;

  const wards = [
    {
      id: 'vision',
      name: 'Vision Ward',
      radiusM: 7.2,
      durationS: 120,
      revealsWards: false,
      estimated: false,
      source: 'https://wiki.smite2.com/w/Vision_Ward',
      icon: 'src/assets/vision-ward.png',
      blurb: 'Placed consumable. Reveals enemies within 7.2m for 120s or until destroyed.'
    },
    {
      id: 'sentry',
      name: 'Sentry Ward',
      radiusM: 7.2,
      durationS: 120,
      revealsWards: true,
      estimated: false,
      source: 'https://wiki.smite2.com/w/Sentry_Ward',
      icon: 'src/assets/sentry-ward.png',
      blurb: 'Same 7.2m radius as a Vision Ward, and it also reveals enemy wards. Both types count toward the 10-ward team cap on this board.'
    }
  ];

  const notes = [
    'Map image: SmiteSource, Open Beta 41 Conquest render (1024×1024), https://cdn.smitesource.com/dev/maps/ob41/conquest.png via https://smitesource.com/maps/conquest. It is shown as the background, not redrawn.',
    'Vision and Sentry wards reveal in a 7.2m radius for 120s. Those numbers are from wiki.smite2.com, read 10 November 2026, not from the screenshots. Open Beta 3 also set the placement targeter to 7.2m.',
    'In the owner screenshots full6 and full7 the yellow ground ring is that placement preview. The cursor sits 4.8m from the player while the ring’s near edge is already across the foreground, so the radius is greater than 4.8m. That agrees with 7.2m and not with a radius under 4.8m. A second stacked readout on the same marker looks like about 11.2m; it is a perspective label, not a flat measurement, and it was not used as the radius.',
    'Scale is estimated. On this image the Chaos base glow centroid is about (513, 22) and the Order base glow centroid is about (515, 957), 935px apart. No official Conquest length in meters was found, so that span is treated as 160m. A 7.2m ward is then 935/160×7.2 ≈ 42px in radius. If the real span is different, every circle scales with it. The meter figure on each ward stays 7.2.',
    'The bright Gold Fury glow and Fire Giant glow on this image are about 450px apart, about 77m at the same estimate. That separation was not an input to the scale.',
    'Each team can place 10 wards on this board. That cap is for the strategy page, not an in-game rule. In game the “max 2 placed” line is per god.',
    'Ward icons are the consumable item art from wiki.smite2.com: Consumable Vision Ward and Consumable Sentry Ward. A placed ward keeps the type chosen in the selector.'
  ];

  function wardById(id) {
    return wards.find(function (w) { return w.id === id; }) || null;
  }
  function radiusPx(id) {
    const ward = typeof id === 'string' ? wardById(id) : id;
    const meters = ward ? ward.radiusM : 7.2;
    return meters * PX_PER_METER;
  }

  const api = {
    MAP_SIZE: MAP_SIZE,
    CHAOS_BASE: CHAOS_BASE,
    ORDER_BASE: ORDER_BASE,
    TITAN_SPAN_PX: TITAN_SPAN_PX,
    ESTIMATED_TITAN_SPAN_METERS: ESTIMATED_TITAN_SPAN_METERS,
    PX_PER_METER: PX_PER_METER,
    SVG_PER_METER: PX_PER_METER,
    scaleEstimated: true,
    WARD_LIMIT: WARD_LIMIT,
    WARD_ICON_PX: WARD_ICON_PX,
    GOD_ICON_PX: GOD_ICON_PX,
    wards: wards,
    notes: notes,
    colors: ['#3ec6ff', '#ff9a3c', '#ff5d7a', '#ffe08a', '#9dffce', '#ffffff', '#c9a6ff'],
    wardById: wardById,
    radiusPx: radiusPx,
    radiusSvg: radiusPx
  };
  if (typeof module !== 'undefined') module.exports = api;
  root.CrystalMapData = api;
})(typeof window === 'undefined' ? globalThis : window);
