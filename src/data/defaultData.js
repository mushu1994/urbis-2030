// Données par défaut du jeu, intégrées au bundle par Vite (aucune requête réseau nécessaire).
// Pour des contenus additionnels (DLC, mods), un chargeur pourra fournir d'autres objets au Catalog.
import buildings from '../../public/data/buildings.json';
import technologies from '../../public/data/technologies.json';
import policies from '../../public/data/policies.json';
import upgrades from '../../public/data/upgrades.json';
import { Catalog } from './Catalog.js';

export const defaultData = { buildings, technologies, policies, upgrades };

export function createDefaultCatalog() {
  return new Catalog(buildings, technologies, policies, upgrades);
}
