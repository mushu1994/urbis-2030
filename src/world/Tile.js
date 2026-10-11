import { TERRAIN_LABELS } from './Terrain.js';

/**
 * Vue en lecture seule d'une case : regroupe les informations exigées par le cahier des charges
 * (coordonnées, terrain, altitude, occupation, valeur foncière, raccordements, environnement, identifiant).
 * Les objets retournés sont des copies : les modifier n'a aucun effet sur le monde.
 *
 * @param {import('../app/GameState.js').GameState} state
 * @returns {null | {
 *   id:number, x:number, y:number, terrain:number, terrainLabel:string, altitude:number,
 *   occupation: {type:'empty'|'road'|'building', zone:number, buildingId:number, roadCode:number},
 *   landValue:number,
 *   connections:{powered:boolean, watered:boolean, roadDistance:number, nearestRoad:number},
 *   environment:{pollution:number, noise:number, heat:number, green:number},
 *   services:{police:number, fire:number, health:number, education:number},
 *   traffic:{flow:number, congestion:number}, deliveryZone:boolean
 * }}
 */
export function getTile(state, x, y) {
  const g = state.grid;
  if (!g.inBounds(x, y)) return null;
  const i = g.idx(x, y);
  const bId = g.building[i];
  const road = g.road[i];
  return {
    id: i,
    x,
    y,
    terrain: g.terrain[i],
    terrainLabel: TERRAIN_LABELS[g.terrain[i]],
    altitude: g.altitude[i],
    occupation: {
      type: bId ? 'building' : road ? 'road' : 'empty',
      zone: g.zone[i],
      buildingId: bId,
      roadCode: road
    },
    landValue: g.landValue[i],
    connections: {
      powered: !!g.powered[i],
      watered: !!g.watered[i],
      roadDistance: g.roadDist[i],
      nearestRoad: g.nearestRoad[i]
    },
    environment: { pollution: g.pollution[i], noise: g.noise[i], heat: g.heat[i], green: g.green[i] },
    services: {
      police: g.coverPolice[i],
      fire: g.coverFire[i],
      health: g.coverHealth[i],
      education: g.coverEducation[i]
    },
    traffic: { flow: g.traffic[i], congestion: g.congestion[i] },
    deliveryZone: !!g.deliveryZone[i]
  };
}
