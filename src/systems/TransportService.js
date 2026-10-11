import { SIM } from '../simulation/config.js';

/**
 * Abstraction des modes de transport.
 * La v0.1 simule la voiture (et les véhicules autonomes via des modificateurs) ; les autres modes
 * sont déclarés pour préparer leur ajout sans modifier le système de trafic : chaque mode fournit
 * une part modale et, plus tard, son propre réseau (lignes de bus, tram, métro, train, zones piétonnes).
 */
export const TRANSPORT_MODES = [
  { id: 'car', name: 'Voiture', network: 'road', implemented: true },
  { id: 'autonomous', name: 'Véhicule autonome', network: 'road', implemented: true, tech: 'autonomous_vehicles' },
  { id: 'walk_bike', name: 'Marche et vélo', network: 'none', implemented: true },
  { id: 'bus', name: 'Bus', network: 'road', implemented: false },
  { id: 'tram', name: 'Tramway', network: 'rail', implemented: false },
  { id: 'metro', name: 'Métro', network: 'rail', implemented: false },
  { id: 'train', name: 'Train régional', network: 'rail', implemented: false },
  { id: 'shared', name: 'Mobilité partagée', network: 'road', implemented: false }
];

export class TransportService {
  /**
   * Répartition modale des déplacements de personnes.
   * @returns {{car:number, autonomous:number, walk_bike:number}}
   */
  modalSplit(state) {
    const m = state.modifiers;
    const road = Math.min(0.92, Math.max(0.2, SIM.CAR_MODE_SHARE + (m.carModeShare ?? 0)));
    const av = state.tech.researched.autonomous_vehicles ? 0.35 : 0;
    return { car: road * (1 - av), autonomous: road * av, walk_bike: 1 - road };
  }

  /** Nombre de déplacements motorisés (en véhicules) générés par un nombre de déplacements de personnes. */
  vehicleTrips(state, personTrips) {
    const split = this.modalSplit(state);
    const m = state.modifiers;
    // Les trajets à vide ne concernent que la flotte autonome.
    const vehicles = split.car + split.autonomous * (1 + (m.emptyTripShare ?? 0));
    return personTrips * vehicles * (m.tripGenerationMult ?? 1);
  }
}
